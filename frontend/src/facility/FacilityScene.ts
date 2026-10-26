import Phaser from "phaser";

import type { ExecutionMode, GpuDevice, Worker } from "../api/fleet";
import { spriteToCanvas } from "../art/spriteCanvas";
import { alertBadge, fanFrames, pottedPlant, unpluggedBadge } from "../art/sprites";
import { gpuVisualState, STATE_STYLES, type GpuVisualState } from "../fleet/gpuState";
import {
  computeFacilityLayout,
  FLOOR_Y,
  RACK_BASE_Y,
  RACK_BOTTOM,
  RACK_CAP,
  SLOT_PITCH,
  VIEW_HEIGHT,
  type GpuSlotLayout,
  type RackLayout,
} from "./layout";

/** Everything the scene renders. React owns this; the scene never fetches or mutates data. */
export interface FacilityModel {
  gpus: readonly GpuDevice[];
  workers: readonly Worker[];
  selectedGpuId: string | null;
  reducedMotion: boolean;
}

export interface FacilityBridge {
  onSelectGpu(gpuId: string): void;
  onError(error: unknown): void;
}

const TICK_MS = 125;
const COMPLETED_FLASH_MS = 1500;
const FONT = { fontFamily: "Silkscreen, monospace", fontSize: "8px" } as const;

const color = (hex: string) => Number.parseInt(hex.slice(1), 16);

const C = {
  ink: 0x2b2118,
  wood: 0x8b5a2b,
  woodDark: 0x5c3a1e,
  woodLight: 0xa8733d,
  cream: 0xf4ead5,
  parchment: 0xfbf5e6,
  cavity: 0x1b2423,
  rail: 0x2b3b3a,
  railLight: 0x4a5a58,
  wall: 0xa8c6b4,
  wallLine: 0x9dbba9,
  floor: 0xa0683a,
  floorLine: 0x8b5a2b,
  sky: 0x2b3f5c,
  star: 0xf7f1c8,
  amber: 0xe0a030,
  teal: 0x3f8f8a,
  screen: 0x1f2a2a,
  phosphor: 0x9fd36b,
} as const;

interface BoardPalette {
  pcb: number;
  pcbDark: number;
  highlight: number;
  fins: number;
  label: string;
}

const HEALTHY_BOARD: BoardPalette = {
  pcb: 0x3f8f8a,
  pcbDark: 0x2c6b67,
  highlight: 0x5fb0a8,
  fins: 0x9fb3ae,
  label: "#eef7f0",
};

const BOARD_PALETTES: Record<GpuVisualState, BoardPalette> = {
  idle: HEALTHY_BOARD,
  reserved: HEALTHY_BOARD,
  running: {
    pcb: 0x4fb3a9,
    pcbDark: 0x2f8a82,
    highlight: 0x8fe0d4,
    fins: 0xd6ecc9,
    label: "#ffffff",
  },
  completed: {
    pcb: 0x5fc0b4,
    pcbDark: 0x2f8a82,
    highlight: 0xf7f1c8,
    fins: 0xf7f1c8,
    label: "#ffffff",
  },
  error: {
    pcb: 0x7a4a44,
    pcbDark: 0x5a332f,
    highlight: 0x9a625a,
    fins: 0xb08f88,
    label: "#f6d5cf",
  },
  offline: {
    pcb: 0x3c4544,
    pcbDark: 0x2b3231,
    highlight: 0x4a5453,
    fins: 0x56605f,
    label: "#8c9796",
  },
};

const MODE_PLATES: Record<ExecutionMode, { text: string; fill: number }> = {
  simulated: { text: "SIMULATED", fill: 0x5b4a8a },
  cpu: { text: "CPU", fill: 0x4a5a58 },
  gpu: { text: "REAL GPU", fill: 0x2c6b67 },
};

/** Fan frame period and lamp blink period in ticks, or null for static. */
const MOTION: Record<GpuVisualState, { fan: number | null; blink: number | null }> = {
  idle: { fan: 4, blink: null },
  reserved: { fan: 4, blink: 4 },
  running: { fan: 1, blink: 2 },
  completed: { fan: 1, blink: 1 },
  error: { fan: null, blink: 3 },
  offline: { fan: null, blink: null },
};

class GpuView {
  private readonly board: Phaser.GameObjects.Graphics;
  private readonly aura: Phaser.GameObjects.Graphics;
  private readonly selection: Phaser.GameObjects.Graphics;
  private readonly hover: Phaser.GameObjects.Graphics;
  private readonly fan: Phaser.GameObjects.Image;
  private readonly lamp: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;
  private readonly badge: Phaser.GameObjects.Image;
  private readonly zone: Phaser.GameObjects.Zone;
  private readonly objects: Phaser.GameObjects.GameObject[];

