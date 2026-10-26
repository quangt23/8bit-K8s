import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { GpuDevice, Worker } from "../api/fleet";
import { StateLegend } from "../components/StateLegend";
import { EXECUTION_MODE_LABELS } from "../fleet/gpuState";
import type { FleetState } from "../hooks/useFleet";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { FacilityCanvas } from "./FacilityCanvas";
import { computeFacilityLayout, VIEW_WIDTH } from "./layout";

interface FacilityPanelProps {
  fleet: FleetState;
  selectedGpuId: string | null;
  onSelectGpu: (gpuId: string) => void;
  onRetry: () => void;
}

const EMPTY_GPUS: readonly GpuDevice[] = [];
const EMPTY_WORKERS: readonly Worker[] = [];

function summary(gpus: readonly GpuDevice[], workers: readonly Worker[]): string {
  const modes = [...new Set(gpus.map((g) => g.execution_mode))];
  const modeText =
    modes.length === 1 && modes[0]
      ? `all ${EXECUTION_MODE_LABELS[modes[0]].toLowerCase()}`
      : "mixed modes";
  return `${gpus.length} GPUs · ${workers.length} workers · ${modeText}`;
}

export function FacilityPanel({ fleet, selectedGpuId, onSelectGpu, onRetry }: FacilityPanelProps) {
  const reducedMotion = useReducedMotion();
  const [sceneError, setSceneError] = useState<string | null>(null);
  const gpus = fleet.kind === "ready" ? fleet.data.gpus : EMPTY_GPUS;
  const workers = fleet.kind === "ready" ? fleet.data.workers : EMPTY_WORKERS;

  const model = useMemo(
    () => ({ gpus, workers, selectedGpuId, reducedMotion }),
    [gpus, workers, selectedGpuId, reducedMotion],
  );
  const frameRef = useRef<HTMLDivElement>(null);

  // On narrow screens the scene is wider than its frame. Keep the racks, or the
  // selected GPU, in view instead of the decorative left side of the room.
  const focusX = useMemo(() => {
    const racks = computeFacilityLayout(gpus, workers).racks;
    const slot = racks.flatMap((r) => r.gpus).find((g) => g.gpuId === selectedGpuId);
    if (slot) return slot.x + slot.width / 2;
    const first = racks[0];
    const last = racks.at(-1);
    return first && last ? (first.x + last.x + last.width) / 2 : null;
  }, [gpus, workers, selectedGpuId]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || focusX === null || frame.scrollWidth <= frame.clientWidth) return;
    const target = (focusX / VIEW_WIDTH) * frame.scrollWidth - frame.clientWidth / 2;
    frame.scrollTo({ left: target, behavior: reducedMotion ? "auto" : "smooth" });
  }, [focusX, reducedMotion]);

  const handleSceneError = useCallback((error: unknown) => {
    console.error("Facility scene failed", error);
    setSceneError(error instanceof Error ? error.message : String(error));
  }, []);

  let body: ReactNode;
  if (fleet.kind === "loading") {
    body = (
      <div className="facility__placeholder" role="status">
        Powering up the facility…
      </div>
    );
  } else if (fleet.kind === "failed") {
    body = (
      <div className="facility__placeholder facility__placeholder--error" role="alert">
        <p>Couldn't load the fleet: {fleet.error}</p>
        <button type="button" className="pixel-button" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  } else if (gpus.length === 0) {
    body = (
      <div className="facility__placeholder" role="status">
        <p>No GPUs are registered.</p>
        <p className="facility__hint">
          Enable the simulated fleet with <code>PIXELGPU_SIMULATED_FLEET=true</code>.
        </p>
      </div>
    );
  } else if (sceneError) {
    body = (
      <div className="facility__placeholder facility__placeholder--error" role="alert">
        <p>The facility view couldn't start ({sceneError}).</p>
        <p className="facility__hint">The fleet roster below still works.</p>
      </div>
    );
  } else {
    body = <FacilityCanvas model={model} onSelectGpu={onSelectGpu} onError={handleSceneError} />;
  }

  return (
    <section className="panel facility" aria-labelledby="facility-heading">
      <header className="facility__header">
        <h2 id="facility-heading" className="pixel-heading">
          GPU facility
        </h2>
        {fleet.kind === "ready" && gpus.length > 0 && (
          <span className="facility__summary">{summary(gpus, workers)}</span>
        )}
      </header>
      <div className="facility__frame" ref={frameRef}>
        {body}
      </div>
      <StateLegend />
    </section>
  );
}
