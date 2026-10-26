import { fetchFleet, type FleetSnapshot } from "../api/fleet";
import { usePolledResource, type Resource } from "./usePolledResource";

export type FleetState = Resource<FleetSnapshot>;

// Fast enough that a GPU visibly lights up soon after a task starts (Phase 4: live updates).
export const FLEET_POLL_INTERVAL_MS = 1_500;

export function useFleet(pollIntervalMs = FLEET_POLL_INTERVAL_MS) {
  return usePolledResource(fetchFleet, pollIntervalMs);
}
