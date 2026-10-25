# API

Base path: `/api`. Interactive docs: `/api/docs`. OpenAPI schema: `/api/openapi.json`.

## `GET /api/health`

Liveness check. Requires no authentication and has no side effects.

**200 OK**

```json
{
  "status": "ok",
  "service": "pixelgpu-backend",
  "version": "0.1.0",
  "environment": "development",
  "server_time": "2026-10-25T23:49:07.394653Z"
}
```

| Field         | Type                                         | Notes               |
| ------------- | -------------------------------------------- | ------------------- |
| `status`      | `"ok"`                                       | Always `ok` when the server answers |
| `service`     | string                                       | Always `pixelgpu-backend` |
| `version`     | string                                       | Backend package version |
| `environment` | `"development"` \| `"test"` \| `"production"` | From `PIXELGPU_ENVIRONMENT` |
| `server_time` | ISO-8601 UTC timestamp                       |                     |

## Errors

Unknown routes return FastAPI's default `404 {"detail": "Not Found"}`. A structured error format
will be defined in Phase 2 alongside the task endpoints.

## Live updates

None yet. WebSocket updates are planned for Phase 4.
