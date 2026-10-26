import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { SchedulingDecision } from "./api/tasks";
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

const terminal = () => within(screen.getByRole("region", { name: "Command terminal" }));
const taskList = () => within(screen.getByRole("region", { name: "Tasks" }));
const inspector = () => within(screen.getByRole("complementary"));
const posts = () => backend.requests.filter((r) => r.method === "POST" && r.path === "/api/tasks");

async function renderApp() {
  render(<App />);
  await terminal().findByRole("radio", { name: "Echo" });
}

describe("command terminal", () => {
  it("offers exactly the workloads the backend supports", async () => {
    await renderApp();

    const options = terminal()
      .getAllByRole("radio")
      .map((r) => r.closest("label")?.textContent);
    expect(options).toEqual(["Echo", "Summarize text", "Sample inference", "GPU benchmark"]);
    expect(terminal().getByRole("radio", { name: "Echo" })).toBeChecked();
  });

  it("previews the exact workload spec, separately from the note", async () => {
    await renderApp();

    await userEvent.type(terminal().getByLabelText("Message"), "hello pixels");
    await userEvent.type(terminal().getByLabelText("Note (optional)"), "just testing");

    const spec = terminal().getByLabelText("Workload specification");
    expect(JSON.parse(spec.textContent ?? "")).toEqual({ type: "echo", message: "hello pixels" });
    expect(spec.textContent).not.toContain("just testing");
  });

  it("submits a task, lists it as queued and opens it in the inspector", async () => {
    await renderApp();

    await userEvent.click(terminal().getByRole("radio", { name: "GPU benchmark" }));
    await userEvent.clear(terminal().getByLabelText("Duration (s)"));
    await userEvent.type(terminal().getByLabelText("Duration (s)"), "45");
    await userEvent.type(terminal().getByLabelText("Min memory (GiB)"), "8");
    await userEvent.type(terminal().getByLabelText("Note (optional)"), "warm-up run");
    await userEvent.click(terminal().getByRole("button", { name: "Submit ▶" }));

    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.body).toEqual({
      prompt: "warm-up run",
      workload: { type: "benchmark", duration_seconds: 45, matrix_size: 4096 },
      resources: { min_memory_mb: 8192 },
    });

    expect(await terminal().findByText(/task 000000 queued \(#1 in queue\)/)).toBeInTheDocument();
    expect(
      await taskList().findByRole("button", { name: /Queued.*GPU benchmark/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(await inspector().findByText("warm-up run")).toBeInTheDocument();
    expect(inspector().getByText("Saved for context. Never executed.")).toBeInTheDocument();
    expect(inspector().getByText("8 GiB")).toBeInTheDocument();
    expect(inspector().getByText(/the scheduler hasn't looked at it yet/)).toBeInTheDocument();
    expect(inspector().getByText("Task accepted and queued.")).toBeInTheDocument();
  });

  it("catches obvious mistakes in the browser without calling the backend", async () => {
    await renderApp();

    await userEvent.click(terminal().getByRole("radio", { name: "Summarize text" }));
    await userEvent.type(terminal().getByLabelText("Text to summarize"), "too short");
    await userEvent.click(terminal().getByRole("button", { name: "Submit ▶" }));

    expect(terminal().getByText("At least 20 characters.")).toBeInTheDocument();
    expect(terminal().getByLabelText("Text to summarize")).toHaveAttribute("aria-invalid", "true");
    expect(posts()).toHaveLength(0);
  });

  it("shows the backend's validation errors on the matching field", async () => {
    await renderApp();
    backend.rejectNextCreate = {
      message: "The request is invalid. See details.",
      field: "workload.message",
      detail: "String should have at most 500 characters",
    };

    await userEvent.type(terminal().getByLabelText("Message"), "hi");
    await userEvent.click(terminal().getByRole("button", { name: "Submit ▶" }));

    expect(await terminal().findByRole("alert")).toHaveTextContent("The request is invalid.");
    expect(terminal().getByText("String should have at most 500 characters")).toBeInTheDocument();
    expect(terminal().getByLabelText("Message")).toHaveAttribute("aria-invalid", "true");
  });

  it("explains when the workload catalog can't load", async () => {
    backend.catalog = null;
    render(<App />);

    expect(await terminal().findByRole("alert")).toHaveTextContent(
      "Couldn't load supported workloads",
    );
  });
});

describe("tasks", () => {
  it("shows task history from the backend on load (survives a page refresh)", async () => {
    backend.addTask({ prompt: "from before the refresh" });
    backend.addTask({ status: "succeeded", result: { echo: "seeded" } });
    await renderApp();

    const rows = await taskList().findAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Succeeded.*Echo/),
      expect.stringMatching(/Queued.*Echo.*from before the refresh.*#1/),
    ]);
    expect(taskList().getByText("2 total")).toBeInTheDocument();
  });

  it("shows an empty state when there are no tasks", async () => {
    await renderApp();

    expect(await taskList().findByText(/No tasks yet/)).toBeInTheDocument();
  });

  it("cancels a queued task and offers to run it again", async () => {
    const task = backend.addTask({ prompt: "cancel me" });
    await renderApp();
    await userEvent.click(await taskList().findByRole("button", { name: /cancel me/ }));

    await userEvent.click(await inspector().findByRole("button", { name: "Cancel task" }));

    expect(await inspector().findByText("Cancelled by user.")).toBeInTheDocument();
    expect(inspector().getByText("Cancelled before it started running.")).toBeInTheDocument();
    expect(backend.tasks[0]!.status).toBe("cancelled");
    await waitFor(() =>
      expect(taskList().getByRole("button", { name: /Cancelled.*cancel me/ })).toBeInTheDocument(),
    );

    await userEvent.click(inspector().getByRole("button", { name: "Run again" }));

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({
      prompt: "cancel me",
      workload: task.workload,
      resources: { min_memory_mb: task.min_memory_mb },
    });
    // The inspector switches to the new task.
    expect(await inspector().findByText(backend.tasks[1]!.id)).toBeInTheDocument();
    expect(backend.tasks[1]!.status).toBe("queued");
  });

  it("does not offer cancel for finished tasks", async () => {
    backend.addTask({ status: "succeeded", result: { echo: "seeded" } });
    await renderApp();
    await userEvent.click(await taskList().findByRole("button", { name: /Succeeded/ }));

    expect(await inspector().findByText("Result")).toBeInTheDocument();
    expect(inspector().queryByRole("button", { name: /Cancel/ })).not.toBeInTheDocument();
  });

  it("highlights the assigned GPU in the scene when a task is selected", async () => {
    backend.addTask({
      status: "running",
      assigned_gpu_id: "GPU-03",
      assigned_worker_id: "sim-worker-a",
    });
    await renderApp();

    await userEvent.click(await taskList().findByRole("button", { name: /Running/ }));

    expect(screen.getByTestId("scene")).toHaveAttribute("data-selected", "GPU-03");
    await userEvent.click(await inspector().findByRole("button", { name: "GPU-03" }));
    expect(inspector().getByRole("heading", { name: "GPU-03" })).toBeInTheDocument();
  });
});

const decision = (overrides: Partial<SchedulingDecision> = {}): SchedulingDecision => ({
  outcome: "scheduled",
  policy: "best_fit_memory",
  decided_at: "2026-10-25T12:00:05Z",
  workload_type: "echo",
  min_memory_mb: 512,
  selected_gpu_id: "GPU-05",
  selected_worker_id: "sim-worker-b",
  candidates: [
    {
      gpu_id: "GPU-01",
      worker_id: "sim-worker-a",
      memory_total_mb: 24576,
      eligible: true,
      reason: null,
    },
    {
      gpu_id: "GPU-04",
      worker_id: "sim-worker-a",
      memory_total_mb: 16384,
      eligible: false,
      reason: "Device is reporting an error: Simulated fault.",
    },
    {
      gpu_id: "GPU-05",
      worker_id: "sim-worker-b",
      memory_total_mb: 8192,
      eligible: true,
      reason: null,
    },
  ],
  explanation: "Picked GPU-05: the smallest free GPU with at least 512 MiB (8 GiB, best fit).",
  ...overrides,
});

describe("scheduling", () => {
  it("shows the backend's decision, with every GPU it considered", async () => {
    backend.addTask({
      status: "running",
      assigned_gpu_id: "GPU-05",
      assigned_worker_id: "sim-worker-b",
      progress: 0.4,
      scheduler_decision: decision(),
    });
    await renderApp();
    await userEvent.click(await taskList().findByRole("button", { name: /Running/ }));

    const panel = within(await inspector().findByRole("region", { name: /Scheduler decision/ }));
    expect(panel.getByText(/Picked GPU-05: the smallest free GPU/)).toBeInTheDocument();
    expect(panel.getByText("best_fit_memory")).toBeInTheDocument();
    const rows = within(panel.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      "GPU-0124 GiBEligible",
      "GPU-0416 GiBDevice is reporting an error: Simulated fault.",
      "GPU-058 GiB✓ Selected",
    ]);
    expect(inspector().getByRole("progressbar", { name: "Task progress" })).toHaveAttribute(
      "aria-valuenow",
      "40",
    );
    expect(taskList().getByRole("button", { name: /Running/ })).toHaveTextContent("GPU-05 40%");

    await userEvent.click(panel.getByRole("button", { name: "GPU-04" }));
    expect(inspector().getByRole("heading", { name: "GPU-04" })).toBeInTheDocument();
  });

  it("explains why a task is still waiting", async () => {
    backend.addTask({
      scheduler_decision: decision({
        outcome: "waiting",
        selected_gpu_id: null,
        selected_worker_id: null,
        explanation: "Waiting for a GPU. GPU-05: Busy with task_other.",
      }),
    });
    await renderApp();
    await userEvent.click(await taskList().findByRole("button", { name: /Queued/ }));

    expect(await inspector().findByText("Scheduler decision · Waiting")).toBeInTheDocument();
    expect(
      inspector().getByText("Waiting for a GPU. GPU-05: Busy with task_other."),
    ).toBeInTheDocument();
    expect(inspector().getByText("Waiting in queue (#1).")).toBeInTheDocument();
  });

  it("links a busy GPU to its task and lists its recent workloads", async () => {
    backend.fleet!.gpus[4] = {
      ...backend.fleet!.gpus[4]!,
      activity: "running",
      current_task_id: "task_0000000000000002",
    };
    backend.addTask({ status: "succeeded", assigned_gpu_id: "GPU-05" });
    backend.addTask({ status: "running", assigned_gpu_id: "GPU-05", prompt: "the current one" });
    await renderApp();

    await userEvent.click(screen.getByRole("button", { name: "scene:GPU-05" }));
    const history = within(await inspector().findByRole("region", { name: "Recent workloads" }));
    expect(await history.findAllByRole("button")).toHaveLength(2);

    await userEvent.click(inspector().getByRole("button", { name: "task_0000000000000002" }));
    expect(await inspector().findByText("the current one")).toBeInTheDocument();
  });
});
