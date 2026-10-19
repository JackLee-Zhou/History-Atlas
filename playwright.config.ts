import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const E2E_PORT = 3211;
const E2E_DATA_DIR = path.join(process.cwd(), ".data-e2e");
const E2E_DIST_DIR = ".next-e2e";
const E2E_CHANNEL = process.env.PLAYWRIGHT_CHANNEL?.trim();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next dev -p ${E2E_PORT}`,
    url: `http://127.0.0.1:${E2E_PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATA_DIR: E2E_DATA_DIR,
      NEXT_DIST_DIR: E2E_DIST_DIR,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Local runs can reuse system Chrome (PLAYWRIGHT_CHANNEL=chrome) and
        // avoid downloading the bundled browser.
        ...(E2E_CHANNEL ? { channel: E2E_CHANNEL } : {}),
      },
    },
  ],
});
