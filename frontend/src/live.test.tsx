import { act, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";

import App from "./App";
import { FakeBackend } from "./test/fakeBackend";

vi.mock("./facility/FacilityCanvas", async () => ({
  FacilityCanvas: (await import("./test/sceneStub")).FacilityCanvasStub,
}));

let backend: FakeBackend;

beforeEach(() => {
  backend = new FakeBackend();
  backend.install();
});

const taskList = () => within(screen.getByRole("region", { name: "Tasks" }));
const feed = () => within(screen.getByRole("region", { name: "Activity" }));
const snapshotFetches = () =>
  backend.requests.filter((r) => r.path === "/api/live/snapshot").length;

async function renderLive() {
  render(<App />);
  await screen.findByText("Live");
  await screen.findByTestId("scene");
}

describe("live updates", () => {
  it("shows backend changes as soon as they're announced, without polling", async () => {
    await renderLive();
    const before = snapshotFetches();

    backend.addTask({ prompt: "made elsewhere" });
    act(() => backend.announce());

    expect(await taskList().findByRole("button", { name: /made elsewhere/ })).toBeInTheDocument();
    expect(snapshotFetches()).toBe(before + 1);
    expect(feed().getByText("Task accepted and queued.")).toBeInTheDocument();
  });

  it("ignores notifications it has already caught up with", async () => {
    await renderLive();
    const before = snapshotFetches();

    act(() => {
      for (const socket of backend.sockets)
        socket.receive({ type: "changed", revision: backend.revision });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(snapshotFetches()).toBe(before);
  });

  it("coalesces a burst of notifications into at most two fetches", async () => {
    await renderLive();
    const before = snapshotFetches();

    act(() => {
      for (let i = 0; i < 10; i++) backend.announce();
    });
    await waitFor(() => expect(snapshotFetches()).toBeGreaterThan(before));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(snapshotFetches() - before).toBeLessThanOrEqual(2);
  });

  it("reconnects after a disconnect and recovers what it missed, without duplicates", async () => {
    backend.addTask({ prompt: "before the outage" });
    await renderLive();

    act(() => {
      backend.offline = true;
      backend.disconnectAll();
    });
    expect(await screen.findByText(/Reconnecting \(try 1\)/)).toBeInTheDocument();

    backend.offline = false;
    backend.addTask({ prompt: "during the outage" });

    expect(await screen.findByText("Live", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(
      await taskList().findByRole("button", { name: /during the outage/ }),
    ).toBeInTheDocument();
    const queued = feed().getAllByText("Task accepted and queued.");
    expect(queued).toHaveLength(2); // one per task, none repeated
  });

  it("shows orchestration metrics from the snapshot", async () => {
    backend.addTask();
    backend.addTask({ status: "succeeded" });
    await renderLive();

    const metrics = within(screen.getByRole("region", { name: "Orchestration metrics" }));
    expect(metrics.getByText("Queued").nextSibling).toHaveTextContent("1");
    expect(metrics.getByText("GPUs allocated").nextSibling).toHaveTextContent("0 / 4");
  });

  it("opens a task from the activity feed", async () => {
    backend.addTask({ prompt: "from the feed" });
    await renderLive();

    act(() =>
      feed()
        .getByRole("button", { name: /Queued Echo/ })
        .click(),
    );

    expect(
      await within(screen.getByRole("complementary")).findByText("from the feed"),
    ).toBeInTheDocument();
  });
});
