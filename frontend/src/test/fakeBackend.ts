import { vi } from "vitest";

import type { FleetSnapshot } from "../api/fleet";
import type { Task, TaskCreate, TaskDetail, TaskEvent, WorkloadInfo } from "../api/tasks";
import { jsonResponse } from "./fetch";
import { simulatedFleet } from "./fleetFixture";

export const CATALOG: WorkloadInfo[] = [
  {
    type: "echo",
    label: "Echo",
    description: "Diagnostic: returns the message unchanged.",
    config_schema: {},
  },
  {
    type: "text_summary",
    label: "Summarize text",
    description: "Condenses a passage.",
    config_schema: {},
  },
  {
    type: "sample_inference",
    label: "Sample inference",
    description: "Sample model.",
    config_schema: {},
  },
  {
    type: "benchmark",
    label: "GPU benchmark",
    description: "Matrix multiplications.",
    config_schema: {},
  },
];

const MIN_MEMORY: Record<string, number> = {
  echo: 512,
  text_summary: 2048,
  sample_inference: 4096,
  benchmark: 4096,
};

/**
 * An in-memory stand-in for the backend's HTTP API, enough to drive the UI in tests.
 * It mirrors the real API's shapes and error envelope, not its full validation.
 */
export class FakeBackend {
  fleet: FleetSnapshot | null = simulatedFleet();
  catalog: WorkloadInfo[] | null = CATALOG;
  tasks: TaskDetail[] = [];
  offline = false;
  /** Return this error envelope (status 422) for the next POST /api/tasks. */
  rejectNextCreate: { message: string; field: string; detail: string } | null = null;
  readonly requests: { method: string; path: string; body: unknown }[] = [];
  private clock = Date.parse("2026-10-25T12:00:00Z");

  install() {
    const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => this.handle(input, init));
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  addTask(overrides: Partial<TaskDetail> = {}): TaskDetail {
    const created = this.create({ workload: { type: "echo", message: "seeded" } });
    Object.assign(created, overrides);
    return created;
  }

  private now(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private event(task: TaskDetail, event: Partial<TaskEvent>): void {
    task.events.push({
      id: task.events.length + 1,
      timestamp: this.now(),
      kind: "log",
      level: "info",
      message: "",
      from_status: null,
      to_status: null,
      data: null,
      ...event,
    });
  }

  private positions(): Map<string, number> {
    const queued = this.tasks.filter((t) => t.status === "queued");
    return new Map(queued.map((t, i) => [t.id, i + 1]));
  }

  private summary(task: TaskDetail): Task {
    const { events: _events, ...rest } = task;
    void _events;
    return { ...rest, queue_position: this.positions().get(task.id) ?? null };
  }

  private create(body: TaskCreate): TaskDetail {
    const now = this.now();
    const workload = body.workload;
    const task: TaskDetail = {
      id: `task_${String(this.tasks.length + 1).padStart(16, "0")}`,
      prompt: body.prompt ?? null,
      workload,
      min_memory_mb: Math.max(MIN_MEMORY[workload.type] ?? 0, body.resources?.min_memory_mb ?? 0),
      status: "queued",
      queue_position: null,
      created_at: now,
      updated_at: now,
      scheduled_at: null,
      started_at: null,
      finished_at: null,
      cancel_requested_at: null,
      assigned_worker_id: null,
      assigned_gpu_id: null,
      progress: null,
      result: null,
      error: null,
      scheduler_decision: null,
      events: [],
    };
    this.event(task, { kind: "status", to_status: "queued", message: "Task accepted and queued." });
    this.tasks.push(task);
    return task;
  }

  private error(status: number, code: string, message: string, details: unknown[] = []) {
    return jsonResponse({ error: { code, message, details } }, status);
  }

  async handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input), "http://test");
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    const path = url.pathname;
    this.requests.push({ method, path, body });
    if (this.offline) throw new TypeError("Failed to fetch");

    if (method === "GET" && path === "/api/fleet") {
      return this.fleet ? jsonResponse(this.fleet) : this.error(500, "http_error", "boom");
    }
    if (method === "GET" && path === "/api/workloads") {
      return this.catalog ? jsonResponse(this.catalog) : this.error(500, "http_error", "boom");
    }
    if (method === "GET" && path === "/api/tasks") {
      const gpuId = url.searchParams.get("gpu_id");
      const newest = [...this.tasks]
        .reverse()
        .filter((t) => !gpuId || t.assigned_gpu_id === gpuId)
        .map((t) => this.summary(t));
      return jsonResponse({ tasks: newest, total: newest.length });
    }
    if (method === "POST" && path === "/api/tasks") {
      if (this.rejectNextCreate) {
        const { message, field, detail } = this.rejectNextCreate;
        this.rejectNextCreate = null;
        return this.error(422, "validation_error", message, [{ field, message: detail }]);
      }
      return jsonResponse(this.summary(this.create(body as TaskCreate)), 201);
    }

    const match = /^\/api\/tasks\/([^/]+)(\/cancel)?$/.exec(path);
    const task = match
      ? this.tasks.find((t) => t.id === decodeURIComponent(match[1] ?? ""))
      : undefined;
    if (match && !task) return this.error(404, "not_found", "Task not found.");
    if (task && method === "GET" && !match?.[2]) {
      return jsonResponse({ ...this.summary(task), events: task.events });
    }
    if (task && method === "POST" && match?.[2]) {
      if (!["queued", "scheduled"].includes(task.status)) {
        return this.error(
          409,
          "invalid_transition",
          `Task is already ${task.status} and cannot be cancelled.`,
        );
      }
      const from = task.status;
      task.status = "cancelled";
      task.finished_at = this.now();
      task.error = { code: "cancelled", message: "Cancelled by user." };
      this.event(task, {
        kind: "status",
        from_status: from,
        to_status: "cancelled",
        message: "Cancelled before it started running.",
      });
      return jsonResponse(this.summary(task));
    }
    return this.error(404, "not_found", "Not Found");
  }
}
