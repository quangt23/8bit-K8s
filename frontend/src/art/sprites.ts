import type { Sprite } from "../components/PixelSprite";

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

const fanPalette = { K: "#141b1a", B: "#9fb3ae", c: "#e9f5ee" };

/** Two-frame cooling fan; alternating frames reads as spinning at pixel scale. */
export const fanFrames: readonly Sprite[] = [
  {
    palette: fanPalette,
    rows: [
      "..KKKK..",
      ".K.BB.K.",
      "K..BB..K",
      "KBBccBBK",
      "KBBccBBK",
      "K..BB..K",
      ".K.BB.K.",
      "..KKKK..",
    ],
  },
  {
    palette: fanPalette,
    rows: [
      "..KKKK..",
      ".KB..BK.",
      "K.BBBB.K",
      "K..cc..K",
      "K..cc..K",
      "K.BBBB.K",
      ".KB..BK.",
      "..KKKK..",
    ],
  },
];

export const alertBadge: Sprite = {
  palette: { K: ink, R: "#d9503c", W: "#fbf5e6" },
  rows: [".KKKKK.", "KRRWRRK", "KRRWRRK", "KRRWRRK", "KRRRRRK", "KRRWRRK", ".KKKKK.", "..KK..."],
};

export const unpluggedBadge: Sprite = {
  palette: { K: ink, G: "#8c9796", W: "#fbf5e6" },
  rows: [".KKKKK.", "KGGGGGK", "KGWGWGK", "KGGWGGK", "KGWGWGK", "KGGGGGK", ".KKKKK.", "..KK..."],
};
