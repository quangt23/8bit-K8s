# Architecture

_Current as of Phase 0. Sections marked **planned** describe intent, not implemented code._

## Components

```
Browser ──► Vite dev server (:5173) ──/api proxy──► FastAPI (:8000)
            React UI                                 pixelgpu.main:create_app
```

### Backend (`backend/src/pixelgpu`)

| Module          | Responsibility                                                      |
| --------------- | ------------------------------------------------------------------- |
| `main.py`       | `create_app(settings)` factory: routers, CORS, `app.state.settings`  |
| `config.py`     | `Settings` (pydantic-settings), env prefix `PIXELGPU_`              |
| `api/deps.py`   | Shared dependencies (`SettingsDep` reads the app's own settings)     |
| `api/health.py` | `GET /api/health`                                                   |
| `__main__.py`   | `python -m pixelgpu` runs uvicorn with settings from the environment |

All routes live under `/api`, so one reverse-proxy rule serves the API and the static frontend
can share an origin.

### Frontend (`frontend/src`)

| Path                          | Responsibility                                            |
| ----------------------------- | --------------------------------------------------------- |
| `api/client.ts`               | `apiGet`, `ApiError`; base URL defaults to same-origin `/api` |
| `api/health.ts`               | Typed `HealthResponse` with a runtime shape check         |
| `hooks/useBackendHealth.ts`   | Polls health every 10 s, keeps last result while re-checking |
| `components/PixelSprite.tsx`  | Renders character-map sprites as crisp SVG                |
| `components/sprites.ts`       | Original sprite definitions                               |
| `styles/tokens.css`           | Colour, type and 4px pixel-grid tokens                    |

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

## Planned

- **Phase 1:** Phaser facility embedded in React. React owns GPU/task state, Phaser only renders it.
- **Phase 2:** SQLite via SQLAlchemy and Alembic, tasks and a lifecycle state machine.
- **Phase 3:** Scheduler, queue, worker and telemetry interfaces with simulated workers.
- **Phase 4:** WebSocket live updates.

See [ROADMAP.md](ROADMAP.md).
