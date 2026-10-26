import type { FleetSnapshot, GpuDevice, Metric, Worker } from "../api/fleet";

const unavailable = (unit: string, note: string): Metric => ({
  value: null,
  unit,
  source: "unavailable",
  updated_at: null,
  note,
});

export function makeGpu(overrides: Partial<GpuDevice> & Pick<GpuDevice, "id">): GpuDevice {
  return {
    name: "PixelSim 24G",
    worker_id: "sim-worker-a",
    execution_mode: "simulated",
    location: { rack: "A", slot: 1 },
    memory_total_mb: 24576,
    memory_used: {
      value: 0,
      unit: "MiB",
      source: "simulated",
      updated_at: null,
      note: "Simulated usage comes from task reservations; none are active.",
    },
    utilization: unavailable("%", "Simulated workers do not model utilization."),
    health: "healthy",
    health_reason: null,
    activity: "idle",
    current_task_id: null,
    schedulable: true,
    unschedulable_reason: null,
    ...overrides,
  };
}

export function makeWorker(overrides: Partial<Worker> & Pick<Worker, "id" | "rack">): Worker {
  return {
    name: `Simulated worker ${overrides.rack}`,
    execution_mode: "simulated",
    status: "online",
    gpu_ids: [],
    supported_workloads: [],
    last_heartbeat: null,
    ...overrides,
  };
}

/** Mirrors the backend's built-in simulated fleet. */
export function simulatedFleet(): FleetSnapshot {
  return {
    generated_at: "2026-10-25T12:00:00Z",
    workers: [
      makeWorker({
        id: "sim-worker-a",
        rack: "A",
        gpu_ids: ["GPU-01", "GPU-02", "GPU-03", "GPU-04"],
      }),
      makeWorker({ id: "sim-worker-b", rack: "B", gpu_ids: ["GPU-05", "GPU-06"] }),
    ],
    gpus: [
      makeGpu({ id: "GPU-01", location: { rack: "A", slot: 1 } }),
      makeGpu({ id: "GPU-02", location: { rack: "A", slot: 2 } }),
      makeGpu({
        id: "GPU-03",
        name: "PixelSim 16G",
        memory_total_mb: 16384,
        location: { rack: "A", slot: 3 },
      }),
      makeGpu({
        id: "GPU-04",
        name: "PixelSim 16G",
        memory_total_mb: 16384,
        location: { rack: "A", slot: 4 },
        health: "error",
        health_reason: "Simulated fault: device failed its startup self-test.",
        schedulable: false,
        unschedulable_reason: "Device is reporting an error.",
      }),
      makeGpu({
        id: "GPU-05",
        name: "PixelSim 8G",
        memory_total_mb: 8192,
        worker_id: "sim-worker-b",
        location: { rack: "B", slot: 1 },
      }),
      makeGpu({
        id: "GPU-06",
        name: "PixelSim 12G",
        memory_total_mb: 12288,
        worker_id: "sim-worker-b",
        location: { rack: "B", slot: 2 },
        health: "offline",
        health_reason: "Simulated outage: device is not responding.",
        memory_used: unavailable("MiB", "Device is offline."),
        schedulable: false,
        unschedulable_reason: "Device is offline.",
      }),
    ],
  };
}
