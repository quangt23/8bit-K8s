import type { ExecutionMode, GpuDevice, Worker } from "../api/fleet";

/**
 * Pure, deterministic placement of racks and GPU boards in the facility scene,
 * in scene pixels. Kept free of Phaser so it can be unit tested and reused by
 * browser tests to locate GPUs on the canvas.
 */

export const VIEW_WIDTH = 384;
export const VIEW_HEIGHT = 216;
export const FLOOR_Y = 150;

export const RACK_WIDTH = 76;
export const RACK_CAP = 14;
export const RACK_BOTTOM = 8;
export const RACK_BASE_Y = 192;
export const SLOT_PITCH = 16;
export const BOARD_WIDTH = 60;
export const BOARD_HEIGHT = 12;

const RACK_GAP = 24;
const ZONE_LEFT = 112;
const ZONE_RIGHT_MARGIN = 40;

export interface GpuSlotLayout {
  gpuId: string;
  slot: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RackLayout {
  rack: string;
  workerId: string | null;
  executionMode: ExecutionMode | null;
  x: number;
  y: number;
  width: number;
  height: number;
  slotCount: number;
  gpus: GpuSlotLayout[];
}

export interface FacilityLayout {
  worldWidth: number;
  racks: RackLayout[];
}

type GpuInput = Pick<GpuDevice, "id" | "location">;
type WorkerInput = Pick<Worker, "id" | "rack" | "execution_mode">;

export function computeFacilityLayout(
  gpus: readonly GpuInput[],
  workers: readonly WorkerInput[],
): FacilityLayout {
  const rackNames = [
    ...new Set([...gpus.map((g) => g.location.rack), ...workers.map((w) => w.rack)]),
  ].sort();

  const zoneWidth = VIEW_WIDTH - ZONE_LEFT - ZONE_RIGHT_MARGIN;
  const totalWidth = rackNames.length * RACK_WIDTH + Math.max(0, rackNames.length - 1) * RACK_GAP;
  const startX = ZONE_LEFT + Math.max(0, Math.floor((zoneWidth - totalWidth) / 2));
  const worldWidth = Math.max(VIEW_WIDTH, startX + totalWidth + ZONE_RIGHT_MARGIN);

  const racks = rackNames.map((rack, index): RackLayout => {
    const rackGpus = gpus
      .filter((g) => g.location.rack === rack)
      .sort((a, b) => a.location.slot - b.location.slot || a.id.localeCompare(b.id));
    const worker = workers.find((w) => w.rack === rack) ?? null;
    const slotCount = Math.max(1, ...rackGpus.map((g) => g.location.slot));
    const height = RACK_CAP + slotCount * SLOT_PITCH + RACK_BOTTOM;
    const x = startX + index * (RACK_WIDTH + RACK_GAP);
    const y = RACK_BASE_Y - height;

    return {
      rack,
      workerId: worker?.id ?? null,
      executionMode: worker?.execution_mode ?? null,
      x,
      y,
      width: RACK_WIDTH,
      height,
      slotCount,
      gpus: rackGpus.map((g) => ({
        gpuId: g.id,
        slot: g.location.slot,
        x: x + (RACK_WIDTH - BOARD_WIDTH) / 2,
        y: y + RACK_CAP + (g.location.slot - 1) * SLOT_PITCH + (SLOT_PITCH - BOARD_HEIGHT) / 2,
        width: BOARD_WIDTH,
        height: BOARD_HEIGHT,
      })),
    };
  });

  return { worldWidth, racks };
}
