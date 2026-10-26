import type { Metrics } from "../api/live";

function seconds(value: number | null): string {
  if (value === null) return "—";
  if (value < 60) return `${value < 10 ? value.toFixed(1) : Math.round(value)} s`;
  return `${Math.floor(value / 60)} m ${Math.round(value % 60)} s`;
}

/** Scheduler and queue figures, from task records. Not hardware telemetry. */
export function MetricsStrip({ metrics }: { metrics: Metrics }) {
  const { tasks_by_status: counts, gpus, recent } = metrics;
  const items: { label: string; value: string; hint?: string }[] = [
    { label: "Queued", value: String(counts.queued) },
    { label: "Running", value: String(counts.running + counts.scheduled) },
    {
      label: "GPUs allocated",
      value: `${gpus.allocated} / ${gpus.healthy}`,
      hint: "Reserved by a task, out of healthy GPUs. Not utilization.",
    },
    { label: "Done (5 min)", value: String(metrics.finished_last_5_minutes) },
    {
      label: "Success rate",
      value: recent.success_rate === null ? "—" : `${Math.round(recent.success_rate * 100)}%`,
      hint: `Last ${recent.sample_size} finished tasks, excluding cancellations.`,
    },
    {
      label: "Median wait",
      value: seconds(recent.median_queue_wait_seconds),
      hint: "Submitted → scheduled, last finished tasks.",
    },
    {
      label: "Median run",
      value: seconds(recent.median_run_seconds),
      hint: "Started → finished, last finished tasks.",
    },
  ];
  return (
    <section className="metrics" aria-label="Orchestration metrics">
      <dl className="metrics__list">
        {items.map((item) => (
          <div key={item.label} className="metrics__item" title={item.hint}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
