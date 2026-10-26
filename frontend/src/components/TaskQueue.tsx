import type { Task } from "../api/tasks";
import type { Resource } from "../hooks/usePolledResource";
import { formatTime, shortId } from "../tasks/taskStatus";
import { StatusPill } from "./StatusPill";

interface TaskQueueProps {
  tasks: Resource<{ tasks: Task[]; total: number }>;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onRetry: () => void;
  labelFor: (workloadType: string) => string;
}

export function TaskQueue({
  tasks,
  selectedTaskId,
  onSelectTask,
  onRetry,
  labelFor,
}: TaskQueueProps) {
  let body;
  if (tasks.kind === "loading") {
    body = (
      <p className="task-queue__empty" role="status">
        Loading tasks…
      </p>
    );
  } else if (tasks.kind === "failed") {
    body = (
      <div className="task-queue__empty" role="alert">
        <p>Couldn't load tasks: {tasks.error}</p>
        <button type="button" className="pixel-button" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  } else if (tasks.data.tasks.length === 0) {
    body = <p className="task-queue__empty">No tasks yet. Submit one from the command terminal.</p>;
  } else {
    body = (
      <ol className="task-queue__list">
        {tasks.data.tasks.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              className="task-row"
              aria-pressed={task.id === selectedTaskId}
              onClick={() => onSelectTask(task.id)}
            >
              <StatusPill status={task.status} />
              <span className="task-row__main">
                <span className="task-row__workload">{labelFor(task.workload.type)}</span>
                {task.prompt && <span className="task-row__note">{task.prompt}</span>}
              </span>
              <span className="task-row__meta">
                <code>{shortId(task.id)}</code>
                <span>
                  {task.queue_position ? `#${task.queue_position} · ` : ""}
                  <time dateTime={task.created_at}>{formatTime(task.created_at)}</time>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <section className="panel task-queue" aria-labelledby="task-queue-heading">
      <header className="task-queue__header">
        <h2 id="task-queue-heading" className="pixel-heading">
          Tasks
        </h2>
        {tasks.kind === "ready" && (
          <span className="task-queue__count">
            {tasks.data.total} total
            {tasks.data.total > tasks.data.tasks.length
              ? ` · showing ${tasks.data.tasks.length}`
              : ""}
          </span>
        )}
      </header>
      {body}
    </section>
  );
}
