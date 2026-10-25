import type { Sprite } from "./PixelSprite";

/** Shared colours for original PixelGPU sprites. Keep in sync with styles/tokens.css. */
const ink = "#2b2118";

export const serverRack: Sprite = {
  palette: {
    K: ink,
    W: "#8b5a2b", // wood frame
    w: "#5c3a1e", // wood shadow
    H: "#6f8583", // slot highlight
    S: "#4a5a58", // steel
    s: "#2b3b3a", // steel shadow
    G: "#3f8f8a", // GPU board
    g: "#2c6b67", // GPU board shadow
    V: "#1b2423", // vent
    L: "#9fd36b", // green lamp
    A: "#e0a030", // amber lamp
    D: "#55614f", // unlit lamp
  },
  rows: [
    "KKKKKKKKKKKKKKKK",
    "KWWWWWWWWWWWWWWK",
    "KWwwwwwwwwwwwwWK",
    "KWKKKKKKKKKKKKWK",
    "KWKHHHHHHHHHHKWK",
    "KWKSGGGGgVVLSKWK",
    "KWKssssssssssKWK",
    "KWKHHHHHHHHHHKWK",
    "KWKSGGGGgVVDSKWK",
    "KWKssssssssssKWK",
    "KWKHHHHHHHHHHKWK",
    "KWKSGGGGgVVASKWK",
    "KWKssssssssssKWK",
    "KWKHHHHHHHHHHKWK",
    "KWKSGGGGgVVDSKWK",
    "KWKssssssssssKWK",
    "KWKKKKKKKKKKKKWK",
    "KWwwwwwwwwwwwwWK",
    "KWWWWWWWWWWWWWWK",
    "KKKKKKKKKKKKKKKK",
    ".Kw..........wK.",
    ".KK..........KK.",
  ],
};

export const pottedPlant: Sprite = {
  palette: {
    K: ink,
    L: "#6a994e",
    l: "#3f6b2f",
    c: "#c4703d",
    C: "#9a5230",
  },
  rows: [
    "..LL.L..",
    ".LlLLlL.",
    "LlL.LlLL",
    ".LLlLL..",
    "..LlL...",
    "...l....",
    ".KKKKKK.",
    ".KccccK.",
    ".KcccCK.",
    "..KKKK..",
  ],
};

export const logoChip: Sprite = {
  palette: {
    K: ink,
    w: "#5c3a1e",
    s: "#2b3b3a",
    G: "#3f8f8a",
    A: "#e0a030",
    L: "#9fd36b",
  },
  rows: [
    ".w.w.w.w.w.w.",
    "KKKKKKKKKKKKK",
    "KsssssssssssK",
    "KsGGGGsGGGGsK",
    "KsGAAGsGLLGsK",
    "KsGAAGsGLLGsK",
    "KsGGGGsGGGGsK",
    "KsssssssssssK",
    "KKKKKKKKKKKKK",
    ".w.w.w.w.w.w.",
  ],
};
