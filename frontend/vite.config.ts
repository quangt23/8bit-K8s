/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies /api to the FastAPI backend so the browser only ever
// talks to one origin and no CORS configuration is needed during development.
const backendUrl = process.env.PIXELGPU_BACKEND_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: backendUrl, changeOrigin: true },
    },
  },
  build: {
    // Phaser (~1.4 MB, ~360 kB gzipped) is lazy-loaded in its own chunk, after the UI renders.
    chunkSizeWarningLimit: 1500,
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": { target: backendUrl, changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
