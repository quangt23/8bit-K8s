# API

Base path: `/api`. Interactive docs: `/api/docs`. OpenAPI schema: `/api/openapi.json`.

No endpoint requires authentication yet: PixelGPU is meant for localhost until Phase 8.
Clients can create, read and cancel tasks, but never set a task's status, GPU assignment or
resource measurements. Those belong to the backend.

## Telemetry provenance

Every telemetry value is a `Metric`:

```json
{
  "value": 0,
  "unit": "MiB",
  "source": "simulated",
  "updated_at": null,
  "note": "…"
}
```

| `source`      | Meaning                                                 |
| ------------- | ------------------------------------------------------- |
| `simulated`   | Produced by a simulated worker. Not real hardware.      |
| `measured`    | Read from real hardware (Phase 5). `updated_at` is set. |
| `unavailable` | Unknown. `value` is always `null` and `note` says why.  |

The backend enforces that `value` is `null` exactly when `source` is `unavailable`.

## `GET /api/health`

Liveness check.

```json
{
  "status": "ok",
  "service": "pixelgpu-backend",
  "version": "0.1.0",
  "environment": "development",
  "server_time": "2026-10-25T23:49:07.394653Z"
}
```

## `GET /api/fleet`

Workers and GPUs in one consistent snapshot. This is what the frontend uses.

```json
{
  "workers": [Worker, ...],
  "gpus": [GpuDevice, ...],
  "generated_at": "2026-10-26T00:06:04Z"
}
```

Both lists are sorted by `id`.

## `GET /api/workers`

`Worker[]`, sorted by `id`.

| Field                 | Type                                | Notes                                     |
| --------------------- | ----------------------------------- | ----------------------------------------- |
| `id`                  | string                              | e.g. `sim-worker-a`                       |
| `name`                | string                              |                                           |
| `execution_mode`      | `"simulated"` \| `"cpu"` \| `"gpu"` | How work on this worker actually executes |
| `status`              | `"online"` \| `"offline"`           |                                           |
| `rack`                | string                              | Rack the worker's devices sit in          |
| `gpu_ids`             | string[]                            |                                           |
| `supported_workloads` | string[]                            | Empty until workloads exist (Phase 2)     |
| `last_heartbeat`      | ISO timestamp \| null               | `null` for in-process simulated workers   |

## `GET /api/gpus`

`GpuDevice[]`, sorted by `id`.

## `GET /api/gpus/{gpu_id}`

One `GpuDevice`. Returns **404** `{"detail": "GPU 'GPU-99' not found."}` for unknown IDs.

| Field                  | Type                                    | Notes                                    |
| ---------------------- | --------------------------------------- | ---------------------------------------- |
| `id`                   | string                                  | Stable, e.g. `GPU-02`                    |
| `name`                 | string                                  | Device model name                        |
| `worker_id`            | string                                  |                                          |
| `execution_mode`       | `"simulated"` \| `"cpu"` \| `"gpu"`     |                                          |
| `location`             | `{ "rack": string, "slot": int }`       | Stable placement in the facility         |
| `memory_total_mb`      | int                                     | Advertised memory, MiB                   |
| `memory_used`          | `Metric` (MiB)                          |                                          |
| `utilization`          | `Metric` (%)                            | `unavailable` for simulated devices      |
| `health`               | `"healthy"` \| `"error"` \| `"offline"` | Can the device be used at all            |
| `health_reason`        | string \| null                          | Why a device is unhealthy                |
| `activity`             | `"idle"` \| `"reserved"` \| `"running"` | Always `idle` until the scheduler exists |
| `current_task_id`      | string \| null                          |                                          |
| `schedulable`          | bool                                    | Derived: healthy and idle                |
| `unschedulable_reason` | string \| null                          | Derived explanation when not schedulable |

## Workloads

### `GET /api/workloads`

The allowlist of workload types, with labels, descriptions and the JSON Schema of each
config. Anything not listed here is rejected.

