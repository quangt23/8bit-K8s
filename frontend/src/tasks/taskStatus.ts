import type { TaskStatus } from "../api/tasks";

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  queued: "Queued",
  scheduled: "Scheduled",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function shortId(id: string): string {
  return id.replace(/^task_/, "").slice(0, 6);
}
