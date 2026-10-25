import { healthyBody, jsonResponse, stubFetch } from "../test/fetch";
import { ApiError } from "./client";
import { fetchHealth } from "./health";

describe("fetchHealth", () => {
  it("returns the parsed health payload from /api/health", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(healthyBody));

    await expect(fetchHealth()).resolves.toEqual(healthyBody);
    expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.anything());
  });

  it("rejects payloads with an unexpected shape", async () => {
    stubFetch(async () => jsonResponse({ status: "maybe" }));

    await expect(fetchHealth()).rejects.toThrow(/unexpected shape/);
  });

  it("reports HTTP errors with their status code", async () => {
    stubFetch(async () => jsonResponse({ detail: "boom" }, 503));

    const error = await fetchHealth().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(503);
  });

  it("reports network failures as an unreachable backend", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(fetchHealth()).rejects.toThrow("Could not reach the PixelGPU backend.");
  });
});
