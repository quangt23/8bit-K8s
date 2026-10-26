import { simulatedFleet } from "../test/fleetFixture";
import {
  BOARD_HEIGHT,
  computeFacilityLayout,
  RACK_BASE_Y,
  SLOT_PITCH,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from "./layout";

describe("computeFacilityLayout", () => {
  const { gpus, workers } = simulatedFleet();
  const layout = computeFacilityLayout(gpus, workers);

  it("creates one rack per rack label, in order, linked to its worker", () => {
    expect(layout.racks.map((r) => [r.rack, r.workerId, r.executionMode])).toEqual([
      ["A", "sim-worker-a", "simulated"],
      ["B", "sim-worker-b", "simulated"],
    ]);
  });

  it("places every GPU exactly once, in slot order", () => {
    const placed = layout.racks.flatMap((r) => r.gpus.map((g) => g.gpuId));
    expect(placed).toEqual(["GPU-01", "GPU-02", "GPU-03", "GPU-04", "GPU-05", "GPU-06"]);
  });

  it("keeps everything inside the visible scene when it fits", () => {
    expect(layout.worldWidth).toBe(VIEW_WIDTH);
    for (const rack of layout.racks) {
      expect(rack.x).toBeGreaterThanOrEqual(0);
      expect(rack.x + rack.width).toBeLessThanOrEqual(VIEW_WIDTH);
      expect(rack.y).toBeGreaterThanOrEqual(0);
      expect(rack.y + rack.height).toBe(RACK_BASE_Y);
      expect(RACK_BASE_Y).toBeLessThan(VIEW_HEIGHT);
    }
  });

  it("stacks boards one slot pitch apart and never overlaps them", () => {
    const rackA = layout.racks[0]!;
    const [first, second] = rackA.gpus;
    expect(second!.y - first!.y).toBe(SLOT_PITCH);
    expect(SLOT_PITCH).toBeGreaterThan(BOARD_HEIGHT);
  });

  it("is deterministic regardless of input order", () => {
    const shuffled = computeFacilityLayout([...gpus].reverse(), [...workers].reverse());
    expect(shuffled).toEqual(layout);
  });

  it("widens the world instead of overlapping racks when there are many", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `GPU-${i}`,
      location: { rack: String.fromCharCode(65 + i), slot: 1 },
    }));
    const wide = computeFacilityLayout(many, []);

    expect(wide.worldWidth).toBeGreaterThan(VIEW_WIDTH);
    for (let i = 1; i < wide.racks.length; i++) {
      const prev = wide.racks[i - 1]!;
      expect(wide.racks[i]!.x).toBeGreaterThanOrEqual(prev.x + prev.width);
    }
  });

  it("returns no racks for an empty fleet", () => {
    expect(computeFacilityLayout([], [])).toEqual({ worldWidth: VIEW_WIDTH, racks: [] });
  });
});
