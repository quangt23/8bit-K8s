# PixelGPU

A GPU orchestration platform with a cozy 8-bit control room. Submit AI workloads, watch the
scheduler place them on GPU workers, and see each GPU light up in a pixel-art facility that is
driven by real backend state.

> **Status: Phase 1 (control room).** A pixel-art facility shows a fixed fleet of
> **simulated** GPUs served by the backend. Tasks, scheduling and real hardware come in
> later phases. See [docs/ROADMAP.md](docs/ROADMAP.md).

PixelGPU always labels execution as **simulated**, **CPU** or **real GPU**, and never
presents simulated activity or invented telemetry as real hardware.

## What works today

- An interactive Phaser facility: racks and GPU boards drawn from live backend data, with
  distinct idle, reserved, running, error and offline states
- Click a GPU (in the scene or the roster) to inspect it: health, schedulability, memory,
  utilization, worker and location, each value tagged _simulated_, _measured_ or _unavailable_
- A read-only fleet API (`/api/fleet`, `/api/gpus`, `/api/workers`) backed by 6 simulated
  GPUs on 2 simulated workers
- Accessible fleet roster, reduced-motion support, phone layout, and a fallback if the scene fails
- Tests: pytest, Vitest, and Playwright browser tests

## Quick start

Requirements: [uv](https://docs.astral.sh/uv/) (it fetches Python 3.12 automatically), Node.js ≥ 20.19, GNU Make.

```bash
make install   # backend (uv sync) + frontend (npm install)
make dev       # backend on :8000, frontend on :5173
```

Open <http://localhost:5173>. The chip in the top-right should read **API linked**.

Without Make:

```bash
cd backend && uv sync && uv run python -m pixelgpu     # terminal 1
cd frontend && npm install && npm run dev              # terminal 2
```

## Common commands

| Command          | What it does                                          |
| ---------------- | ----------------------------------------------------- |
| `make dev`       | Run backend and frontend together (Ctrl+C stops both) |
| `make test`      | pytest + Vitest                                       |
| `make lint`      | ruff + ESLint + Prettier checks                       |
| `make typecheck` | mypy (strict) + tsc (strict)                          |
| `make build`     | Production frontend build into `frontend/dist`        |
| `make check`     | Everything above, as CI would run it                  |

## Repository layout

```
backend/    FastAPI app (src/pixelgpu), tests, uv project
frontend/   Vite + React + TypeScript app
docs/       Architecture, API, scheduler, roadmap, development guide
scripts/    Development helpers (dev.sh)
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Scheduler](docs/SCHEDULER.md)
- [Roadmap](docs/ROADMAP.md)
- [Development](docs/DEVELOPMENT.md)

All artwork is original. The visual style is inspired by cozy farming games, but no assets
are copied.
