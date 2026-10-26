import { act, renderHook, waitFor } from "@testing-library/react";

import { jsonResponse, stubFetch } from "../test/fetch";
import { simulatedFleet } from "../test/fleetFixture";
import { useFleet } from "./useFleet";

describe("useFleet", () => {
  it("keeps the last snapshot and reports the error when a refresh fails", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(simulatedFleet()));
    const { result } = renderHook(() => useFleet(60_000));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    await act(() => result.current.reload());

    const state = result.current.state;
    expect(state.kind).toBe("ready");
    if (state.kind !== "ready") return;
    expect(state.data.gpus).toHaveLength(6);
    expect(state.error).toBe("Could not reach the PixelGPU backend.");
  });

  it("clears the error once the backend answers again", async () => {
    const fetchMock = stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { result } = renderHook(() => useFleet(60_000));
    await waitFor(() => expect(result.current.state.kind).toBe("failed"));

    fetchMock.mockImplementation(async () => jsonResponse(simulatedFleet()));
    await act(() => result.current.reload());

    expect(result.current.state).toMatchObject({ kind: "ready", error: null });
  });
});
