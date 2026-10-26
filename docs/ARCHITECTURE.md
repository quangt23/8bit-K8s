# Architecture

_Current as of Phase 1. Sections marked **planned** describe intent, not implemented code._

## Components

```
Browser ──► Vite dev server (:5173) ──/api proxy──► FastAPI (:8000)
            React UI                                 pixelgpu.main:create_app
```

### Backend (`backend/src/pixelgpu`)

| Module               | Responsibility                                                           |
| -------------------- | ------------------------------------------------------------------------ |
| `main.py`            | `create_app(settings)` factory: routers, CORS, `app.state.settings`      |
| `config.py`          | `Settings` (pydantic-settings), env prefix `PIXELGPU_`                   |
| `api/deps.py`        | Shared dependencies (`SettingsDep` reads the app's own settings)         |
| `api/health.py`      | `GET /api/health`                                                        |
| `api/fleet.py`       | `GET /api/fleet`, `/api/workers`, `/api/gpus`, `/api/gpus/{id}`          |
| `fleet/models.py`    | `Worker`, `GpuDevice`, `Metric` (value + provenance), enums              |
| `fleet/simulated.py` | The fixed simulated fleet (6 GPUs, 2 workers)                            |
| `fleet/registry.py`  | In-memory `FleetRegistry`: the backend's source of truth for fleet state |
| `__main__.py`        | `python -m pixelgpu` runs uvicorn with settings from the environment     |

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
- **No database yet.** SQLAlchemy + Alembic arrive in Phase 2 with the first persisted models.
- **TypeScript pinned to 6.0.x** because `typescript-eslint` does not yet support TS 7.
- **Fleet state is in memory until Phase 2.** `FleetRegistry` is the seam: the database and
  the scheduler will sit behind it without changing the API.
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

## Planned

- **Phase 2:** SQLite via SQLAlchemy and Alembic, tasks and a lifecycle state machine.
- **Phase 3:** Scheduler, queue, worker and telemetry interfaces with simulated workers.
- **Phase 4:** WebSocket live updates.

See [ROADMAP.md](ROADMAP.md).
