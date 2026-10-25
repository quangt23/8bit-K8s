import { BackendStatus } from "./components/BackendStatus";
import { PixelSprite } from "./components/PixelSprite";
import { logoChip, pottedPlant, serverRack } from "./components/sprites";
import { useBackendHealth } from "./hooks/useBackendHealth";

const lampClasses = { L: "blink", A: "blink blink--slow" };

const STATIONS = [
  {
    name: "GPU facility",
    description: "Server racks where every GPU lights up from live scheduler data.",
    phase: "Phase 1",
  },
  {
    name: "Command terminal",
    description: "Submit validated workloads and follow them through the queue.",
    phase: "Phase 2",
  },
  {
    name: "Inspector",
    description: "See exactly why a task landed on a GPU, or why it could not.",
    phase: "Phase 1–3",
  },
] as const;

export default function App() {
  const { state, isRefreshing, refresh } = useBackendHealth();
  const online = state.kind === "online";

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
        <div className={`chip ${online ? "chip--ok" : "chip--warn"}`}>
          <span className={`lamp lamp--${state.kind}`} aria-hidden="true" />
          <span>
            {online ? "API linked" : state.kind === "checking" ? "Linking…" : "API offline"}
          </span>
        </div>
      </header>

      <main className="layout">
        <section className="panel hero" aria-labelledby="hero-heading">
          <div className="scene">
            <div className="scene__wall" />
            <div className="scene__floor" />
            <div className="scene__props">
              <PixelSprite sprite={pottedPlant} scale={5} />
              <PixelSprite sprite={serverRack} scale={6} pixelClasses={lampClasses} />
              <PixelSprite sprite={serverRack} scale={6} pixelClasses={lampClasses} />
              <PixelSprite sprite={pottedPlant} scale={5} className="flip" />
            </div>
            <p className="scene__caption">Illustration only. No GPUs are registered yet.</p>
          </div>

          <div className="hero__copy">
            <h2 id="hero-heading" className="pixel-heading">
              Welcome to the control room
            </h2>
            <p>
              PixelGPU schedules AI workloads across GPU workers and shows you every decision in a
              cozy pixel-art facility. The foundation is in place: a FastAPI backend and this React
              frontend, linked through the API.
            </p>
            <p className="honesty">
              PixelGPU labels every device as <strong>simulated</strong>, <strong>CPU</strong>, or{" "}
              <strong>real GPU</strong>, and never shows simulated activity as real hardware.
            </p>
          </div>
        </section>

        <BackendStatus state={state} isRefreshing={isRefreshing} onRetry={() => void refresh()} />

        <section className="panel stations" aria-labelledby="stations-heading">
          <h2 id="stations-heading" className="pixel-heading">
            Stations under construction
          </h2>
          <ul className="stations__list">
            {STATIONS.map((station) => (
              <li key={station.name} className="station">
                <div className="station__head">
                  <h3>{station.name}</h3>
                  <span className="tag">{station.phase}</span>
                </div>
                <p>{station.description}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="footer">
        <span>Phase 0 · foundation</span>
        <a href="/api/docs" target="_blank" rel="noreferrer">
          API docs
        </a>
      </footer>
    </div>
  );
}
