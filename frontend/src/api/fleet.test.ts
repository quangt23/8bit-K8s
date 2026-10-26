import { jsonResponse, stubFetch } from "../test/fetch";
import { simulatedFleet } from "../test/fleetFixture";
import { ApiError } from "./client";
import { fetchFleet } from "./fleet";

describe("fetchFleet", () => {
  it("returns the snapshot from /api/fleet", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(simulatedFleet()));

    const fleet = await fetchFleet();

    expect(fleet.gpus.map((g) => g.id)).toEqual([
      "GPU-01",
      "GPU-02",
      "GPU-03",
      "GPU-04",
      "GPU-05",
      "GPU-06",
    ]);
    expect(fetchMock).toHaveBeenCalledWith("/api/fleet", expect.anything());
  });

  it("rejects a GPU with an unknown execution mode", async () => {
    const fleet = simulatedFleet();
    (fleet.gpus[0] as { execution_mode: string }).execution_mode = "quantum";
    stubFetch(async () => jsonResponse(fleet));

    await expect(fetchFleet()).rejects.toThrow(/unexpected shape/);
  });

  it("rejects a metric with an unknown source", async () => {
    const fleet = simulatedFleet();
    (fleet.gpus[0]!.utilization as { source: string }).source = "guessed";
    stubFetch(async () => jsonResponse(fleet));

    await expect(fetchFleet()).rejects.toThrow(/unexpected shape/);
  });

  it("reports HTTP errors with their status code", async () => {
    stubFetch(async () => jsonResponse({ detail: "boom" }, 503));

    const error = await fetchFleet().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(503);
  });

  it("reports network failures as an unreachable backend", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(fetchFleet()).rejects.toThrow("Could not reach the PixelGPU backend.");
  });
});
