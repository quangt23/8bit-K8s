import type { Sprite } from "../components/PixelSprite";

/** Rasterise a character-map sprite onto a canvas, one canvas pixel per sprite pixel. */
export function spriteToCanvas(sprite: Sprite): HTMLCanvasElement {
  const width = Math.max(0, ...sprite.rows.map((row) => row.length));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = sprite.rows.length;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is not available");
  sprite.rows.forEach((row, y) => {
    [...row].forEach((key, x) => {
      const colour = sprite.palette[key];
      if (key === "." || !colour) return;
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, 1, 1);
    });
  });
  return canvas;
}
