import { STATE_STYLES, type GpuVisualState } from "../fleet/gpuState";

/** Small square lamp. Decorative: always pair it with a text label. */
export function StatusLamp({ state }: { state: GpuVisualState }) {
  return (
    <span
      className={`status-lamp status-lamp--${state}`}
      style={{ backgroundColor: STATE_STYLES[state].lamp }}
      aria-hidden="true"
    />
  );
}
