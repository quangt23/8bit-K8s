import { useCallback } from "react";

import { getTask, listTasks, listWorkloads } from "../api/tasks";
import { usePolledResource } from "./usePolledResource";

/**
 * Live updates (see live/useLive.ts) trigger refreshes through `refreshKey`; these
 * intervals are only a safety net in case a notification is missed.
 */
const SAFETY_POLL_INTERVAL_MS = 10_000;
const CATALOG_POLL_INTERVAL_MS = 60_000;

export function useTaskDetail(taskId: string, refreshKey?: unknown) {
  const fetcher = useCallback((signal: AbortSignal) => getTask(taskId, signal), [taskId]);
  return usePolledResource(fetcher, SAFETY_POLL_INTERVAL_MS, refreshKey);
}

/** The most recent tasks placed on one GPU. */
export function useGpuHistory(gpuId: string, refreshKey?: unknown) {
  const fetcher = useCallback(
    (signal: AbortSignal) => listTasks(signal, { gpuId, limit: 5 }),
    [gpuId],
  );
  return usePolledResource(fetcher, SAFETY_POLL_INTERVAL_MS, refreshKey);
}

export function useWorkloadCatalog() {
  return usePolledResource(listWorkloads, CATALOG_POLL_INTERVAL_MS);
}
