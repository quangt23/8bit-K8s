import type { ExecutionMode, GpuDevice } from "../api/fleet";

/**
 * The single visual state shown for a GPU, derived from backend health and activity.
 * Health wins over activity: an offline device is shown offline even if a stale
 * activity is still attached. "completed" is a transient animation the scene plays
 * when a device goes from running back to idle; it is never a backend value.
 */
export type GpuVisualState = "idle" | "reserved" | "running" | "completed" | "error" | "offline";

export function gpuVisualState(gpu: Pick<GpuDevice, "health" | "activity">): GpuVisualState {
  if (gpu.health === "offline") return "offline";
  if (gpu.health === "error") return "error";
  return gpu.activity;
}

export interface StateStyle {
  label: string;
  description: string;
  /** Lamp colour, shared by the CSS legend and the Phaser scene. */
  lamp: string;
}

export const STATE_STYLES: Record<GpuVisualState, StateStyle> = {
  idle: { label: "Idle", description: "Healthy and free for new work.", lamp: "#5f8f4a" },
  reserved: {
    label: "Reserved",
    description: "Picked by the scheduler, waiting to start.",
    lamp: "#e0a030",
  },
  running: { label: "Running", description: "Executing a task.", lamp: "#9fd36b" },
  completed: {
    label: "Completed",
    description: "Just finished a task (brief flash).",
    lamp: "#f7f1c8",
  },
  error: { label: "Error", description: "Reporting a fault. Not schedulable.", lamp: "#d9503c" },
  offline: { label: "Offline", description: "Disconnected. Not schedulable.", lamp: "#3a3a3a" },
};

export const EXECUTION_MODE_LABELS: Record<ExecutionMode, string> = {
  simulated: "Simulated",
  cpu: "CPU",
  gpu: "Real GPU",
};

/** Formats a MiB value using binary units, matching what drivers report. */
export function formatMemory(mib: number): string {
  if (mib < 1024) return `${mib} MiB`;
  const gib = mib / 1024;
  return `${Number.isInteger(gib) ? gib : gib.toFixed(1)} GiB`;
}
