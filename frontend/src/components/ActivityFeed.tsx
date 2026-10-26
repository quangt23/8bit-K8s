import type { FeedEvent } from "../api/live";
import { formatTime, shortId, TASK_STATUS_LABELS } from "../tasks/taskStatus";

interface ActivityFeedProps {
  events: FeedEvent[];
  onSelectTask: (taskId: string) => void;
  labelFor: (workloadType: string) => string;
}

function describe(event: FeedEvent): string {
  if (event.kind === "status" && event.to_status) return TASK_STATUS_LABELS[event.to_status];
  return event.level === "info" ? "Log" : event.level === "warning" ? "Warning" : "Error";
}

/** Every task event across the system, newest first. */
export function ActivityFeed({ events, onSelectTask, labelFor }: ActivityFeedProps) {
  const newestFirst = [...events].reverse();
  return (
    <section className="panel feed" aria-labelledby="feed-heading">
      <h2 id="feed-heading" className="pixel-heading">
        Activity
      </h2>
      {newestFirst.length === 0 ? (
        <p className="feed__empty">Nothing has happened yet.</p>
      ) : (
        <ol className="feed__list" aria-live="polite" aria-relevant="additions">
          {newestFirst.map((event) => (
            <li
              key={event.id}
              className={`feed__item feed__item--${event.to_status ?? event.level}`}
            >
              <time dateTime={event.timestamp}>{formatTime(event.timestamp)}</time>
              <button
                type="button"
                className="feed__task"
                onClick={() => onSelectTask(event.task_id)}
              >
                <span className="feed__what">{describe(event)}</span>{" "}
                {labelFor(event.workload_type)} <code>{shortId(event.task_id)}</code>
                {event.gpu_id && event.kind === "status" ? ` · ${event.gpu_id}` : ""}
              </button>
              <p className="feed__message">{event.message}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
