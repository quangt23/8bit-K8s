import { ApiError, apiGet } from "./client";

/** Types mirror backend/src/pixelgpu/fleet/models.py. */
export type ExecutionMode = "simulated" | "cpu" | "gpu";
export type DeviceHealth = "healthy" | "error" | "offline";
export type DeviceActivity = "idle" | "reserved" | "running";
export type WorkerStatus = "online" | "offline";
export type MetricSource = "simulated" | "measured" | "unavailable";

export interface Metric {
  value: number | null;
  unit: string;
  source: MetricSource;
  updated_at: string | null;
  note: string | null;
}

export interface GpuDevice {
  id: string;
  name: string;
  worker_id: string;
  execution_mode: ExecutionMode;
  location: { rack: string; slot: number };
  memory_total_mb: number;
  memory_used: Metric;
  utilization: Metric;
  health: DeviceHealth;
  health_reason: string | null;
  activity: DeviceActivity;
  current_task_id: string | null;
  schedulable: boolean;
  unschedulable_reason: string | null;
}

export interface Worker {
  id: string;
  name: string;
  execution_mode: ExecutionMode;
  status: WorkerStatus;
  rack: string;
  gpu_ids: string[];
  supported_workloads: string[];
  last_heartbeat: string | null;
}

export interface FleetSnapshot {
  workers: Worker[];
  gpus: GpuDevice[];
  generated_at: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const oneOf =
  <T extends string>(...values: T[]) =>
  (v: unknown): v is T =>
    values.includes(v as T);

const isMode = oneOf<ExecutionMode>("simulated", "cpu", "gpu");

function isMetric(v: unknown): v is Metric {
  return (
    isObject(v) &&
    (v.value === null || typeof v.value === "number") &&
    isString(v.unit) &&
    oneOf<MetricSource>("simulated", "measured", "unavailable")(v.source)
  );
}

function isGpu(v: unknown): v is GpuDevice {
  return (
    isObject(v) &&
    isString(v.id) &&
    isString(v.name) &&
    isString(v.worker_id) &&
    isMode(v.execution_mode) &&
    isObject(v.location) &&
    isString(v.location.rack) &&
    typeof v.location.slot === "number" &&
    typeof v.memory_total_mb === "number" &&
    isMetric(v.memory_used) &&
    isMetric(v.utilization) &&
    oneOf<DeviceHealth>("healthy", "error", "offline")(v.health) &&
    oneOf<DeviceActivity>("idle", "reserved", "running")(v.activity) &&
    typeof v.schedulable === "boolean"
  );
}

function isWorker(v: unknown): v is Worker {
  return (
    isObject(v) &&
    isString(v.id) &&
    isString(v.name) &&
    isMode(v.execution_mode) &&
    oneOf<WorkerStatus>("online", "offline")(v.status) &&
    isString(v.rack) &&
    Array.isArray(v.gpu_ids)
  );
}

export async function fetchFleet(signal?: AbortSignal): Promise<FleetSnapshot> {
  const body = await apiGet("/fleet", { signal });
  if (
    !isObject(body) ||
    !Array.isArray(body.gpus) ||
    !Array.isArray(body.workers) ||
    !body.gpus.every(isGpu) ||
    !body.workers.every(isWorker)
  ) {
    throw new ApiError("Backend fleet response had an unexpected shape.");
  }
  return body as unknown as FleetSnapshot;
}
