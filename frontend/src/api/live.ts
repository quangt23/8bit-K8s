import type { FleetSnapshot } from "./fleet";
import { ApiError, API_BASE_URL, apiGet } from "./client";
import type { Task, TaskEvent, TaskStatus } from "./tasks";

/** Types mirror backend/src/pixelgpu/live/{feed,metrics}.py and api/live.py. */

export interface FeedEvent extends TaskEvent {
  task_id: string;
  workload_type: string;
  gpu_id: string | null;
}

export interface Metrics {
  generated_at: string;
  tasks_by_status: Record<TaskStatus, number>;
  gpus: { total: number; healthy: number; allocated: number };
  finished_last_5_minutes: number;
  recent: {
    sample_size: number;
    success_rate: number | null;
    median_queue_wait_seconds: number | null;
    median_run_seconds: number | null;
  };
}

export interface LiveSnapshot {
  generated_at: string;
  revision: number;
  fleet: FleetSnapshot;
  tasks: Task[];
  total_tasks: number;
  metrics: Metrics;
  events: FeedEvent[];
  latest_event_id: number;
  events_truncated: boolean;
}

function isSnapshot(v: unknown): v is LiveSnapshot {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.revision === "number" &&
    typeof s.fleet === "object" &&
    s.fleet !== null &&
    Array.isArray(s.tasks) &&
    Array.isArray(s.events) &&
    typeof s.latest_event_id === "number" &&
    typeof s.metrics === "object"
  );
}

export async function fetchSnapshot(
  eventsAfter?: number,
  signal?: AbortSignal,
): Promise<LiveSnapshot> {
  const query = eventsAfter === undefined ? "" : `?events_after=${eventsAfter}`;
  const body = await apiGet(`/live/snapshot${query}`, { signal });
  if (!isSnapshot(body)) throw new ApiError("Backend snapshot response had an unexpected shape.");
  return body;
}

/** WebSocket URL for live notifications, derived from the API base URL. */
export function liveSocketUrl(base = API_BASE_URL, location: Location = window.location): string {
  const absolute = new URL(`${base}/live`, location.href);
  absolute.protocol = absolute.protocol === "https:" ? "wss:" : "ws:";
  return absolute.toString();
}
