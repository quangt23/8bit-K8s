import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

// Dedicated ports so browser tests never collide with a running `make dev`.
const BACKEND_PORT = 8765;
const FRONTEND_PORT = 5199;
// A fresh database per run, so browser tests never touch the dev database.
const DATABASE_URL = `sqlite:///${join(tmpdir(), `pixelgpu-e2e-${process.pid}.db`)}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "uv run python -m pixelgpu",
      cwd: "../backend",
      url: `http://127.0.0.1:${BACKEND_PORT}/api/health`,
      env: {
        PIXELGPU_PORT: String(BACKEND_PORT),
        PIXELGPU_ENVIRONMENT: "test",
        PIXELGPU_DATABASE_URL: DATABASE_URL,
      },
      reuseExistingServer: false,
    },
    {
      command: `npx vite --port ${FRONTEND_PORT} --strictPort`,
      url: `http://localhost:${FRONTEND_PORT}`,
      env: { PIXELGPU_BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}` },
      reuseExistingServer: false,
    },
  ],
});
