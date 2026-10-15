import { afterEach, expect, test } from "bun:test";

import { createHandlers } from "@/api/handlers";
import { createApp } from "@/app";
import { PrReads, prActivityCursor } from "@/domain/pr-reads";
import {
  createFakeAccounts,
  createFakePorts,
  fakeDefaults,
  fakeRegistryFetch,
  generateScenario,
} from "@/github/fake/scenario";
import type { PrDoc } from "@/github/pr-doc";
import { memoryStores } from "@/store/db";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup(number = 8) {
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
  const pr = [...world.prs.values()].find(
    (candidate) =>
      candidate.repo.fullName === "WastedHippie/sandbox-web" && candidate.number === number,
  )!;
  const [read] = await ports.get("binbandit")!.hydrate([pr.id]);
  app.model.upsert(read!.doc, read!.viewer, "binbandit");
  app.model.addScope(pr.id, "binbandit", "binbandit:involved");
  const record = app.model.get(pr.id)!;
  const handlers = createHandlers(app);
  const change = (fields: Partial<PrDoc>) => {
    const current = app.model.get(pr.id)!;
    app.model.upsert({ ...current.doc, ...fields }, current.viewers.get("binbandit")!, "binbandit");
  };
  const mark = (cursor = prActivityCursor(app.model.get(pr.id)!.doc)) =>
    handlers.markPrRead({
      prId: pr.id,
      account: "binbandit",
      cursor,
    });
  const activity = () => app.views.search(`repo:${record.doc.repo}`).items[0]?.activity;
  return { app, stores, record, handlers, change, mark, activity };
}

test("only a displayed version is marked read; reads persist and later activity stays unread", async () => {
  const { app, stores, record, handlers, change, mark, activity } = await setup();
  expect(activity()).toBe("new");
  const view = await handlers.pr({ repo: record.doc.repo, number: record.doc.number });
  expect(view?.detailLoaded).toBe(true);
  expect(activity()).toBe("new"); // Fetching/preloading a PR is not viewing it.
  await mark(view!.activityCursor!);
  expect(activity()).toBe("read");
  expect(new PrReads(stores.state).activity(record.doc, "binbandit")).toBe("read");
  expect(new PrReads(stores.state).activity(record.doc, "another-account")).toBe("new");
  const version = app.reads.version;
  await mark(view!.activityCursor!);
  expect(app.reads.version).toBe(version);

  change({ updatedAt: "2099-01-01T00:00:00Z" });
  expect(activity()).toBe("updated");
  await mark(view!.activityCursor!);
  expect(activity()).toBe("updated"); // A late acknowledgement cannot consume a newer update.
  expect(app.views.inbox("review")[0]).toMatchObject({ activity: "updated" });
  await mark();
  expect(activity()).toBe("read");
  await mark(view!.activityCursor!);
  expect(activity()).toBe("read"); // Nor can an old tab replace the latest read cursor.
  expect(
    (await handlers.searchGitHub({ q: `repo:${record.doc.repo} is:open` })).items.find(
      (item) => item.id === record.doc.id,
    )?.activity,
  ).toBe("read");
});

test("a failed conversation refresh does not acknowledge unseen activity", async () => {
  const { app, record, handlers, change, mark, activity } = await setup();
  await handlers.pr({ repo: record.doc.repo, number: record.doc.number });
  await mark();
  change({ updatedAt: "2099-01-01T00:00:00Z" });
  app.ports.get("binbandit")!.detail = async () => {
    throw new Error("offline");
  };
  const view = await handlers.pr({ repo: record.doc.repo, number: record.doc.number });
  expect(view?.detailLoaded).toBe(true);
  expect(view?.activityCursor).toBeNull();
  expect(activity()).toBe("updated");
});

test("CI-only updates and new heads are visible without a new activity timestamp", async () => {
  const { app, record, change, mark, activity } = await setup();
  await mark();
  change({
    checks: {
      state: "success",
      total: 1,
      failing: 0,
      pending: 0,
      contexts: [{ name: "test", state: "success" }],
    },
  });
  expect(activity()).toBe("updated");
  await mark();
  change({ headRefOid: "a".repeat(40) });
  expect(activity()).toBe("updated");
  await mark();
  const checks = app.model.get(record.doc.id)!.doc.checks;
  change({ checks: { ...checks, contexts: checks.contexts.toReversed() } });
  expect(activity()).toBe("read");
});

for (const [number, split] of [
  [8, "review"],
  [9, "mine"],
] as const) {
  test(`viewed PRs waiting on others return to ${split} on an update`, async () => {
    const { app, record, change, mark } = await setup(number);
    change({
      checks: { state: "success", total: 0, failing: 0, pending: 0, contexts: [] },
      reviewDecision: "review_required",
      reviewRequests: [],
    });
    if (split === "review") {
      app.model.upsert(
        app.model.get(record.doc.id)!.doc,
        {
          latestReview: { state: "APPROVED", submittedAt: null, commitOid: record.doc.headRefOid },
        },
        "binbandit",
      );
    }
    await mark();
    expect(app.views.inbox(split)).toEqual([]);
    expect(app.views.flight()).toContainEqual(
      expect.objectContaining({ prId: record.doc.id, activity: "read" }),
    );
    change({ updatedAt: "2099-01-01T00:00:00Z" });
    expect(app.views.inbox(split)).toContainEqual(
      expect.objectContaining({ id: record.doc.id, activity: "updated" }),
    );
    expect(app.views.flight()).toEqual([]);
    await mark();
    expect(app.views.inbox(split)).toEqual([]);
    expect(app.views.flight()).toHaveLength(1);
  });
}

test("Done stays hidden until another change, including CI changes", async () => {
  const { app, record, handlers, change, mark } = await setup();
  await mark();
  // A decision stored by an older build is still honored.
  app.done.mark(`pr:${record.doc.id}`, `${record.doc.updatedAt}:${record.doc.headRefOid}`);
  expect(app.views.inbox("review")).toEqual([]);
  change({ updatedAt: "2099-01-01T00:00:00Z" });
  expect(app.views.inbox("review")).toHaveLength(1);
  await handlers.markDone({ keys: [`pr:${record.doc.id}`] });
  expect(app.views.inbox("review")).toEqual([]);
  change({ checks: { state: "success", total: 0, failing: 0, pending: 0, contexts: [] } });
  expect(app.views.inbox("review")).toHaveLength(1);
});
