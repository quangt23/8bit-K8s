import type { BackendHealth } from "../hooks/useBackendHealth";

interface BackendStatusProps {
  state: BackendHealth;
  isRefreshing: boolean;
  onRetry: () => void;
}

const LABELS: Record<BackendHealth["kind"], string> = {
  checking: "Checking link",
  online: "Backend online",
  offline: "Backend offline",
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Terminal-style readout of `GET /api/health`. */
export function BackendStatus({ state, isRefreshing, onRetry }: BackendStatusProps) {
  return (
    <section className="terminal" aria-labelledby="backend-status-heading">
      <header className="terminal__header">
        <h2 id="backend-status-heading" className="terminal__title">
          Backend link
        </h2>
        <span className={`lamp lamp--${state.kind}`} aria-hidden="true" />
        <span className="terminal__state" role="status" aria-live="polite">
          {LABELS[state.kind]}
        </span>
      </header>

      <div className="terminal__body">
        <p className="terminal__prompt">
          <span aria-hidden="true">&gt; </span>GET /api/health
        </p>

        {state.kind === "checking" && <p className="terminal__muted">Dialing the server room…</p>}

        {state.kind === "online" && (
          <dl className="readout">
            <dt>service</dt>
            <dd>{state.health.service}</dd>
            <dt>version</dt>
            <dd>{state.health.version}</dd>
            <dt>environment</dt>
            <dd>{state.health.environment}</dd>
            <dt>server time</dt>
            <dd>
              <time dateTime={state.health.server_time}>
                {new Date(state.health.server_time).toLocaleString()}
              </time>
            </dd>
          </dl>
        )}

        {state.kind === "offline" && (
          <div className="terminal__error">
            <p>{state.error}</p>
            <p className="terminal__muted">
              Start it with <code>make dev</code> or <code>make backend</code>, then retry.
            </p>
          </div>
        )}
      </div>

      <footer className="terminal__footer">
        <span className="terminal__muted">
          {state.kind === "checking" ? "—" : `Last checked ${formatTime(state.checkedAt)}`}
        </span>
        <button type="button" className="pixel-button" onClick={onRetry} disabled={isRefreshing}>
          {isRefreshing ? "Checking…" : "Check now"}
        </button>
      </footer>
    </section>
  );
}
