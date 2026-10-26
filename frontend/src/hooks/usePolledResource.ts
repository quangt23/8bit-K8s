import { useCallback, useEffect, useRef, useState } from "react";

export type Resource<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T; error: string | null }
  | { kind: "failed"; error: string };

/**
 * Loads `fetcher` immediately and then every `intervalMs`. If a refresh fails after a
 * successful load, the last data is kept and the error is reported alongside it, so
 * the UI degrades instead of going blank. (Phase 4 replaces polling with live updates.)
 *
 * `fetcher` must be stable (wrap it in useCallback); remount the component to switch
 * to a different resource. Changing `refreshKey` reloads immediately, which lets live
 * updates drive refreshes while the interval stays a slow safety net.
 */
export function usePolledResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  refreshKey?: unknown,
) {
  const [state, setState] = useState<Resource<T>>({ kind: "loading" });
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const data = await fetcher(controller.signal);
      if (!controller.signal.aborted) setState({ kind: "ready", data, error: null });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Unknown error.";
      setState((prev) =>
        prev.kind === "ready" ? { ...prev, error: message } : { kind: "failed", error: message },
      );
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, [fetcher]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      inFlight.current?.abort();
    };
  }, [load, intervalMs]);

  const lastKey = useRef(refreshKey);
  useEffect(() => {
    if (Object.is(lastKey.current, refreshKey)) return;
    lastKey.current = refreshKey;
    void load();
  }, [refreshKey, load]);

  return { state, reload: load };
}
