# Scheduler

**Not implemented yet.** The scheduler arrives in Phase 3. This document records the intended
design so earlier phases don't paint it into a corner. It will be rewritten to describe the
real behaviour once that exists.

## What already exists (Phase 2)

- Tasks with an effective `min_memory_mb` (the workload minimum, raised by any user request).
- The lifecycle `queued → scheduled → running → succeeded | failed | cancelled`, enforced by
  `tasks/lifecycle.py`.
- `TaskService.transition()`, a compare-and-swap status update. The scheduler will use it so
  that a task can't be scheduled twice, or scheduled after it was cancelled.
- `scheduler_decision`, `assigned_worker_id` and `assigned_gpu_id` columns, all still unused.

## Intended policy (Phase 3)

1. Validate the workload type (allowlist) and its resource requirements.
2. Consider healthy workers and their GPUs. Exclude offline, unavailable or incompatible devices
   and record the reason for each rejection.
3. Filter on declared constraints, such as available memory and supported workload type.
4. Select the **least-loaded eligible GPU**, breaking ties deterministically by GPU ID.
5. Reserve resources atomically, then record a decision object with the selected device, the
   devices considered and rejected (with reasons), the constraints, the policy name and a timestamp.
6. Release reservations on success, failure or cancellation.

If no GPU qualifies, the task stays queued or is marked unschedulable under a documented rule,
with an explanation such as "No GPU satisfies the 8 GB memory requirement."

The frontend will display the recorded decision and will never infer scheduling reasons itself.
