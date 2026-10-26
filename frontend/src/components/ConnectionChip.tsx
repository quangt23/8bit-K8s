import type { LiveSnapshot } from "../api/live";
import type { Resource } from "../hooks/usePolledResource";
import type { ConnectionStatus } from "../live/LiveConnection";
import { formatTime } from "../tasks/taskStatus";

interface ConnectionChipProps {
  connection: ConnectionStatus;
  snapshot: Resource<LiveSnapshot>;
}

/** Live link status, and when the data on screen was last refreshed. */
export function ConnectionChip({ connection, snapshot }: ConnectionChipProps) {
  const backendDown = snapshot.kind === "failed" || (snapshot.kind === "ready" && snapshot.error);
  let tone: "ok" | "warn" | "bad";
  let label: string;
  if (backendDown) {
    tone = "bad";
    label = "Backend offline";
  } else if (connection.state === "live") {
    tone = "ok";
    label = "Live";
  } else if (connection.state === "connecting") {
    tone = "warn";
    label = "Connecting…";
  } else {
    tone = "warn";
    label = `Reconnecting (try ${connection.attempt})`;
  }
  const updated = snapshot.kind === "ready" ? formatTime(snapshot.data.generated_at) : null;

  return (
    <div className={`chip chip--${tone}`} role="status" aria-live="polite">
      <span className={`lamp lamp--${tone}`} aria-hidden="true" />
      <span>{label}</span>
      {updated && <span className="chip__detail">updated {updated}</span>}
    </div>
  );
}
