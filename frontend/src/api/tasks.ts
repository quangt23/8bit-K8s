import { ApiError, apiGet, apiPost } from "./client";

/** Types mirror backend/src/pixelgpu/tasks/{schemas,workloads}.py. */

export type TaskStatus = "queued" | "scheduled" | "running" | "succeeded" | "failed" | "cancelled";
export const TASK_STATUSES: readonly TaskStatus[] = [
  "queued",
  "scheduled",
  "running",
  "succeeded",
  "failed",
  "cancelled",
];
export const ACTIVE_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "queued",
  "scheduled",
  "running",
]);

export type WorkloadSpec =
  | { type: "echo"; message: string }
  | { type: "text_summary"; text: string; max_sentences: number }
  | {
      type: "sample_inference";
      model: "pixel-tiny-1b" | "pixel-small-7b";
      prompt: string;
      max_tokens: number;
    }
  | { type: "benchmark"; duration_seconds: number; matrix_size: 1024 | 2048 | 4096 | 8192 };

export type WorkloadType = WorkloadSpec["type"];

export interface WorkloadInfo {
  type: string;
  label: string;
  description: string;
  config_schema: Record<string, unknown>;
}

export interface TaskEvent {
  id: number;
  timestamp: string;
  kind: "status" | "log";
  level: "info" | "warning" | "error";
  message: string;
  from_status: TaskStatus | null;
  to_status: TaskStatus | null;
  data: Record<string, unknown> | null;
}

export interface Task {
  id: string;
  prompt: string | null;
  workload: WorkloadSpec;
  min_memory_mb: number;
  status: TaskStatus;
  queue_position: number | null;
  created_at: string;
  updated_at: string;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  cancel_requested_at: string | null;
  assigned_worker_id: string | null;
  assigned_gpu_id: string | null;
  progress: number | null;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  scheduler_decision: Record<string, unknown> | null;
}

export interface TaskDetail extends Task {
  events: TaskEvent[];
}

export interface TaskCreate {
  prompt?: string;
  workload: WorkloadSpec;
  resources?: { min_memory_mb?: number };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function isTask(v: unknown): v is Task {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    isObject(v.workload) &&
    typeof v.workload.type === "string" &&
    typeof v.min_memory_mb === "number" &&
    TASK_STATUSES.includes(v.status as TaskStatus) &&
    typeof v.created_at === "string"
  );
}

function isTaskDetail(v: unknown): v is TaskDetail {
  return isTask(v) && Array.isArray((v as unknown as Record<string, unknown>).events);
}

function expect<T>(body: unknown, guard: (v: unknown) => v is T, what: string): T {
  if (!guard(body)) throw new ApiError(`Backend ${what} response had an unexpected shape.`);
  return body;
}

export async function listTasks(signal?: AbortSignal): Promise<{ tasks: Task[]; total: number }> {
  const body = await apiGet("/tasks?limit=100", { signal });
  return expect(
    body,
    (v): v is { tasks: Task[]; total: number } =>
      isObject(v) && Array.isArray(v.tasks) && v.tasks.every(isTask) && typeof v.total === "number",
    "task list",
  );
}

export async function getTask(id: string, signal?: AbortSignal): Promise<TaskDetail> {
  return expect(await apiGet(`/tasks/${encodeURIComponent(id)}`, { signal }), isTaskDetail, "task");
}

export async function createTask(request: TaskCreate): Promise<Task> {
  return expect(await apiPost("/tasks", request), isTask, "task");
}

export async function cancelTask(id: string): Promise<Task> {
  return expect(await apiPost(`/tasks/${encodeURIComponent(id)}/cancel`), isTask, "task");
}

export async function listWorkloads(signal?: AbortSignal): Promise<WorkloadInfo[]> {
  return expect(
    await apiGet("/workloads", { signal }),
    (v): v is WorkloadInfo[] =>
      Array.isArray(v) &&
      v.every((w) => isObject(w) && typeof w.type === "string" && typeof w.label === "string"),
    "workload catalog",
  );
}
