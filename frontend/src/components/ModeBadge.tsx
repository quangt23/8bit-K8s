import type { ExecutionMode } from "../api/fleet";
import { EXECUTION_MODE_LABELS } from "../fleet/gpuState";

export function ModeBadge({ mode }: { mode: ExecutionMode }) {
  return <span className={`mode-badge mode-badge--${mode}`}>{EXECUTION_MODE_LABELS[mode]}</span>;
}
