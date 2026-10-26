/**
 * Minimal typed HTTP client for the PixelGPU API.
 *
 * In development the Vite dev server proxies `/api` to the backend, so the
 * default base URL is same-origin. Set VITE_API_BASE_URL to call a backend
 * served elsewhere (the backend must then allow that origin via CORS).
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "/api";

export interface ApiErrorDetail {
  field: string | null;
  message: string;
}

export class ApiError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly details: ApiErrorDetail[];

  constructor(
    message: string,
    status: number | null = null,
    code = "client_error",
    details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Parse the backend's `{"error": {code, message, details}}` envelope, if present. */
function errorFromBody(status: number, body: unknown): ApiError {
  if (typeof body === "object" && body !== null && "error" in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === "object" && error !== null) {
      const e = error as Record<string, unknown>;
      if (typeof e.code === "string" && typeof e.message === "string") {
        const details = Array.isArray(e.details)
          ? e.details.filter(
              (d): d is ApiErrorDetail =>
                typeof d === "object" && d !== null && typeof d.message === "string",
            )
          : [];
        return new ApiError(e.message, status, e.code, details);
      }
    }
  }
  return new ApiError(`Backend responded with HTTP ${status}.`, status, "http_error");
}

async function request(
  method: "GET" | "POST",
  path: string,
  init: { signal?: AbortSignal; body?: unknown } = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("Could not reach the PixelGPU backend.", null, "network_error");
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (response.ok) {
      throw new ApiError("Backend returned a response that is not valid JSON.", response.status);
    }
  }
  if (!response.ok) throw errorFromBody(response.status, body);
  return body;
}

export function apiGet(path: string, init?: { signal?: AbortSignal }): Promise<unknown> {
  return request("GET", path, init);
}

export function apiPost(path: string, body?: unknown): Promise<unknown> {
  return request("POST", path, { body });
}
