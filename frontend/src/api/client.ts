/**
 * Minimal typed HTTP client for the PixelGPU API.
 *
 * In development the Vite dev server proxies `/api` to the backend, so the
 * default base URL is same-origin. Set VITE_API_BASE_URL to call a backend
 * served elsewhere (the backend must then allow that origin via CORS).
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "/api";

export class ApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiGet(path: string, init?: { signal?: AbortSignal }): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Accept: "application/json" },
      signal: init?.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("Could not reach the PixelGPU backend.");
  }

  if (!response.ok) {
    throw new ApiError(`Backend responded with HTTP ${response.status}.`, response.status);
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ApiError("Backend returned a response that is not valid JSON.", response.status);
  }
}
