import Phaser from "phaser";

import { FacilityScene, type FacilityBridge, type FacilityModel } from "./FacilityScene";
import { VIEW_HEIGHT, VIEW_WIDTH } from "./layout";

export interface FacilityHandle {
  setModel(model: FacilityModel): void;
  destroy(): void;
}

/** Canvas text needs the pixel font loaded first, or labels render in a fallback font. */
async function loadSceneFont(): Promise<void> {
  try {
    await Promise.race([
      document.fonts.load('8px "Silkscreen"'),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch {
    // The scene still works with the fallback monospace font.
  }
}

/** Resolves to null if `signal` aborts before the game is created. */
export async function createFacilityGame(
  parent: HTMLElement,
  bridge: FacilityBridge,
  signal: AbortSignal,
): Promise<FacilityHandle | null> {
  await loadSceneFont();
  if (signal.aborted) return null;
  const scene = new FacilityScene(bridge);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: "#a8c6b4",
    banner: false,
    audio: { noAudio: true },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
    scene,
  });
  return {
    setModel: (model) => scene.setModel(model),
    destroy: () => {
      // Phaser defers destroy to its game loop, which only runs once booted.
      if (game.isBooted) game.destroy(true);
      else game.events.once(Phaser.Core.Events.READY, () => game.destroy(true));
    },
  };
}
