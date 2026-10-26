# API

Base path: `/api`. Interactive docs: `/api/docs`. OpenAPI schema: `/api/openapi.json`.

All endpoints are read-only for now, and none require authentication (localhost only).

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

## Errors

FastAPI's default shape: `{"detail": "..."}`. Unknown routes return 404.

## Live updates

The frontend polls `GET /api/fleet` every 5 seconds. WebSocket updates are planned for Phase 4.
