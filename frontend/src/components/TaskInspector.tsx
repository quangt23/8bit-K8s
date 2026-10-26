import { useState } from "react";

import { ApiError } from "../api/client";
import {
  ACTIVE_TASK_STATUSES,
  cancelTask,
  createTask,
  type Task,
  type TaskDetail,
} from "../api/tasks";
import { formatMemory } from "../fleet/gpuState";
import { useTaskDetail } from "../hooks/useTasks";
import { formatTime, TASK_STATUS_LABELS } from "../tasks/taskStatus";
import { SchedulingPanel } from "./SchedulingPanel";
import { StatusPill } from "./StatusPill";

interface TaskInspectorProps {
  taskId: string;
  labelFor: (workloadType: string) => string;
  onSelectGpu: (gpuId: string) => void;
  onTaskChanged: () => void;
  onRetried: (task: Task) => void;
}

function schedulingSummary(task: TaskDetail): string {
  if (task.status === "queued") {
    const position = task.queue_position ? ` (#${task.queue_position})` : "";
    return task.scheduler_decision
      ? `Waiting in queue${position}.`
      : `Queued${position}; the scheduler hasn't looked at it yet.`;
  }
  if (task.status === "cancelled" && !task.assigned_gpu_id) {
    return "Cancelled before a GPU was assigned.";
  }
  return task.scheduler_decision ? "See the decision below." : "No scheduling decision recorded.";
}

export function TaskInspector({
  taskId,
  labelFor,
  onSelectGpu,
  onTaskChanged,
  onRetried,
}: TaskInspectorProps) {
  const { state, reload } = useTaskDetail(taskId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.kind === "loading") {
    return (
      <aside className="panel inspector" aria-label="Task details">
        <p role="status">Loading task…</p>
      </aside>
    );
  }
  if (state.kind === "failed") {
    return (
      <aside className="panel inspector" aria-label="Task details">
        <p role="alert">Couldn't load task: {state.error}</p>
      </aside>
    );
  }

  const task = state.data;
  const active = ACTIVE_TASK_STATUSES.has(task.status);
  const canCancel = active && !task.cancel_requested_at;
  const timeline = task.events.filter((e) => e.kind === "status");
  const logs = task.events.filter((e) => e.kind === "log");
  const gpuId = task.assigned_gpu_id;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  const cancel = () =>
    run(async () => {
      await cancelTask(task.id);
      await reload();
      onTaskChanged();
    });

  const runAgain = () =>
    run(async () => {
      const created = await createTask({
        ...(task.prompt ? { prompt: task.prompt } : {}),
        workload: task.workload,
        resources: { min_memory_mb: task.min_memory_mb },
      });
      onRetried(created);
    });

  return (
    <aside className="panel inspector" aria-labelledby="task-inspector-heading">
      <header className="inspector__header">
        <h2 id="task-inspector-heading" className="pixel-heading">
          Task
        </h2>
        <StatusPill status={task.status} />
      </header>
      <p className="inspector__device">
        <code>{task.id}</code>
      </p>
      {state.error && (
        <p className="inspector__stale" role="alert">
          Showing last known state ({state.error})
        </p>
      )}

      {task.prompt && (
        <section className="inspector__note" aria-label="Your note">
          <h3>Your note</h3>
          <p>{task.prompt}</p>
          <span className="metric__note">Saved for context. Never executed.</span>
        </section>
      )}

      <section aria-labelledby="spec-heading">
        <h3 id="spec-heading" className="inspector__subheading">
          {labelFor(task.workload.type)} · spec
        </h3>
        <pre className="inspector__spec">{JSON.stringify(task.workload, null, 2)}</pre>
      </section>

      <dl className="facts">
        <dt>Min memory</dt>
        <dd>{formatMemory(task.min_memory_mb)}</dd>
        <dt>Scheduling</dt>
        <dd>{schedulingSummary(task)}</dd>
        <dt>GPU</dt>
        <dd>
          {gpuId ? (
            <button type="button" className="link-button" onClick={() => onSelectGpu(gpuId)}>
              {gpuId}
            </button>
          ) : (
            "Not assigned"
          )}
        </dd>
        <dt>Submitted</dt>
        <dd>
          <time dateTime={task.created_at}>{formatTime(task.created_at)}</time>
        </dd>
        {task.finished_at && (
          <>
            <dt>Finished</dt>
            <dd>
              <time dateTime={task.finished_at}>{formatTime(task.finished_at)}</time>
            </dd>
          </>
        )}
        {task.progress !== null && (
          <>
            <dt>Progress</dt>
            <dd>
              <span className="metric">
                {Math.round(task.progress * 100)}%
                <span className="source-tag source-tag--simulated">worker-reported</span>
              </span>
              <div
                className="memory-bar progress-bar"
                role="progressbar"
                aria-label="Task progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(task.progress * 100)}
              >
                <div className="memory-bar__fill" style={{ width: `${task.progress * 100}%` }} />
              </div>
            </dd>
          </>
        )}
      </dl>

      {task.cancel_requested_at && active && (
        <p className="inspector__notice">Cancellation requested. Waiting for the worker to stop.</p>
      )}
      {task.error && (
        <section className="inspector__result inspector__result--error" aria-label="Error">
          <h3>Error</h3>
          <p>
            <code>{task.error.code}</code> {task.error.message}
          </p>
        </section>
      )}
      {task.result && (
        <section className="inspector__result" aria-label="Result">
          <h3>Result</h3>
          <pre>{JSON.stringify(task.result, null, 2)}</pre>
        </section>
      )}

      {task.scheduler_decision && (
        <SchedulingPanel decision={task.scheduler_decision} onSelectGpu={onSelectGpu} />
      )}

      <div className="inspector__actions">
        {canCancel && (
          <button
            type="button"
            className="pixel-button pixel-button--danger"
            disabled={busy}
            onClick={() => void cancel()}
          >
            {task.status === "running" ? "Request cancel" : "Cancel task"}
          </button>
        )}
        {!active && (
          <button
            type="button"
            className="pixel-button"
            disabled={busy}
            onClick={() => void runAgain()}
          >
            Run again
          </button>
        )}
      </div>
      {actionError && (
        <p className="terminal__error" role="alert">
          {actionError}
        </p>
      )}

      <section aria-labelledby="timeline-heading">
        <h3 id="timeline-heading" className="inspector__subheading">
          Timeline
        </h3>
        <ol className="timeline">
          {timeline.map((event) => (
            <li
              key={event.id}
              className={`timeline__item timeline__item--${event.to_status ?? "log"}`}
            >
              <time dateTime={event.timestamp}>{formatTime(event.timestamp)}</time>
              <span>
                <strong>{event.to_status ? TASK_STATUS_LABELS[event.to_status] : "Event"}</strong>{" "}
                {event.message}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="logs-heading">
        <h3 id="logs-heading" className="inspector__subheading">
          Logs
        </h3>
        {logs.length === 0 ? (
          <p className="metric__note">No log lines yet.</p>
        ) : (
          <ol className="log-lines">
            {logs.map((event) => (
              <li key={event.id} className={`log-lines__line log-lines__line--${event.level}`}>
                <time dateTime={event.timestamp}>{formatTime(event.timestamp)}</time>
                <span className="log-lines__level">{event.level}</span>
                <span>{event.message}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
