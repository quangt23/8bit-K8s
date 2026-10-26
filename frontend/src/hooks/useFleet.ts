import { useCallback, useEffect, useRef, useState } from "react";

import { fetchFleet, type FleetSnapshot } from "../api/fleet";

export type FleetState =
  | { kind: "loading" }
  | { kind: "ready"; fleet: FleetSnapshot; error: string | null }
  | { kind: "failed"; error: string };

export const FLEET_POLL_INTERVAL_MS = 5_000;

/**
 * Loads the fleet snapshot and polls for changes. (Phase 4 will replace polling with
 * live updates.) If a refresh fails after a successful load, the last snapshot is kept
 * and the error is reported alongside it, so the scene doesn't go blank.
 */
export function useFleet(pollIntervalMs = FLEET_POLL_INTERVAL_MS) {
  const [state, setState] = useState<FleetState>({ kind: "loading" });
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const fleet = await fetchFleet(controller.signal);
      setState({ kind: "ready", fleet, error: null });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Unknown error.";
      setState((prev) =>
        prev.kind === "ready" ? { ...prev, error: message } : { kind: "failed", error: message },
      );
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), pollIntervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      inFlight.current?.abort();
    };
  }, [load, pollIntervalMs]);

  return { state, reload: load };
}
