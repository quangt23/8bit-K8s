# Roadmap

| Phase | Goal                                   | Status       |
| ----- | -------------------------------------- | ------------ |
| 0     | Barebones project that runs            | **Complete** |
| 1     | Pixel-art control room, simulated GPUs | Not started  |
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

## Known gaps

- No CI pipeline configured yet. `make check` is the intended CI entry point.
- No browser-level end-to-end tests. Playwright will be considered once there are real user
  workflows (Phase 2+).
