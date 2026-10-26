import { useCallback } from "react";

import { getTask, listTasks, listWorkloads } from "../api/tasks";
import { usePolledResource } from "./usePolledResource";

export const TASKS_POLL_INTERVAL_MS = 1_500;
export const TASK_DETAIL_POLL_INTERVAL_MS = 1_000;
const GPU_HISTORY_POLL_INTERVAL_MS = 2_000;
const CATALOG_POLL_INTERVAL_MS = 60_000;

export function useTasks(pollIntervalMs = TASKS_POLL_INTERVAL_MS) {
  return usePolledResource(listTasks, pollIntervalMs);
}

export function useTaskDetail(taskId: string, pollIntervalMs = TASK_DETAIL_POLL_INTERVAL_MS) {
  const fetcher = useCallback((signal: AbortSignal) => getTask(taskId, signal), [taskId]);
  return usePolledResource(fetcher, pollIntervalMs);
}

/** The most recent tasks placed on one GPU. */
export function useGpuHistory(gpuId: string, pollIntervalMs = GPU_HISTORY_POLL_INTERVAL_MS) {
  const fetcher = useCallback(
    (signal: AbortSignal) => listTasks(signal, { gpuId, limit: 5 }),
    [gpuId],
  );
  return usePolledResource(fetcher, pollIntervalMs);
}

export function useWorkloadCatalog() {
  return usePolledResource(listWorkloads, CATALOG_POLL_INTERVAL_MS);
}
