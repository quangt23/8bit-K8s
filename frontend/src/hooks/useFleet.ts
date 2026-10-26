import { fetchFleet, type FleetSnapshot } from "../api/fleet";
import { usePolledResource, type Resource } from "./usePolledResource";

export type FleetState = Resource<FleetSnapshot>;

export const FLEET_POLL_INTERVAL_MS = 5_000;

export function useFleet(pollIntervalMs = FLEET_POLL_INTERVAL_MS) {
  return usePolledResource(fetchFleet, pollIntervalMs);
}