| `type`             | Config fields (defaults)                                                                            | Minimum memory          |
| ------------------ | --------------------------------------------------------------------------------------------------- | ----------------------- |
| `echo`             | `message` (1–500 chars)                                                                             | 512 MiB                 |
| `text_summary`     | `text` (20–20,000 chars), `max_sentences` (1–10, default 3)                                         | 2 GiB                   |
| `sample_inference` | `model` (`pixel-tiny-1b` \| `pixel-small-7b`), `prompt` (1–2000), `max_tokens` (1–512, default 128) | 4 GiB / 14 GiB by model |
| `benchmark`        | `duration_seconds` (5–120, default 30), `matrix_size` (1024–8192, default 4096)                     | `matrix_size` MiB       |

Unknown config fields are rejected. The sample model names label simulated runs; they are
not real models (real inference is Phase 6).

## Tasks

### Lifecycle

```
queued ──► scheduled ──► running ──► succeeded
   │           │            │
   └───────────┴────────────┴──► failed / cancelled
```

Only these transitions are allowed, and terminal states never change. The backend's
scheduler and workers drive every transition except cancellation; see [SCHEDULER.md](SCHEDULER.md).

### `POST /api/tasks` → 201 `Task`

```json
{
  "prompt": "Nightly throughput check",
  "workload": {
    "type": "benchmark",
    "duration_seconds": 60,
    "matrix_size": 8192
  },
  "resources": { "min_memory_mb": 16384 }
}
```

| Field                     | Notes                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt`                  | Optional, ≤ 2000 chars. The user's own words, stored for context and **never executed**.                                                                |
| `workload`                | Required. One of the allowlisted specs above, chosen by `type`.                                                                                         |
| `resources.min_memory_mb` | Optional, 1–262,144. Can raise the workload's minimum but never lower it; a lower value is replaced by the minimum and a warning is logged on the task. |

Unknown top-level fields (such as `status` or `assigned_gpu_id`) are rejected.

Errors: `422 validation_error`, `422 unsupported_workload`, and `429 too_many_active_tasks`
once `PIXELGPU_MAX_ACTIVE_TASKS` tasks are queued, scheduled or running. The limit is a soft
cap: it's checked before insert, so simultaneous submissions can overshoot by a few.

### `GET /api/tasks?status=&gpu_id=&limit=` → `{ "tasks": Task[], "total": int }`

Newest first. `status` filters by lifecycle state, and `gpu_id` by the GPU a task was assigned to. `limit` is 1–200 (default 50). `total`
counts every match, not just the returned page.

### `GET /api/tasks/{id}` → `Task` plus `events`

`events` is the task's history, oldest first:

| Field                          | Notes                                                              |
| ------------------------------ | ------------------------------------------------------------------ |
| `kind`                         | `status` (a lifecycle transition) or `log` (an execution log line) |
| `level`                        | `info`, `warning` or `error`                                       |
| `from_status`, `to_status`     | Set on status events                                               |
| `message`, `timestamp`, `data` |                                                                    |

### `POST /api/tasks/{id}/cancel` → `Task`

- `queued` or `scheduled`: becomes `cancelled` immediately, with error code `cancelled`,
  releasing any GPU reservation.
- `running`: sets `cancel_requested_at` and logs a warning. The worker stops at its next
  check (within a fraction of a second) and moves the task to `cancelled`. Repeating the
  request has no further effect.
- Finished (`succeeded`, `failed`, `cancelled`): `409 invalid_transition`.

Unknown IDs return `404 not_found`.

### `Task`

| Field                                                                                          | Notes                                                      |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `id`                                                                                           | `task_` + 16 hex characters                                |
| `prompt`, `workload`, `min_memory_mb`                                                          | As submitted. `min_memory_mb` is the effective requirement |
| `status`                                                                                       | Lifecycle state                                            |
| `queue_position`                                                                               | 1-based FIFO position while `queued`, otherwise `null`     |
| `created_at`, `updated_at`, `scheduled_at`, `started_at`, `finished_at`, `cancel_requested_at` | UTC ISO timestamps                                         |
| `assigned_worker_id`, `assigned_gpu_id`                                                        | Set by the scheduler (Phase 3)                             |
| `progress`                                                                                     | 0–1 when a worker reports it, otherwise `null`             |
| `result`                                                                                       | Workload output                                            |
| `error`                                                                                        | `{ "code", "message" }` on failure or cancellation         |
| `scheduler_decision`                                                                           | Recorded by the scheduler (Phase 3)                        |

## Errors

Every error uses one shape:

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request is invalid. See details.",
    "details": [
      {
        "field": "workload.text",
        "message": "String should have at least 20 characters"
      }
    ]
  }
}
```

