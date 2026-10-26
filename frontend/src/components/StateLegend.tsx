import { STATE_STYLES, type GpuVisualState } from "../fleet/gpuState";
import { StatusLamp } from "./StatusLamp";

const ORDER: GpuVisualState[] = ["idle", "reserved", "running", "completed", "error", "offline"];

export function StateLegend() {
  return (
    <section className="legend" aria-labelledby="legend-heading">
      <h3 id="legend-heading" className="legend__title">
        Legend
      </h3>
      <ul className="legend__list">
        {ORDER.map((state) => (
          <li key={state} className="legend__item" title={STATE_STYLES[state].description}>
            <StatusLamp state={state} />
            <span>{STATE_STYLES[state].label}</span>
          </li>
        ))}
        <li className="legend__item">
          <span className="mode-badge mode-badge--simulated">SIM</span>
          <span>Simulated device</span>
        </li>
      </ul>
    </section>
  );
}
