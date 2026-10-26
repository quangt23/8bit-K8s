# Development

## Prerequisites

- **uv** ≥ 0.9. It manages the Python virtualenv and installs the pinned Python
  (`backend/.python-version` = 3.12; any Python ≥ 3.12 is supported).
- **Node.js** ≥ 20.19 (developed on 24) and npm.
- **GNU Make**, optional but convenient.

No GPU, NVIDIA driver, database server or API key is needed.

## Setup

```bash
make install
cp .env.example backend/.env   # optional, defaults work without it
```

## Running

```bash
make dev        # both services; Ctrl+C stops both, and a crash in either stops the script
make backend    # API only, with auto-reload in development
make frontend   # UI only
```

| URL                              | What                 |
| -------------------------------- | -------------------- |
| http://localhost:5173            | Frontend             |
| http://127.0.0.1:8000/api/health | Backend health       |
| http://localhost:5173/api/docs   | API docs (via proxy) |

## Configuration

Backend settings come from `PIXELGPU_*` environment variables or `backend/.env`. See
`.env.example` for the full list. `PIXELGPU_BACKEND_URL` changes where the Vite dev server
proxies `/api`. `PIXELGPU_SIMULATED_FLEET=false` starts with no GPUs (to see the empty state).

## Simulation

The scheduler and two simulated workers start with the backend. Simulated workloads take
deterministic times: echo 2 s, summary about 3 s, inference 2–43 s depending on model and `max_tokens`,
and benchmarks their `duration_seconds`.

| Setting                               | Default | Use                                            |
| ------------------------------------- | ------- | ---------------------------------------------- |
| `PIXELGPU_SIMULATION_SPEED`           | `1`     | e.g. `10` to make everything 10× faster        |
| `PIXELGPU_SCHEDULER_ENABLED`          | `true`  | `false` to keep every task queued              |
| `PIXELGPU_SCHEDULER_INTERVAL_SECONDS` | `1`     | Pass interval when nothing triggers one sooner |
| `PIXELGPU_TASK_TIMEOUT_SECONDS`       | `600`   | Simulated seconds before a task times out      |

To try a failure, submit an Echo whose message starts with `fail:` (e.g. `fail: disk on fire`).
The task fails with `workload_failed` and that message. To try an unschedulable task, set
"Min memory" above 24 GiB.

## Database

Local development uses SQLite at `backend/pixelgpu.db` (gitignored). The backend applies
pending migrations when it starts, so normally there's nothing to do.

```bash
make migrate                                   # apply migrations by hand
rm backend/pixelgpu.db                         # reset: start with an empty task history
cd backend && uv run alembic revision --autogenerate -m "describe change"   # new migration
```

After adding a migration, review the generated file. `tests/test_migrations.py` fails if
the migrations and the ORM models disagree.

Tests and browser tests always use their own temporary databases.

## Quality checks

```bash
make test        # pytest + vitest
make lint        # ruff check/format, eslint, prettier
make typecheck   # mypy --strict, tsc strict
make build       # vite production build
make check       # all of the above
make format      # auto-fix formatting
```

Tests are deterministic and never touch the network or hardware: frontend tests stub `fetch`
and replace the Phaser canvas with a stub, and backend tests use FastAPI's in-process `TestClient`.

### Browser tests (Playwright)

```bash
make install-browsers   # once: downloads Chromium
make e2e                # starts its own backend (:8765) and frontend (:5199)
```

Chromium needs some system libraries. On Debian/Ubuntu:

```bash
cd frontend && sudo npx playwright install-deps chromium
```

On a minimal WSL Ubuntu, the missing ones are typically `libnspr4`, `libnss3` and `libasound2t64`.

The browser tests use a fresh temporary database. They click real canvas coordinates (computed with the same `facility/layout.ts`
the scene uses), check every visual state, block Phaser to exercise the fallback, check
reduced-motion and phone-width layouts, and submit, reload and cancel real tasks.

## Troubleshooting

- **"Backend offline" in the UI.** Check that the backend is running on port 8000, or set
  `PIXELGPU_BACKEND_URL` to wherever it runs.
- **Port 5173 already in use.** Vite runs with `strictPort`, so stop the other process rather
  than letting Vite switch ports silently.
- **`make dev` says dependencies are missing.** Run `make install`.
- **"Address already in use" but nothing seems to be running.** A previous `make dev` may be
  suspended (Ctrl+Z instead of Ctrl+C). Run `jobs` in that terminal and `fg` it, then Ctrl+C.
  Or find it with `ps -eo pid,stat,cmd | grep -E "pixelgpu|vite"` (state `T` = stopped).
- **The facility shows "couldn't start".** The browser console has the error. The roster and
  inspector keep working without the scene.

## Optional hardware

Not applicable until Phase 5 (NVIDIA discovery). The app will always start without a GPU.
