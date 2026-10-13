import { expect, test } from "bun:test";

import { createApp } from "@/app";
import {
  createFakeAccounts,
  createFakePorts,
  fakeDefaults,
  fakeRegistryFetch,
  generateScenario,
} from "@/github/fake/scenario";
import type { FaultKind } from "@/github/fake/world";
import { memoryStores } from "@/store/db";

/** The status line's state just after the first notification poll fails as `kind` says. */
async function afterOneFailure(kind: FaultKind) {
  const world = generateScenario({ preset: "sandbox" });
  world.faults.push({ account: "binbandit", method: "notifications", kind });
  const app = createApp({
    stores: memoryStores(),
    accounts: createFakeAccounts(world),
    ports: createFakePorts(world),
    fetcher: fakeRegistryFetch(world),
    defaults: fakeDefaults(world, "sandbox"),
  });
  app.sync.start();
  await Bun.sleep(300);
  const status = app.sync.getStatus();
  app.stop();
  expect(world.faults).toHaveLength(0);
  return status;
}

test("one GitHub hiccup is retried quietly", async () => {
  expect((await afterOneFailure("server")).state).not.toBe("error");
});

test("a limit GitHub sets shows at once", async () => {
  const status = await afterOneFailure("secondary-limit");
  expect(status.state).toBe("error");
  expect(status.message).toContain("Reading notifications failed: rate limited");
});
