# Roadmap

| Phase | Goal                                   | Status       |
| ----- | -------------------------------------- | ------------ |
| 0     | Barebones project that runs            | **Complete** |
| 1     | Pixel-art control room, simulated GPUs | **Complete** |
| 2     | Task submission and lifecycle          | Not started  |
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

## Known gaps

- No CI pipeline configured yet. `make check` is the intended CI entry point.
- Browser tests need Chromium's system libraries. They're not part of `make check` (see DEVELOPMENT.md).
- "Ineligible for this task" GPU highlighting needs tasks and the scheduler (Phase 3).
- Fleet state lives in memory and resets on restart. It moves to the database in Phase 2.