| Status | `code`                  | When                                         |
| ------ | ----------------------- | -------------------------------------------- |
| 404    | `not_found`             | Unknown route, GPU or task                   |
| 405    | `method_not_allowed`    | e.g. `PUT /api/tasks/{id}`                   |
| 409    | `invalid_transition`    | A lifecycle change the state machine forbids |
| 422    | `validation_error`      | Bad input. `details[].field` names the field |
| 422    | `unsupported_workload`  | `workload.type` isn't in the allowlist       |
| 429    | `too_many_active_tasks` | Submission limit reached                     |

## Live updates

PixelGPU uses **invalidation**: the server says _when_ something changed, and the client
fetches one consistent snapshot. The WebSocket never carries state, so messages can't
arrive stale, out of order, or twice in a way that matters.

### `WS /api/live`

Server → client messages (the client sends nothing):

| Message                              | When                                                                 |
| ------------------------------------ | -------------------------------------------------------------------- |
| `{"type": "hello", "revision": n}`   | Immediately after connecting                                         |
| `{"type": "changed", "revision": n}` | After database commits, at most one per 50 ms (bursts are coalesced) |
| `{"type": "ping", "revision": n}`    | After 15 s without other messages (keep-alive)                       |

`revision` increases by one per `changed` message, for the life of the backend process.
A client too far behind (32 unread messages) is disconnected with code 1013, and should
reconnect and resync.

Client protocol (as implemented in `frontend/src/live/`):

1. Connect. On `hello`, fetch `GET /api/live/snapshot`.
2. On `changed` with `revision` greater than the last snapshot's `revision`, fetch again.
   Keep at most one fetch in flight; requests during a fetch become one more fetch after it.
3. If nothing (not even `ping`) arrives for 40 s, treat the socket as dead.
4. Reconnect with backoff of 0.5, 1, 2, 4 and 8 s, then every 10 s. While disconnected,
   poll the snapshot every 3 s.

### `GET /api/live/snapshot?events_after=` → `LiveSnapshot`

Everything the control room shows, read in one database transaction:

| Field              | Notes                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| `revision`         | Includes every change announced with this revision or earlier             |
| `generated_at`     |                                                                           |
| `fleet`            | Same as `GET /api/fleet`                                                  |
| `tasks`            | Every active task, plus the 50 most recent finished ones, newest first    |
| `total_tasks`      | Count of all tasks                                                        |
| `metrics`          | Same as `GET /api/metrics`                                                |
| `events`           | Feed events after `events_after`, oldest first; without it, the latest 50 |
| `latest_event_id`  | Pass this as `events_after` next time                                     |
| `events_truncated` | More than 500 events were missed: drop the cursor and start the feed over |

### `GET /api/events?after=&limit=` → `{ events, latest_event_id, truncated }`

The activity feed: every task event (status changes and log lines) across all tasks,
oldest first. `task_events.id` only ever increases, so `after` works as a cursor, and
paging with `after = last id` returns each event exactly once. Each event also carries
`task_id`, `workload_type` and the task's `gpu_id`. `limit` is 1 to 500.

### `GET /api/metrics` → `Metrics`

Computed from task records. These are orchestration figures, **not hardware telemetry**.

| Field                              | Meaning                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `tasks_by_status`                  | Count per lifecycle status                                                               |
| `gpus.total`, `gpus.healthy`       |                                                                                          |
| `gpus.allocated`                   | GPUs reserved by a scheduled or running task (not utilization)                           |
| `finished_last_5_minutes`          | Tasks that reached a terminal status in the last 5 minutes                               |
| `recent.sample_size`               | Last finished tasks considered (up to 50)                                                |
| `recent.success_rate`              | Succeeded ÷ (succeeded + failed). Cancellations excluded; unschedulable counts as failed |
| `recent.median_queue_wait_seconds` | Submitted → scheduled                                                                    |
| `recent.median_run_seconds`        | Started → finished                                                                       |
