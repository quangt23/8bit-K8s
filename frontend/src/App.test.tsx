import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import App from "./App";
import type { FacilityModel } from "./facility/FacilityScene";
import { jsonResponse, stubFetch } from "./test/fetch";
import { simulatedFleet } from "./test/fleetFixture";

// Phaser needs a real canvas, so the scene is replaced with a stub that exposes
// exactly what React hands it, plus a way to simulate clicks inside the scene.
const sceneControl = vi.hoisted(() => ({ fail: null as Error | null }));

vi.mock("./facility/FacilityCanvas", () => ({
  FacilityCanvas: ({
    model,
    onSelectGpu,
    onError,
  }: {
    model: FacilityModel;
    onSelectGpu: (id: string) => void;
    onError: (error: unknown) => void;
  }) => {
    if (sceneControl.fail) {
      queueMicrotask(() => onError(sceneControl.fail));
    }
    return (
      <div data-testid="scene" data-selected={model.selectedGpuId ?? ""}>
        {model.gpus.map((gpu) => (
          <button key={gpu.id} type="button" onClick={() => onSelectGpu(gpu.id)}>
            scene:{gpu.id}
          </button>
        ))}
      </div>
    );
  },
}));

beforeEach(() => {
  sceneControl.fail = null;
});

function roster() {
  return within(screen.getByRole("region", { name: "Fleet roster" }));
}

function inspector() {
  return within(screen.getByRole("complementary"));
}

async function renderLoaded() {
  stubFetch(async () => jsonResponse(simulatedFleet()));
  render(<App />);
  await screen.findByTestId("scene");
}

describe("control room", () => {
  it("shows a loading state before the fleet arrives", () => {
    stubFetch(() => new Promise(() => {}));
    render(<App />);

    expect(screen.getByText("Powering up the facility…")).toBeInTheDocument();
    expect(screen.getByText("Linking…")).toBeInTheDocument();
  });

  it("renders every backend GPU in both the scene and the roster", async () => {
    await renderLoaded();

    const ids = ["GPU-01", "GPU-02", "GPU-03", "GPU-04", "GPU-05", "GPU-06"];
    for (const id of ids) {
      expect(screen.getByRole("button", { name: `scene:${id}` })).toBeInTheDocument();
      expect(roster().getByRole("button", { name: new RegExp(id) })).toBeInTheDocument();
    }
    expect(screen.getByText("6 GPUs · 2 workers · all simulated")).toBeInTheDocument();
    expect(screen.getByText("API linked")).toBeInTheDocument();
  });

  it("starts with an empty inspector", async () => {
    await renderLoaded();

    expect(inspector().getByText(/Select a GPU/)).toBeInTheDocument();
  });

  it("selecting a GPU in the scene opens it in the inspector and the roster", async () => {
    await renderLoaded();

    await userEvent.click(screen.getByRole("button", { name: "scene:GPU-02" }));

    expect(inspector().getByRole("heading", { name: "GPU-02" })).toBeInTheDocument();
    expect(roster().getByRole("button", { name: /GPU-02/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("scene")).toHaveAttribute("data-selected", "GPU-02");
  });

  it("selecting a GPU in the roster highlights it in the scene", async () => {
    await renderLoaded();

    await userEvent.click(roster().getByRole("button", { name: /GPU-05/ }));

    expect(screen.getByTestId("scene")).toHaveAttribute("data-selected", "GPU-05");
    expect(inspector().getByRole("heading", { name: "GPU-05" })).toBeInTheDocument();
  });

  it("labels simulated values as simulated and missing values as unavailable", async () => {
    await renderLoaded();
    await userEvent.click(roster().getByRole("button", { name: /GPU-01/ }));

    expect(inspector().getByText("Simulated")).toBeInTheDocument();
    expect(inspector().getByText("Unavailable")).toBeInTheDocument();
    expect(
      inspector().getByText("Simulated workers do not model utilization."),
    ).toBeInTheDocument();
    expect(inspector().getByText("simulated")).toBeInTheDocument();
    expect(inspector().getByText("unavailable")).toBeInTheDocument();
    expect(inspector().getByText(/none \(in-process simulated worker\)/)).toBeInTheDocument();
    expect(inspector().getByRole("meter", { name: "Memory in use" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });

  it("explains why an errored GPU cannot be scheduled", async () => {
    await renderLoaded();
    await userEvent.click(roster().getByRole("button", { name: /GPU-04/ }));

    expect(inspector().getByText("Error")).toBeInTheDocument();
    expect(inspector().getByText(/failed its startup self-test/)).toBeInTheDocument();
    expect(inspector().getByText("No: Device is reporting an error.")).toBeInTheDocument();
  });

  it("shows offline GPUs without inventing memory usage", async () => {
    await renderLoaded();
    await userEvent.click(roster().getByRole("button", { name: /GPU-06/ }));

    expect(inspector().getByText("Offline")).toBeInTheDocument();
    expect(inspector().getByText("Device is offline.")).toBeInTheDocument();
    expect(inspector().queryByRole("meter")).not.toBeInTheDocument();
  });

  it("shows each GPU's state in the roster as text, not just colour", async () => {
    await renderLoaded();

    expect(roster().getByRole("button", { name: /GPU-01.*Idle/ })).toBeInTheDocument();
    expect(roster().getByRole("button", { name: /GPU-04.*Error/ })).toBeInTheDocument();
    expect(roster().getByRole("button", { name: /GPU-06.*Offline/ })).toBeInTheDocument();
  });

  it("shows an empty state when no GPUs are registered", async () => {
    stubFetch(async () =>
      jsonResponse({ workers: [], gpus: [], generated_at: "2026-10-25T12:00:00Z" }),
    );
    render(<App />);

    expect(await screen.findByText("No GPUs are registered.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Fleet roster" })).not.toBeInTheDocument();
  });

  it("shows an error with retry when the fleet cannot load, then recovers", async () => {
    const fetchMock = stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    render(<App />);

    expect(await screen.findByText(/Couldn't load the fleet/)).toBeInTheDocument();
    expect(screen.getByText("API offline")).toBeInTheDocument();

    fetchMock.mockImplementation(async () => jsonResponse(simulatedFleet()));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("scene")).toBeInTheDocument();
  });

  it("keeps the roster and inspector usable when the scene fails", async () => {
    sceneControl.fail = new Error("WebGL unavailable");
    stubFetch(async () => jsonResponse(simulatedFleet()));
    render(<App />);

    expect(await screen.findByText(/couldn't start \(WebGL unavailable\)/)).toBeInTheDocument();
    vi.spyOn(console, "error").mockImplementation(() => {});

    await userEvent.click(roster().getByRole("button", { name: /GPU-03/ }));
    expect(inspector().getByRole("heading", { name: "GPU-03" })).toBeInTheDocument();
  });
});