  private gpu: GpuDevice | null = null;
  private drawnState: GpuVisualState | null = null;
  private selected = false;
  private reducedMotion = false;
  private completedUntil = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly slot: GpuSlotLayout,
    onSelect: (gpuId: string) => void,
  ) {
    const { x, y, width: w, height: h } = slot;
    this.aura = scene.add.graphics();
    this.board = scene.add.graphics();
    this.fan = scene.add.image(x + 2, y + 2, "fan-0").setOrigin(0);
    this.lamp = scene.add.rectangle(x + w - 6, y + 4, 3, 3, 0).setOrigin(0);
    this.label = scene.add.text(x + 17, y + 2, slot.gpuId, FONT).setOrigin(0);
    this.badge = scene.add
      .image(x + w + 1, y - 3, "badge-alert")
      .setOrigin(0)
      .setVisible(false);
    this.selection = scene.add.graphics();
    this.hover = scene.add.graphics().setVisible(false);
    this.hover.lineStyle(1, C.cream).strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);

    this.zone = scene.add
      .zone(x - 2, y - 2, w + 4, h + 4)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true });
    this.zone.on("pointerover", () => this.hover.setVisible(true));
    this.zone.on("pointerout", () => this.hover.setVisible(false));
    this.zone.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (pointer.getDistance() < 4) onSelect(slot.gpuId);
    });

    this.objects = [
      this.aura,
      this.board,
      this.fan,
      this.lamp,
      this.label,
      this.badge,
      this.selection,
      this.hover,
      this.zone,
    ];
  }

  apply(gpu: GpuDevice, selected: boolean, reducedMotion: boolean, now: number): void {
    const wasRunning = this.gpu?.activity === "running";
    if (wasRunning && gpu.activity === "idle" && gpu.health === "healthy") {
      this.completedUntil = now + COMPLETED_FLASH_MS;
    }
    this.gpu = gpu;
    this.reducedMotion = reducedMotion;
    if (selected !== this.selected) {
      this.selected = selected;
      this.drawSelection();
    }
    this.refresh(now, 0);
  }

  private visualState(now: number): GpuVisualState {
    if (!this.gpu) return "offline";
    const state = gpuVisualState(this.gpu);
    return state === "idle" && now < this.completedUntil ? "completed" : state;
  }

  /** Called on every tick; redraws only what changed. */
  refresh(now: number, frame: number): void {
    const state = this.visualState(now);
    if (state !== this.drawnState) {
      this.drawnState = state;
      this.drawBoard(state);
    }

    const motion = MOTION[state];
    const animate = !this.reducedMotion;
    const fanFrame = animate && motion.fan ? Math.floor(frame / motion.fan) % 2 : 0;
    this.fan.setTexture(`fan-${fanFrame}`);

    const lampOn = !animate || !motion.blink || Math.floor(frame / motion.blink) % 2 === 0;
    this.lamp.setFillStyle(color(STATE_STYLES[state].lamp), lampOn ? 1 : 0.3);

    this.aura.setAlpha(animate && frame % 4 >= 2 ? 0.45 : 1);
    if (this.selected) this.selection.setX(animate && frame % 8 >= 4 ? -1 : 0);
  }

  private drawBoard(state: GpuVisualState): void {
    const { x, y, width: w, height: h } = this.slot;
    const p = BOARD_PALETTES[state];
    const g = this.board.clear();

    g.fillStyle(C.ink).fillRect(x, y, w, h);
    g.fillStyle(p.pcb).fillRect(x + 1, y + 1, w - 2, h - 2);
    g.fillStyle(p.highlight).fillRect(x + 1, y + 1, w - 2, 1);
    g.fillStyle(p.pcbDark).fillRect(x + 1, y + h - 2, w - 2, 1);
    g.fillStyle(C.cavity).fillRect(x + 2, y + 2, 8, 8);
    for (let i = 0; i < 3; i++) g.fillStyle(p.fins).fillRect(x + 11 + i * 2, y + 3, 1, 6);
    g.fillStyle(C.ink).fillRect(x + w - 7, y + 3, 5, 5);

    if (state === "reserved") {
      // Amber "claimed" stripe so a reservation reads even between lamp blinks.
      g.fillStyle(C.amber).fillRect(x + 11, y + h - 3, w - 19, 2);
    }

    if (state === "offline") {
      // Diagonal hatching marks a disconnected board without relying on colour alone.
      g.fillStyle(C.ink, 0.45);
      for (let i = 0; i < w + h; i += 4) {
        for (let d = 0; d < h - 2; d++) {
          const px = x + 1 + i - d;
          if (px > x && px < x + w - 1) g.fillRect(px, y + 1 + d, 1, 1);
        }
      }
    }

    this.label.setColor(p.label);
    this.fan.setAlpha(state === "offline" ? 0.4 : 1);

    this.aura.clear();
    if (state === "running" || state === "completed") {
      this.aura
        .lineStyle(1, color(STATE_STYLES.running.lamp))
        .strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
    }

    this.badge.setVisible(state === "error" || state === "offline");
    this.badge.setTexture(state === "offline" ? "badge-offline" : "badge-alert");

    if (state === "completed" && !this.reducedMotion) this.sparkle();
  }

  private drawSelection(): void {
    const { x, y, width: w, height: h } = this.slot;
    const g = this.selection.clear().setAlpha(1).setX(0);
    if (!this.selected) return;
    // Amber frame in the gap between boards, plus a pointer outside the rack.
    g.lineStyle(1, C.amber).strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
    const tipX = x - 10;
    const midY = y + h / 2;
    g.fillStyle(C.ink).fillTriangle(tipX + 1, midY, tipX - 5, midY - 5, tipX - 5, midY + 5);
    g.fillStyle(C.amber).fillTriangle(tipX - 1, midY, tipX - 4, midY - 3, tipX - 4, midY + 3);
  }

  private sparkle(): void {
    const { x, y } = this.slot;
    for (let i = 0; i < 5; i++) {
      const star = this.scene.add.rectangle(x + 8 + i * 11, y, 1, 1, C.star).setOrigin(0);
      this.scene.tweens.add({
        targets: star,
        y: y - 8 - (i % 3) * 3,
        alpha: 0,
        duration: 900,
        delay: i * 60,
        onComplete: () => star.destroy(),
      });
    }
  }

  destroy(): void {
    for (const object of this.objects) object.destroy();
  }
}

