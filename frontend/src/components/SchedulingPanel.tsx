import type { SchedulingDecision } from "../api/tasks";
import { formatMemory } from "../fleet/gpuState";
import { formatTime } from "../tasks/taskStatus";

const OUTCOME_LABELS: Record<SchedulingDecision["outcome"], string> = {
  scheduled: "Placed",
  waiting: "Waiting",
  unschedulable: "Unschedulable",
};

interface SchedulingPanelProps {
  decision: SchedulingDecision;
  onSelectGpu: (gpuId: string) => void;
}

/** The scheduler's recorded decision. The UI shows it as-is and never infers its own reasons. */
export function SchedulingPanel({ decision, onSelectGpu }: SchedulingPanelProps) {
  return (
    <section
      className={`decision decision--${decision.outcome}`}
      aria-labelledby="decision-heading"
    >
      <h3 id="decision-heading" className="inspector__subheading">
        Scheduler decision · {OUTCOME_LABELS[decision.outcome]}
      </h3>
      <p className="decision__explanation">{decision.explanation}</p>
      <p className="metric__note">
        Policy <code>{decision.policy}</code> · needs {formatMemory(decision.min_memory_mb)} ·
        decided <time dateTime={decision.decided_at}>{formatTime(decision.decided_at)}</time>
      </p>
      <table className="candidates">
        <caption className="visually-hidden">GPUs the scheduler considered</caption>
        <thead>
          <tr>
            <th scope="col">GPU</th>
            <th scope="col">Memory</th>
            <th scope="col">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {decision.candidates.map((c) => {
            const selected = c.gpu_id === decision.selected_gpu_id;
            return (
              <tr key={c.gpu_id} className={selected ? "candidates__selected" : undefined}>
                <th scope="row">
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onSelectGpu(c.gpu_id)}
                  >
                    {c.gpu_id}
                  </button>
                </th>
                <td>{formatMemory(c.memory_total_mb)}</td>
                <td>{selected ? "✓ Selected" : c.eligible ? "Eligible" : c.reason}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
