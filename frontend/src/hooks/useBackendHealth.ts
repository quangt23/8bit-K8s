import { useCallback, useEffect, useRef, useState } from "react";

import { fetchHealth, type HealthResponse } from "../api/health";

export type BackendHealth =
  | { kind: "checking" }
  | { kind: "online"; health: HealthResponse; checkedAt: Date }
  | { kind: "offline"; error: string; checkedAt: Date };

export const HEALTH_POLL_INTERVAL_MS = 10_000;

/**
 * Polls the backend health endpoint. Keeps the last result visible while a
 * re-check is in flight so the status lamp does not flicker.
 */
export function useBackendHealth(pollIntervalMs = HEALTH_POLL_INTERVAL_MS) {
  const [state, setState] = useState<BackendHealth>({ kind: "checking" });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setIsRefreshing(true);
    try {
      const health = await fetchHealth(controller.signal);
      setState({ kind: "online", health, checkedAt: new Date() });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Unknown error.";
      setState({ kind: "offline", error: message, checkedAt: new Date() });
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void check(), 0);
    const timer = setInterval(() => void check(), pollIntervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      inFlight.current?.abort();
    };
  }, [check, pollIntervalMs]);

  return { state, isRefreshing, refresh: check };
}
