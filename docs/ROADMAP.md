# Roadmap

| Phase | Goal                                   | Status       |
| ----- | -------------------------------------- | ------------ |
| 0     | Barebones project that runs            | **Complete** |
| 1     | Pixel-art control room, simulated GPUs | **Complete** |
| 2     | Task submission and lifecycle          | **Complete** |
| 3     | Real scheduler and simulated workers   | Not started  |
| 4     | Live updates and observability         | Not started  |
| 5     | Real GPU discovery (NVIDIA, optional)  | Not started  |
| 6     | Real inference workloads               | Not started  |
| 7     | AI-assisted orchestration              | Not started  |
| 8     | Distributed workers, hardening         | Not started  |

## Phase 0 acceptance criteria

- [x] Frontend starts (`make frontend` / `npm run dev`)
- [x] Backend starts (`make backend` / `python -m pixelgpu`)
- [x] Health endpoint returns 200 (`GET /api/health`)
- [x] Frontend reaches backend (through the Vite proxy, verified with curl and the in-app status panel)
- [x] Production frontend build succeeds (`make build`)
- [x] Test suite passes (`make test`: 5 backend, 8 frontend)

## Phase 1 acceptance criteria

- [x] Scene renders reliably inside React (browser test; one canvas even under StrictMode)
- [x] At least four distinct simulated GPUs are visible (6 across 2 racks)
- [x] Selecting a GPU opens its details (scene click and roster, both browser-tested)
- [x] Each GPU's identity matches the backend (browser test clicks real canvas coordinates)
- [x] State indicators work: idle, reserved, running, error, offline (completed flash is wired but only reachable once tasks exist)
- [x] App stays usable if the scene fails to load (browser test blocks Phaser)
- [x] Cohesive visual design (screenshots reviewed at desktop and phone widths)

## Phase 2 acceptance criteria

- [x] Submitting a task creates a persistent database record (API and browser tests)
- [x] Refreshing the page preserves task history (browser test reloads the page; API test restarts the app on the same database)
- [x] Invalid workload requests are rejected clearly (`unsupported_workload`, and `validation_error` naming the field)
- [x] Tasks can be inspected individually (`GET /api/tasks/{id}` with timeline and logs, task inspector)
- [x] Invalid lifecycle transitions are rejected (exhaustive state-machine test, compare-and-swap race test, 409 on cancel)
- [x] The frontend reflects actual backend task status (polling; cancel and run-again round-trip through the API)
- [x] Tasks stay `queued` until the Phase 3 scheduler exists

## Known gaps

- No CI pipeline configured yet. `make check` is the intended CI entry point.
- Browser tests need Chromium's system libraries. They're not part of `make check` (see DEVELOPMENT.md).
- "Ineligible for this task" GPU highlighting needs tasks and the scheduler (Phase 3).
- Fleet state lives in memory; it moves to the database with reservations in Phase 3.
- No task ever leaves `queued` on its own yet (no scheduler), so running, succeeded and failed
  appear only in tests.
- The active-task limit is a soft cap (count, then insert).
- The task list shows the newest 100 tasks; there's no pagination UI yet.
