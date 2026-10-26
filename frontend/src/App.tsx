import { useState } from "react";

import { logoChip } from "./art/sprites";
import { FleetRoster } from "./components/FleetRoster";
import { Inspector } from "./components/Inspector";
import { PixelSprite } from "./components/PixelSprite";
import { FacilityPanel } from "./facility/FacilityPanel";
import { useFleet, type FleetState } from "./hooks/useFleet";

function LinkChip({ fleet }: { fleet: FleetState }) {
  const [label, tone] =
    fleet.kind === "loading"
      ? ["Linking…", "warn"]
      : fleet.kind === "failed" || fleet.error
        ? ["API offline", "bad"]
        : ["API linked", "ok"];
  return (
    <div className={`chip chip--${tone}`} role="status">
      <span className={`lamp lamp--${tone}`} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export default function App() {
  const { state: fleet, reload } = useFleet();
  const [selectedGpuId, setSelectedGpuId] = useState<string | null>(null);

  const gpus = fleet.kind === "ready" ? fleet.fleet.gpus : [];
  const workers = fleet.kind === "ready" ? fleet.fleet.workers : [];
  const selectedGpu = gpus.find((gpu) => gpu.id === selectedGpuId) ?? null;
  const selectedWorker = workers.find((w) => w.id === selectedGpu?.worker_id) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <PixelSprite sprite={logoChip} scale={3} />
          <div>
            <h1 className="brand__name">PixelGPU</h1>
            <p className="brand__tagline">GPU orchestration, one pixel at a time</p>
          </div>
        </div>
        <LinkChip fleet={fleet} />
      </header>

      {fleet.kind === "ready" && fleet.error && (
        <p className="banner" role="alert">
          Lost contact with the backend ({fleet.error}). Showing the last known state.
        </p>
      )}

      <main className="control-room">
        <div className="control-room__facility">
          <FacilityPanel
            fleet={fleet}
            selectedGpuId={selectedGpu?.id ?? null}
            onSelectGpu={setSelectedGpuId}
            onRetry={() => void reload()}
          />
        </div>
        <div className="control-room__inspector">
          <Inspector gpu={selectedGpu} worker={selectedWorker} />
        </div>
        {gpus.length > 0 && (
          <div className="control-room__roster">
            <FleetRoster
              gpus={gpus}
              workers={workers}
              selectedGpuId={selectedGpu?.id ?? null}
              onSelectGpu={setSelectedGpuId}
            />
          </div>
        )}
      </main>

      <footer className="footer">
        <span>Phase 1 · control room</span>
        <a href="/api/docs" target="_blank" rel="noreferrer">
          API docs
        </a>
      </footer>
    </div>
  );
}