export class FacilityScene extends Phaser.Scene {
  private model: FacilityModel | null = null;
  private ready = false;
  private layoutKey = "";
  private frame = 0;
  private readonly views = new Map<string, GpuView>();
  private staticObjects: Phaser.GameObjects.GameObject[] = [];
  private cursor: Phaser.GameObjects.Rectangle | null = null;

  constructor(private readonly bridge: FacilityBridge) {
    super("facility");
  }

  create(): void {
    fanFrames.forEach((frame, i) => this.addSpriteTexture(`fan-${i}`, spriteToCanvas(frame)));
    this.addSpriteTexture("badge-alert", spriteToCanvas(alertBadge));
    this.addSpriteTexture("badge-offline", spriteToCanvas(unpluggedBadge));
    this.addSpriteTexture("plant", spriteToCanvas(pottedPlant));

    this.time.addEvent({ delay: TICK_MS, loop: true, callback: () => this.tick() });
    this.enableDragPan();
    this.ready = true;
    this.applyModel();
  }

  setModel(model: FacilityModel): void {
    this.model = model;
    if (this.ready) this.applyModel();
  }

  private addSpriteTexture(key: string, canvas: HTMLCanvasElement): void {
    if (!this.textures.exists(key)) this.textures.addCanvas(key, canvas);
  }

  private applyModel(): void {
    const model = this.model;
    if (!model) return;
    try {
      const layout = computeFacilityLayout(model.gpus, model.workers);
      const key = JSON.stringify(layout);
      if (key !== this.layoutKey) {
        this.layoutKey = key;
        this.rebuild(layout.racks, layout.worldWidth, model.workers);
      }
      const now = this.time.now;
      for (const gpu of model.gpus) {
        this.views
          .get(gpu.id)
          ?.apply(gpu, gpu.id === model.selectedGpuId, model.reducedMotion, now);
      }
    } catch (error) {
      this.bridge.onError(error);
    }
  }

  private tick(): void {
    this.frame++;
    const now = this.time.now;
    for (const view of this.views.values()) view.refresh(now, this.frame);
    const animate = !this.model?.reducedMotion;
    this.cursor?.setVisible(!animate || this.frame % 8 < 4);
  }

  private rebuild(racks: RackLayout[], worldWidth: number, workers: readonly Worker[]): void {
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
    for (const object of this.staticObjects) object.destroy();
    this.staticObjects = [];

    this.cameras.main.setBounds(0, 0, worldWidth, VIEW_HEIGHT);
    this.drawRoom(worldWidth, racks);
    for (const rack of racks) {
      const worker = workers.find((w) => w.id === rack.workerId) ?? null;
      this.drawRack(rack, worker);
      for (const slot of rack.gpus) {
        this.views.set(slot.gpuId, new GpuView(this, slot, (id) => this.bridge.onSelectGpu(id)));
      }
    }
  }

