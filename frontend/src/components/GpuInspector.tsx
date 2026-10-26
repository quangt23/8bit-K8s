import type { GpuDevice, Metric, Worker } from "../api/fleet";
import { formatMemory, gpuVisualState, STATE_STYLES } from "../fleet/gpuState";
import { ModeBadge } from "./ModeBadge";
import { StatusLamp } from "./StatusLamp";

interface GpuInspectorProps {
  gpu: GpuDevice;
  worker: Worker | null;
}

function SourceTag({ source }: { source: Metric["source"] }) {
  return <span className={`source-tag source-tag--${source}`}>{source}</span>;
}

function formatMetric(metric: Metric): string {
  if (metric.value === null) return "Unavailable";
  if (metric.unit === "MiB") return formatMemory(metric.value);
  return `${metric.value} ${metric.unit}`;
}

function MetricRow({ label, metric, extra }: { label: string; metric: Metric; extra?: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <span className="metric">
          <span>
            {formatMetric(metric)}
            {extra && metric.value !== null ? ` ${extra}` : ""}
          </span>
          <SourceTag source={metric.source} />
        </span>
        {metric.note && <span className="metric__note">{metric.note}</span>}
        {metric.updated_at && (
          <span className="metric__note">
            Updated{" "}
            <time dateTime={metric.updated_at}>
              {new Date(metric.updated_at).toLocaleTimeString()}
            </time>
          </span>
        )}
      </dd>
    </>
  );
}

function MemoryBar({ used, total }: { used: number; total: number }) {
  const percent = Math.min(100, Math.round((used / total) * 100));
  return (
    <div
      className="memory-bar"
      role="meter"
      aria-label="Memory in use"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="memory-bar__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function GpuInspector({ gpu, worker }: GpuInspectorProps) {
  const state = gpuVisualState(gpu);
  const used = gpu.memory_used.value;

  return (
    <aside className="panel inspector" aria-labelledby="inspector-heading" aria-live="polite">
      <header className="inspector__header">
        <h2 id="inspector-heading" className="pixel-heading">
          {gpu.id}
        </h2>
        <ModeBadge mode={gpu.execution_mode} />
      </header>
      <p className="inspector__device">{gpu.name}</p>

      <div className={`inspector__state inspector__state--${state}`}>
        <StatusLamp state={state} />
        <div>
          <strong>{STATE_STYLES[state].label}</strong>
          <p>{gpu.health_reason ?? STATE_STYLES[state].description}</p>
        </div>
      </div>

      <dl className="facts">
        <dt>Schedulable</dt>
        <dd>{gpu.schedulable ? "Yes" : `No: ${gpu.unschedulable_reason ?? "unknown reason"}`}</dd>

        <dt>Memory</dt>
        <dd>
          {formatMemory(gpu.memory_total_mb)} total
          <span className="metric__note">Advertised by the worker.</span>
        </dd>
        <MetricRow label="In use" metric={gpu.memory_used} />
        {used !== null && (
          <>
            <dt className="visually-hidden">Memory in use</dt>
            <dd>
              <MemoryBar used={used} total={gpu.memory_total_mb} />
            </dd>
          </>
        )}
        <MetricRow label="Utilization" metric={gpu.utilization} />

        <dt>Location</dt>
        <dd>
          Rack {gpu.location.rack}, slot {gpu.location.slot}
        </dd>

        <dt>Worker</dt>
        <dd>
          {worker ? (
            <>
              {worker.name} <code>{worker.id}</code>
              <span className="metric__note">
                {worker.status === "online" ? "Online" : "Offline"} · heartbeat:{" "}
                {worker.last_heartbeat
                  ? new Date(worker.last_heartbeat).toLocaleTimeString()
                  : "none (in-process simulated worker)"}
              </span>
            </>
          ) : (
            <>
              Unknown worker <code>{gpu.worker_id}</code>
            </>
          )}
        </dd>

        <dt>Current task</dt>
        <dd>{gpu.current_task_id ?? "None"}</dd>
      </dl>

      <section className="inspector__history" aria-labelledby="history-heading">
        <h3 id="history-heading">Recent workloads</h3>
        <p>No workloads have run on this GPU.</p>
      </section>
    </aside>
  );
}
