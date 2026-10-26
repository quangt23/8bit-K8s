# Architecture

_Current as of Phase 2. Sections marked **planned** describe intent, not implemented code._

## Components

```
Browser ──► Vite dev server (:5173) ──/api proxy──► FastAPI (:8000) ──► SQLite (pixelgpu.db)
            React UI                                 pixelgpu.main:create_app   via SQLAlchemy
```

### Backend (`backend/src/pixelgpu`)

| Module               | Responsibility                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `main.py`            | `create_app(settings)` factory: routers, CORS, `app.state.settings`                               |
| `config.py`          | `Settings` (pydantic-settings), env prefix `PIXELGPU_`                                            |
| `api/deps.py`        | Shared dependencies (`SettingsDep` reads the app's own settings)                                  |
| `api/health.py`      | `GET /api/health`                                                                                 |
| `api/fleet.py`       | `GET /api/fleet`, `/api/workers`, `/api/gpus`, `/api/gpus/{id}`                                   |
| `fleet/models.py`    | `Worker`, `GpuDevice`, `Metric` (value + provenance), enums                                       |
| `fleet/simulated.py` | The fixed simulated fleet (6 GPUs, 2 workers)                                                     |
| `fleet/registry.py`  | In-memory `FleetRegistry`: the backend's source of truth for fleet state                          |
| `api/tasks.py`       | `POST/GET /api/tasks`, `GET /api/tasks/{id}`, `POST /api/tasks/{id}/cancel`, `GET /api/workloads` |
| `api/errors.py`      | One error envelope for every failure; maps domain errors to HTTP codes                            |
| `db.py`              | Engine and sessions, `UTCDateTime`, `upgrade_database()`                                          |
| `migrations/`        | Alembic environment and versioned migrations (shipped inside the package)                         |
| `tasks/workloads.py` | The workload allowlist: typed, `extra="forbid"` specs and their memory minimums                   |
| `tasks/lifecycle.py` | `TaskStatus` and the allowed-transition table                                                     |
| `tasks/models.py`    | ORM: `tasks` and `task_events`                                                                    |
| `tasks/service.py`   | `TaskService`: create, list, get, cancel, and `transition()` (compare-and-swap)                   |
| `__main__.py`        | `python -m pixelgpu` runs uvicorn with settings from the environment                              |

All routes live under `/api`, so one reverse-proxy rule serves the API and the static frontend
can share an origin.

### Frontend (`frontend/src`)

| Path                             | Responsibility                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `api/client.ts`                  | `apiGet`, `ApiError`; base URL defaults to same-origin `/api`                       |
| `api/fleet.ts`                   | Fleet types mirroring the backend, plus runtime shape validation                    |
| `hooks/useFleet.ts`              | Loads and polls `/api/fleet`; keeps last snapshot on refresh errors                 |
| `fleet/gpuState.ts`              | `gpuVisualState()`: health + activity → one visual state; labels, lamp colours      |
| `facility/layout.ts`             | Pure, deterministic rack/slot placement in scene pixels                             |
| `facility/FacilityScene.ts`      | Phaser scene: draws the room, racks and GPU boards from a model                     |
| `facility/createFacilityGame.ts` | Boots Phaser (lazy-loaded chunk)                                                    |
| `facility/FacilityCanvas.tsx`    | React host for the game; pushes the model in, forwards clicks out                   |
| `facility/FacilityPanel.tsx`     | Loading, empty, error and scene-failure states; legend                              |
| `components/Inspector.tsx`       | Selected GPU details with provenance tags                                           |
| `components/FleetRoster.tsx`     | Accessible list of all GPUs (keyboard / screen-reader route)                        |
| `art/`                           | Original character-map sprites, rendered as SVG (React) or canvas textures (Phaser) |

#### React ↔ Phaser data flow

```
/api/fleet ──► useFleet (React state) ──► FacilityModel {gpus, workers, selectedGpuId, reducedMotion}
                    │                                 │ setModel()
                    ▼                                 ▼
          Inspector, FleetRoster              FacilityScene (render only)
                    ▲                                 │ onSelectGpu(id)
                    └──────── selectedGpuId ◄─────────┘
```

React is the single source of truth. The scene never fetches or mutates data: it renders
the model it is given and reports clicks. Selecting a GPU anywhere (scene or roster) updates
React state, which flows back into both.

The scene derives the transient **completed** flash itself (`running` → `idle` on a healthy
device). It is never a backend value.

## Decisions

- **Vite proxy instead of CORS in development.** The browser talks to one origin; CORS is off
  unless `PIXELGPU_CORS_ORIGINS` is set.
- **Settings injected per app instance.** Tests build apps with their own `Settings` rather
  than mutating globals.
- **Plain CSS with design tokens, not Tailwind.** The pixel look relies on stepped box-shadows,
  sprite palettes and a 4px grid that read more clearly as named CSS rules than as utility
  classes. Revisit if component count makes this hard to maintain.
- **Fonts are bundled** via `@fontsource` (Silkscreen for headings, JetBrains Mono for data,
  system UI for prose). No external URLs are needed to render the UI.
- **Runtime validation at the API boundary.** The frontend checks response shapes rather than
  trusting a cast.
- **Synchronous SQLAlchemy.** FastAPI runs sync endpoints in a thread pool, which is simple and
  enough for local scale. Revisit if the scheduler or live updates need async I/O.
- **TypeScript pinned to 6.0.x** because `typescript-eslint` does not yet support TS 7.
- **Fleet state is still in memory (tasks are in the database).** `FleetRegistry` is the seam: the scheduler's
  reservations will move it into the database in Phase 3 without changing the API.
- **Health and activity are separate fields.** Health says whether a device can be used.
  Activity says what it is doing. The UI derives one visual state, with health taking priority.
- **Provenance on every metric.** `Metric.source` is `simulated`, `measured` or `unavailable`,
  and the backend rejects a value whose source is `unavailable`.
- **Phaser is lazy-loaded.** The UI renders first. If the scene can't start, a fallback
  replaces it and the roster still works.
- **Phaser 4** dropped `textures.generate`, so sprites are rasterised with `spriteToCanvas`
  and registered with `textures.addCanvas`.
- **The canvas is `aria-hidden`.** The fleet roster is the accessible equivalent, with text
  state labels and `aria-pressed` selection.

## Tasks

```
TaskCreate ──validate (allowlist, extra=forbid)──► TaskService.create ──► tasks + task_events
                                                                          │
GET /api/tasks/{id} ◄── task + events (timeline and logs) ◄───────────────┘
```

- **Prompt vs workload.** `prompt` is free text kept for context; `workload` is a validated,
  typed spec. Only the workload ever runs. The terminal shows the exact spec before you submit.
- **One table for history.** `task_events` holds both status transitions (`kind=status`) and
  log lines (`kind=log`), so the timeline and logs share ordering and storage.
- **Transitions are compare-and-swap.** `UPDATE … WHERE id = ? AND status = <expected>`; if
  no row changes, someone else moved the task first and the caller gets `InvalidTransitionError`.
  The Phase 3 scheduler relies on this for reservations.
- **Cancellation.** Not-yet-running tasks are cancelled immediately. Running tasks get
  `cancel_requested_at`, and the worker finishes the transition.
- **Migrations at startup.** With `PIXELGPU_AUTO_MIGRATE=true` (the default), the app applies
  pending Alembic migrations in its lifespan. A test checks that the migrations match the ORM models.
- **Timestamps are always UTC-aware.** `UTCDateTime` refuses naive datetimes and restores the
  timezone that SQLite drops.

## Planned

- **Phase 3:** Scheduler, queue, worker and telemetry interfaces with simulated workers.
- **Phase 4:** WebSocket live updates.

See [ROADMAP.md](ROADMAP.md).
