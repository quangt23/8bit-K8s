import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import App from "./App";
import { FakeBackend } from "./test/fakeBackend";
import { sceneControl } from "./test/sceneStub";

vi.mock("./facility/FacilityCanvas", async () => ({
  FacilityCanvas: (await import("./test/sceneStub")).FacilityCanvasStub,
}));

let backend: FakeBackend;

beforeEach(() => {
  sceneControl.fail = null;
  backend = new FakeBackend();
  backend.install();
});

function roster() {
  return within(screen.getByRole("region", { name: "Fleet roster" }));
}

function inspector() {
  return within(screen.getByRole("complementary"));
}

async function renderLoaded() {
  render(<App />);
  await screen.findByTestId("scene");
}

describe("control room", () => {
  it("shows a loading state before the fleet arrives", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
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
    backend.fleet = { workers: [], gpus: [], generated_at: "2026-10-25T12:00:00Z" };
    render(<App />);

    expect(await screen.findByText("No GPUs are registered.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Fleet roster" })).not.toBeInTheDocument();
  });

  it("shows an error with retry when the fleet cannot load, then recovers", async () => {
    backend.offline = true;
    render(<App />);

    expect(await screen.findByText(/Couldn't load the fleet/)).toBeInTheDocument();
    expect(screen.getByText("API offline")).toBeInTheDocument();

    backend.offline = false;
    const facility = within(screen.getByRole("region", { name: "GPU facility" }));
    await userEvent.click(facility.getByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("scene")).toBeInTheDocument();
  });

  it("keeps the roster and inspector usable when the scene fails", async () => {
    sceneControl.fail = new Error("WebGL unavailable");
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<App />);

    expect(await screen.findByText(/couldn't start \(WebGL unavailable\)/)).toBeInTheDocument();

    await userEvent.click(roster().getByRole("button", { name: /GPU-03/ }));
    expect(inspector().getByRole("heading", { name: "GPU-03" })).toBeInTheDocument();
  });
});
