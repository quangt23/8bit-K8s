# Scheduler

How PixelGPU decides where a task runs, how GPUs are reserved and released, and what
happens when nothing fits. Code: `backend/src/pixelgpu/scheduling/`.

## Model

- **GPUs are exclusive.** A GPU runs at most one task at a time. A task fits a GPU when
  `task.min_memory_mb <= gpu.memory_total_mb`. Sharing a GPU between tasks isn't supported yet.
- **Requirements.** `min_memory_mb` is the workload's minimum, raised by any user request
  (never lowered). The workload type must be in the worker's `supported_workloads`.
- **One scheduler loop per backend process.** It runs on a background thread. A pass starts
  when a task is submitted or cancelled, when a worker finishes, and otherwise every
  `PIXELGPU_SCHEDULER_INTERVAL_SECONDS` (default 1 s).

## A scheduling pass

Queued tasks are considered **oldest first** (by `created_at`, then `id`). For each one:

1. **Evaluate every GPU**, in ID order, and record a verdict:

   | Check (in order)    | Rejection reason                        | Kind         |
   | ------------------- | --------------------------------------- | ------------ |
   | Worker registered   | `Worker w is not registered.`           | capability   |
   | Workload supported  | `Worker w doesn't support 'benchmark'.` | capability   |
   | Enough memory       | `Has 8 GiB; needs 16 GiB.`              | capability   |
   | Worker online       | `Worker w is offline.`                  | availability |
   | Device not offline  | `Device is offline.`                    | availability |
   | Device not in error | `Device is reporting an error: …`       | availability |
   | Not reserved        | `Busy with task_….`                     | availability |

2. **Decide.**
   - **Some GPU is eligible:** apply the policy, reserve, mark `scheduled`, dispatch.
   - **No GPU is even capable** (capability checks fail everywhere): the task **fails**
     with error code `unschedulable`, e.g. _"No GPU satisfies the 48 GiB memory requirement.
     The largest is 24 GiB (GPU-01, GPU-02)."_ Waiting would never help.
   - **Capable GPUs exist but none is available:** the task **stays queued**. Its recorded
     decision says why, e.g. _"Waiting for a GPU. The 6 GPUs that could run this are
     unavailable: 4 busy, 1 reporting an error, 1 offline."_ A warning is logged on the task
     the first time it starts waiting.

3. **Record the decision** on the task as `scheduler_decision`:

   ```json
   {
     "outcome": "scheduled",
     "policy": "best_fit_memory",
     "decided_at": "…",
     "workload_type": "echo",
     "min_memory_mb": 512,
     "selected_gpu_id": "GPU-05",
     "selected_worker_id": "sim-worker-b",
     "candidates": [{ "gpu_id": "GPU-01", "eligible": true, "reason": null, "memory_total_mb": 24576, "worker_id": "…" }, …],
     "explanation": "Picked GPU-05: the smallest free GPU with at least 512 MiB (8 GiB, best fit). 3 other eligible GPUs were larger or later by ID."
   }
   ```

   The UI displays this as recorded and never works out reasons of its own.

### Backfill

The pass doesn't stop at a task that has to wait. A later, smaller task can take a GPU
while an earlier, larger one waits. This keeps GPUs busy, but a large task can be delayed
indefinitely by a steady stream of small ones (starvation). Reserving capacity for waiting
tasks, or ageing their priority, would fix this; neither is implemented yet.

## Policy: `best_fit_memory`

Pick the eligible GPU with the **least total memory**, breaking ties by **GPU ID**.

Because GPUs are exclusive, every eligible GPU is equally idle, so "least loaded" can't tell
them apart. Best fit keeps large GPUs free for tasks that need them. Policies implement the
`SchedulingPolicy` protocol (`choose(eligible, requirements)`), so a different one can be
swapped in without touching the database, API or UI.

**Determinism.** Given the same fleet and the same tasks in the same order, the placements and
explanations are identical (`test_same_submissions_give_the_same_placements`).

## Reservations

```
gpu_reservations(gpu_id PRIMARY KEY, task_id UNIQUE → tasks.id, worker_id, reserved_at)
```

- **Reserve:** insert the row **and** move the task `queued → scheduled` (compare-and-swap)
  **in one transaction**. If the GPU is already taken, the primary key rejects the insert. If
  the task was cancelled meanwhile, the compare-and-swap rejects the update. Either way the
  transaction rolls back and nothing is dispatched.
- **One GPU per task:** `task_id` is unique.
- **Release:** any transition to `succeeded`, `failed` or `cancelled` deletes the row in the
  same transaction (`TaskService.apply_transition`). Every path (worker success, failure,
  timeout, cancel, unschedulable, restart recovery) releases through it.
- **Live GPU state** (`activity`, `current_task_id`, simulated `memory_used`) is derived from
  reservations, so the API, UI and scheduler can't disagree.

`test_concurrent_schedulers_never_double_book_a_gpu` runs six schedulers against twelve
tasks at once and checks that exactly four GPUs are reserved, each by one task, and that each
reservation was dispatched exactly once.

## Dispatch and execution

After the reservation commits, the scheduler hands an `Assignment(task_id, gpu_id, worker_id)`
to the worker. A simulated worker has a queue and one runner thread per GPU. The runner:

1. moves the task `scheduled → running` (if it was cancelled first, it skips the task);
2. runs the deterministic simulation, reporting progress and log lines;
3. moves the task to `succeeded`, `failed` (`workload_failed`, `timeout`, `worker_error`)
   or `cancelled`, which releases the GPU.

**Cancellation:** a `queued` or `scheduled` task is cancelled immediately (freeing any
reservation). A `running` task gets `cancel_requested_at`; the runner checks for it between
short time slices and stops.

**Timeouts:** tasks exceeding `PIXELGPU_TASK_TIMEOUT_SECONDS` (simulated seconds) fail with `timeout`.

## Restarts

In-process workers don't survive a restart. On startup, tasks still `scheduled` or `running`
fail with `worker_lost` and their reservations are released.

## Limits of this implementation

- **Single process.** The scheduler, workers and API share one process. Reservations are
  already safe across processes (database constraints), but workers aren't: a second backend
  process couldn't run the first one's tasks, and its startup recovery would fail them.
  Distributed workers with heartbeats are Phase 8.
- **SQLite.** Writes are serialised with WAL mode and a 10 s busy timeout. That's fine
  locally; use PostgreSQL for real concurrency (Phase 8).
- **Exclusive GPUs only;** no memory sharing or multi-GPU tasks.
- **No fairness beyond FIFO with backfill;** large tasks can starve.
- **Health is static.** Simulated health comes from the seed; real health checks are Phases 5 and 8.
