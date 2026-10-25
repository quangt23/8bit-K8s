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

| URL                            | What                         |
| ------------------------------ | ---------------------------- |
| http://localhost:5173          | Frontend                     |
| http://127.0.0.1:8000/api/health | Backend health             |
| http://localhost:5173/api/docs | API docs (via proxy)         |

## Configuration

Backend settings come from `PIXELGPU_*` environment variables or `backend/.env`. See
`.env.example` for the full list. `PIXELGPU_BACKEND_URL` changes where the Vite dev server
proxies `/api`.

## Quality checks

```bash
make test        # pytest + vitest
make lint        # ruff check/format, eslint, prettier
make typecheck   # mypy --strict, tsc strict
make build       # vite production build
make check       # all of the above
make format      # auto-fix formatting
```

Tests are deterministic and never touch the network or hardware: frontend tests stub `fetch`,
and backend tests use FastAPI's in-process `TestClient`.

## Troubleshooting

- **"Backend offline" in the UI.** Check that the backend is running on port 8000, or set
  `PIXELGPU_BACKEND_URL` to wherever it runs.
- **Port 5173 already in use.** Vite runs with `strictPort`, so stop the other process rather
  than letting Vite switch ports silently.
- **`make dev` says dependencies are missing.** Run `make install`.

## Optional hardware

Not applicable until Phase 5 (NVIDIA discovery). The app will always start without a GPU.
