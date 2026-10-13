import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig } from "@playwright/test";

// End-to-end flows run the built binary against the fake sandbox world with a fresh data folder,
// so nothing touches GitHub. `bun run e2e` builds first. The flows share one world, so they run
// one at a time, in order.

const port = 4490;

export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1600, height: 1000 },
    colorScheme: "dark",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "../apps/daemon/dist/pier serve",
    env: {
      PIER_FAKE: "sandbox",
      PIER_PORT: String(port),
      PIER_HOME: mkdtempSync(join(tmpdir(), "pier-e2e-")),
    },
    url: `http://127.0.0.1:${port}/inbox/review`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
