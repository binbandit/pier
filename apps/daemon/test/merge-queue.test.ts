import { afterEach, expect, test } from "bun:test";

import { createHandlers } from "@/api/handlers";
import { createApp } from "@/app";
import {
  createFakeAccounts,
  createFakePorts,
  fakeDefaults,
  fakeRegistryFetch,
  generateScenario,
} from "@/github/fake/scenario";
import { volatileHash, volatileOf } from "@/github/pr-doc";
import { memoryStores } from "@/store/db";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup() {
  const world = generateScenario({ preset: "sandbox" });
  const ports = createFakePorts(world);
  const stores = memoryStores();
  const app = createApp({
    stores,
    accounts: createFakeAccounts(world),
    ports,
    fetcher: fakeRegistryFetch(world),
    defaults: fakeDefaults(world, "sandbox"),
  });
  cleanups.push(() => {
    app.stop();
    stores.cache.close();
    stores.state.close();
  });
  const port = ports.get("binbandit")!;
  const prs = [...world.prs.values()].filter(
    (pr) => pr.repo.fullName === "WastedHippie/sandbox-api" && pr.state === "OPEN",
  );
  const first = prs[0]!;
  const second = prs[1]!;
  const waiting = prs[2]!;
  for (const pr of prs) {
    pr.autoMerge = null;
    pr.queuePosition = null;
  }
  first.repo.mergeQueue = true;
  await port.enqueue(first.id, world.head(first), false);
  await port.enqueue(second.id, world.head(second), false);
  await port.setAutoMerge(waiting.id, "SQUASH", world.head(waiting));
  for (const result of await port.hydrate(prs.map((pr) => pr.id)))
    app.model.upsert(result.doc, result.viewer, "binbandit");
  return { app, world, port, first, second, waiting, handlers: createHandlers(app) };
}

test("merge queue RPC includes ordered GitHub entries and armed auto-merges, then removes finished PRs", async () => {
  const { app, handlers, first, second, waiting } = await setup();
  const queue = await handlers.mergeQueue({});
  expect(queue.map((item) => [item.id, item.position, item.autoMerge])).toEqual([
    [first.id, 1, null],
    [second.id, 2, null],
    [waiting.id, null, "SQUASH"],
  ]);
  expect(queue.every((item) => item.baseRefName === first.baseRefName)).toBe(true);
  const record = app.model.get(first.id)!;
  app.model.upsert(
    { ...record.doc, state: "MERGED" },
    record.viewers.get("binbandit")!,
    "binbandit",
  );
  expect((await handlers.mergeQueue({})).map((item) => item.id)).toEqual([second.id, waiting.id]);
});

test("queue position changes alone update the cached queue and its sync fingerprint", async () => {
  const { app, handlers, second } = await setup();
  const record = app.model.get(second.id)!;
  const before = volatileOf({ ...record.doc, mergeQueue: { position: 2, state: "QUEUED" } });
  app.model.upsert(
    { ...record.doc, mergeQueue: before.mergeQueue },
    record.viewers.get("binbandit")!,
    "binbandit",
  );
  const after = { ...before, mergeQueue: { position: 1, state: "QUEUED" } };
  expect(volatileHash(after)).not.toBe(volatileHash(before));
  expect(app.model.applyVolatile(after)).toBe("patched");
  expect((await handlers.mergeQueue({})).find((item) => item.id === second.id)?.position).toBe(1);
});
