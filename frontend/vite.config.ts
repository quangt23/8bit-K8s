/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { createLogger, defineConfig } from "vite";

// The dev server proxies /api to the FastAPI backend so the browser only ever
// talks to one origin and no CORS configuration is needed during development.
const backendUrl = process.env.PIXELGPU_BACKEND_URL ?? "http://127.0.0.1:8000";

// Browsers drop live WebSockets abruptly on reload or tab close, and Vite's proxy then
// logs "ws proxy (socket) error: EPIPE/ECONNRESET". Those are expected; hide just them.
const EXPECTED_SOCKET_ERRORS = new Set(["EPIPE", "ECONNRESET"]);
const logger = createLogger();
const logError = logger.error.bind(logger);
logger.error = (message, options) => {
  const code = (options?.error as NodeJS.ErrnoException | undefined)?.code;
  if (code && EXPECTED_SOCKET_ERRORS.has(code) && message.includes("ws proxy")) return;
  logError(message, options);
};

const apiProxy = { target: backendUrl, changeOrigin: true, ws: true };

export default defineConfig({
  plugins: [react()],
  customLogger: logger,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": apiProxy,
    },
  },
  build: {
    // Phaser (~1.4 MB, ~360 kB gzipped) is lazy-loaded in its own chunk, after the UI renders.
    chunkSizeWarningLimit: 1500,
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": apiProxy,
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