  private keep<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.staticObjects.push(object);
    return object;
  }

  private drawRoom(worldWidth: number, racks: RackLayout[]): void {
    const g = this.keep(this.add.graphics());

    // Wall with vertical panelling
    g.fillStyle(C.wall).fillRect(0, 0, worldWidth, FLOOR_Y);
    g.fillStyle(C.wallLine);
    for (let x = 12; x < worldWidth; x += 24) g.fillRect(x, 0, 1, 118);

    // Wainscot
    g.fillStyle(C.wood).fillRect(0, 120, worldWidth, FLOOR_Y - 120);
    g.fillStyle(C.woodDark).fillRect(0, 118, worldWidth, 2);
    g.fillStyle(C.woodDark);
    for (let x = 8; x < worldWidth; x += 16) g.fillRect(x, 124, 1, 22);
    g.fillStyle(C.ink).fillRect(0, FLOOR_Y - 1, worldWidth, 1);

    // Floorboards
    g.fillStyle(C.floor).fillRect(0, FLOOR_Y, worldWidth, VIEW_HEIGHT - FLOOR_Y);
    g.fillStyle(C.floorLine);
    for (let row = 0, y = FLOOR_Y + 8; y < VIEW_HEIGHT; y += 9, row++) {
      g.fillRect(0, y, worldWidth, 1);
      for (let x = (row % 2) * 24; x < worldWidth; x += 48) g.fillRect(x, y - 8, 1, 8);
    }

    this.drawWindow(g, 16, 18);
    this.drawDesk(g, 16, 156);

    // Rack shadows and cable tray linking every rack
    for (const rack of racks) {
      g.fillStyle(C.ink, 0.25).fillRect(rack.x + 2, RACK_BASE_Y + 1, rack.width, 4);
    }
    const first = racks[0];
    const last = racks.at(-1);
    if (first && last) {
      const trayY = Math.min(...racks.map((r) => r.y)) - 12;
      g.fillStyle(C.railLight).fillRect(first.x + 8, trayY, last.x + last.width - first.x - 16, 3);
      g.fillStyle(C.ink).fillRect(first.x + 8, trayY + 3, last.x + last.width - first.x - 16, 1);
      for (const rack of racks) {
        for (const offset of [18, rack.width - 20]) {
          g.fillStyle(C.ink).fillRect(rack.x + offset, trayY + 4, 2, rack.y - trayY - 4);
        }
      }

      const signWidth = 104;
      const centre = Math.round((first.x + last.x + last.width) / 2);
      const signX = centre - signWidth / 2;
      const signY = Math.max(6, trayY - 28);
      g.fillStyle(C.ink)
        .fillRect(signX + 12, 0, 1, signY)
        .fillRect(signX + signWidth - 13, 0, 1, signY);
      g.fillStyle(C.ink).fillRect(signX, signY, signWidth, 14);
      g.fillStyle(C.woodLight).fillRect(signX + 1, signY + 1, signWidth - 2, 12);
      g.fillStyle(C.wood).fillRect(signX + 1, signY + 11, signWidth - 2, 2);
      this.keep(
        this.add
          .text(centre, signY + 3, "PIXELGPU FACILITY", { ...FONT, color: "#fbf5e6" })
          .setOrigin(0.5, 0),
      );
    }

    this.keep(
      this.add
        .image(worldWidth - 32, RACK_BASE_Y + 4, "plant")
        .setOrigin(0, 1)
        .setScale(2),
    );
  }

  private drawWindow(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    const w = 64;
    const h = 46;
    g.fillStyle(C.ink).fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle(C.woodDark).fillRect(x, y, w, h);
    g.fillStyle(C.sky).fillRect(x + 3, y + 3, w - 6, h - 6);
    g.fillStyle(C.star);
    for (const [sx, sy] of [
      [9, 8],
      [22, 14],
      [40, 7],
      [50, 20],
      [14, 26],
      [33, 30],
    ] as const) {
      g.fillRect(x + sx, y + sy, 1, 1);
    }
    g.fillStyle(0xf7f1c8).fillRect(x + 44, y + 8, 6, 6);
    g.fillStyle(C.sky).fillRect(x + 47, y + 7, 4, 5);
    g.fillStyle(C.woodDark)
      .fillRect(x + w / 2 - 1, y, 2, h)
      .fillRect(x, y + h / 2 - 1, w, 2);
    g.fillStyle(C.ink).fillRect(x - 3, y + h, w + 6, 3);
    g.fillStyle(C.woodLight).fillRect(x - 2, y + h, w + 4, 2);
  }

  private drawDesk(g: Phaser.GameObjects.Graphics, x: number, top: number): void {
    const w = 70;
    // Monitor
    g.fillStyle(C.ink).fillRect(x + 10, top - 26, 32, 24);
    g.fillStyle(0xd8d0bc).fillRect(x + 11, top - 25, 30, 22);
    g.fillStyle(C.screen).fillRect(x + 13, top - 23, 26, 15);
    g.fillStyle(C.phosphor, 0.8);
    g.fillRect(x + 15, top - 21, 14, 1)
      .fillRect(x + 15, top - 18, 18, 1)
      .fillRect(x + 15, top - 15, 9, 1);
    g.fillStyle(0xb8af99).fillRect(x + 22, top - 3, 8, 3);
    this.cursor = this.keep(this.add.rectangle(x + 15, top - 12, 3, 2, C.phosphor).setOrigin(0));
    // Keyboard and mug
    g.fillStyle(C.ink).fillRect(x + 46, top - 3, 16, 3);
    g.fillStyle(0xd8d0bc).fillRect(x + 47, top - 3, 14, 2);
    g.fillStyle(C.ink).fillRect(x + 2, top - 6, 5, 6);
    g.fillStyle(0xc4513d).fillRect(x + 3, top - 5, 3, 5);
    // Desk
    g.fillStyle(C.ink).fillRect(x, top, w, 5);
    g.fillStyle(C.woodLight).fillRect(x + 1, top + 1, w - 2, 3);
    g.fillStyle(C.ink)
      .fillRect(x + 3, top + 5, 3, 26)
      .fillRect(x + w - 6, top + 5, 3, 26);
  }

  private drawRack(rack: RackLayout, worker: Worker | null): void {
    const { x, y, width: w, height: h } = rack;
    const g = this.keep(this.add.graphics());

    g.fillStyle(C.ink).fillRect(x, y, w, h);
    g.fillStyle(C.wood).fillRect(x + 1, y + 1, w - 2, h - 2);
    g.fillStyle(C.woodLight)
      .fillRect(x + 1, y + 1, w - 2, 1)
      .fillRect(x + 1, y + 1, 1, h - 2);
    g.fillStyle(C.woodDark).fillRect(x + w - 2, y + 1, 1, h - 2);
    g.fillStyle(C.cavity).fillRect(
      x + 5,
      y + RACK_CAP - 1,
      w - 10,
      rack.slotCount * SLOT_PITCH + 2,
    );

    const filled = new Set(rack.gpus.map((gpu) => gpu.slot));
    for (let slot = 1; slot <= rack.slotCount; slot++) {
      const sy = y + RACK_CAP + (slot - 1) * SLOT_PITCH;
      g.fillStyle(C.railLight).fillRect(x + 5, sy, w - 10, 1);
      g.fillStyle(C.rail).fillRect(x + 5, sy + SLOT_PITCH - 1, w - 10, 1);
      if (!filled.has(slot)) {
        g.fillStyle(C.rail).fillRect(x + 8, sy + 2, w - 16, SLOT_PITCH - 4);
      }
    }

    // Name plaque
    g.fillStyle(C.ink).fillRect(x + 10, y + 2, w - 20, 10);
    g.fillStyle(C.parchment).fillRect(x + 11, y + 3, w - 22, 8);
    this.keep(
      this.add
        .text(x + w / 2, y + 3, `RACK ${rack.rack}`, { ...FONT, color: "#2b2118" })
        .setOrigin(0.5, 0),
    );

    // Execution-mode plate on the base, so the scene never hides what kind of hardware this is
    const plate = worker ? MODE_PLATES[worker.execution_mode] : { text: "NO WORKER", fill: C.rail };
    const baseY = y + h - RACK_BOTTOM;
    g.fillStyle(plate.fill).fillRect(x + 5, baseY + 1, w - 10, RACK_BOTTOM - 2);
    this.keep(
      this.add.text(x + w / 2, baseY, plate.text, { ...FONT, color: "#fbf5e6" }).setOrigin(0.5, 0),
    );

    g.fillStyle(C.ink)
      .fillRect(x + 3, y + h, 4, 3)
      .fillRect(x + w - 7, y + h, 4, 3);
  }

  private enableDragPan(): void {
    const camera = this.cameras.main;
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return;
      camera.scrollX -= (pointer.x - pointer.prevPosition.x) / camera.zoom;
    });
  }
}
