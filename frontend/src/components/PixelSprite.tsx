import { useMemo } from "react";

export type SpritePalette = Readonly<Record<string, string>>;

export interface Sprite {
  /** One string per row; each character is a palette key, "." is transparent. */
  rows: readonly string[];
  palette: SpritePalette;
}

interface PixelSpriteProps {
  sprite: Sprite;
  /** Rendered size of one sprite pixel, in CSS pixels. */
  scale?: number;
  /** Accessible name. When omitted the sprite is treated as decorative. */
  label?: string;
  /** Optional CSS class per palette key, e.g. to animate lamp pixels. */
  pixelClasses?: Readonly<Record<string, string>>;
  className?: string;
}

interface Run {
  x: number;
  y: number;
  width: number;
  key: string;
}

/** Merge horizontal runs of the same colour so large sprites stay cheap to render. */
function toRuns(rows: readonly string[]): Run[] {
  const runs: Run[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const key = row[x] ?? ".";
      let end = x + 1;
      while (end < row.length && row[end] === key) end++;
      if (key !== ".") runs.push({ x, y, width: end - x, key });
      x = end;
    }
  });
  return runs;
}

/** Renders a character-map sprite as crisp SVG pixel art. */
export function PixelSprite({
  sprite,
  scale = 4,
  label,
  pixelClasses,
  className,
}: PixelSpriteProps) {
  const runs = useMemo(() => toRuns(sprite.rows), [sprite.rows]);
  const height = sprite.rows.length;
  const width = Math.max(0, ...sprite.rows.map((row) => row.length));

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      width={width * scale}
      height={height * scale}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {runs.map((run) => (
        <rect
          key={`${run.x}-${run.y}`}
          x={run.x}
          y={run.y}
          width={run.width}
          height={1}
          fill={sprite.palette[run.key] ?? "transparent"}
          className={pixelClasses?.[run.key]}
        />
      ))}
    </svg>
  );
}
