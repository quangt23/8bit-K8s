import type { GpuDevice, Worker } from "../api/fleet";
import { formatMemory, gpuVisualState, STATE_STYLES } from "../fleet/gpuState";
import { StatusLamp } from "./StatusLamp";

interface FleetRosterProps {
  gpus: readonly GpuDevice[];
  workers: readonly Worker[];
  selectedGpuId: string | null;
  onSelectGpu: (gpuId: string) => void;
}

/** Text list of every GPU: the keyboard and screen-reader route into the facility. */
export function FleetRoster({ gpus, workers, selectedGpuId, onSelectGpu }: FleetRosterProps) {
  const racks = [...new Set(gpus.map((gpu) => gpu.location.rack))].sort();

  return (
    <section className="panel roster" aria-labelledby="roster-heading">
      <h2 id="roster-heading" className="pixel-heading">
        Fleet roster
      </h2>
      <div className="roster__racks">
        {racks.map((rack) => {
          const worker = workers.find((w) => w.rack === rack);
          const rackGpus = gpus
            .filter((gpu) => gpu.location.rack === rack)
            .sort((a, b) => a.location.slot - b.location.slot);
          return (
            <div key={rack} className="roster__rack">
              <h3 className="roster__rack-title">
                Rack {rack}
                {worker && <span className="roster__worker">{worker.name}</span>}
              </h3>
              <ul className="roster__list">
                {rackGpus.map((gpu) => {
                  const state = gpuVisualState(gpu);
                  const selected = gpu.id === selectedGpuId;
                  return (
                    <li key={gpu.id}>
                      <button
                        type="button"
                        className="roster__gpu"
                        aria-pressed={selected}
                        onClick={() => onSelectGpu(gpu.id)}
                      >
                        <StatusLamp state={state} />
                        <span className="roster__id">{gpu.id}</span>
                        <span className="roster__name">
                          {gpu.name} · {formatMemory(gpu.memory_total_mb)}
                        </span>
                        <span className={`roster__state roster__state--${state}`}>
                          {STATE_STYLES[state].label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
