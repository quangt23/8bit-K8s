# PixelGPU

A GPU orchestration platform with a cozy 8-bit control room. Submit AI workloads, watch the
scheduler place them on GPU workers, and see each GPU light up in a pixel-art facility that is
driven by real backend state.

> **Status: Phase 0 (foundation).** The backend and frontend run and talk to each other.
> No GPUs, tasks, scheduler or workers exist yet. See [docs/ROADMAP.md](docs/ROADMAP.md).

PixelGPU always labels execution as **simulated**, **CPU** or **real GPU**, and never
presents simulated activity or invented telemetry as real hardware.

## What works today

- FastAPI backend with `GET /api/health` and OpenAPI docs at `/api/docs`
- React + TypeScript frontend with the PixelGPU visual identity and a live backend status readout
- One command to run both, plus tests, linting, type checks and a production build

## Quick start

Requirements: [uv](https://docs.astral.sh/uv/) (it fetches Python 3.12 automatically), Node.js ≥ 20.19, GNU Make.

```bash
make install   # backend (uv sync) + frontend (npm install)
make dev       # backend on :8000, frontend on :5173
```

Open <http://localhost:5173>. The "Backend link" panel should read **Backend online**.

Without Make:

```bash
cd backend && uv sync && uv run python -m pixelgpu     # terminal 1
cd frontend && npm install && npm run dev              # terminal 2
```

## Common commands

| Command          | What it does                                        |
| ---------------- | --------------------------------------------------- |
| `make dev`       | Run backend and frontend together (Ctrl+C stops both) |
| `make test`      | pytest + Vitest                                     |
| `make lint`      | ruff + ESLint + Prettier checks                     |
| `make typecheck` | mypy (strict) + tsc (strict)                        |
| `make build`     | Production frontend build into `frontend/dist`      |
| `make check`     | Everything above, as CI would run it                |

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
