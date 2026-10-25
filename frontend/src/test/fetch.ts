import { vi } from "vitest";

export const healthyBody = {
  status: "ok",
  service: "pixelgpu-backend",
  version: "0.1.0",
  environment: "test",
  server_time: "2026-10-25T12:00:00Z",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function stubFetch(impl: (input: RequestInfo | URL) => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal("fetch", mock);
  return mock;
}
