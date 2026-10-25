import { ApiError, apiGet } from "./client";

/** Mirrors `HealthResponse` in backend/src/pixelgpu/api/health.py. */
export interface HealthResponse {
  status: "ok";
  service: string;
  version: string;
  environment: string;
  server_time: string;
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.status === "ok" &&
    typeof v.service === "string" &&
    typeof v.version === "string" &&
    typeof v.environment === "string" &&
    typeof v.server_time === "string"
  );
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const body = await apiGet("/health", { signal });
  if (!isHealthResponse(body)) {
    throw new ApiError("Backend health response had an unexpected shape.");
  }
  return body;
}
