import type { TaskStatus } from "../api/tasks";
import { TASK_STATUS_LABELS } from "../tasks/taskStatus";

export function StatusPill({ status }: { status: TaskStatus }) {
  return <span className={`status-pill status-pill--${status}`}>{TASK_STATUS_LABELS[status]}</span>;
}
