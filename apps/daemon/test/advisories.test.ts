import { expect, test } from "bun:test";

import { AdvisoryWatch } from "@/domain/advisories";
import { Revocations, Verdicts } from "@/domain/decisions";
import { Model } from "@/domain/model";
import { createFakePorts, fakeRegistryFetch, generateScenario } from "@/github/fake/scenario";
import { ReleaseRegistry } from "@/registry/release";
import { memoryStores } from "@/store/db";

// Two sandbox repos carry typescript 5.9.3.
const KEY = "npm:typescript@5.9.3";

async function setup() {
  const world = generateScenario({ preset: "sandbox" });
  const stores = memoryStores();
  const model = new Model(stores.cache);
  const you = createFakePorts(world).get("binbandit")!;
  for (const { doc, viewer } of await you.hydrate([...world.prs.keys()])) {
    model.upsert(doc, viewer, "binbandit");
  }
  const verdicts = new Verdicts(stores.state);
  const revocations = new Revocations(stores.state);
  const registry = new ReleaseRegistry(
    stores.cache,
    async () => null,
    () => [],
    fakeRegistryFetch(world),
  );
  const watch = new AdvisoryWatch({ model, verdicts, revocations, registry });
  const release = world.release("npm", "typescript", "5.9.3")!;
  return { verdicts, revocations, watch, release };
}

test("an advisory published after the verdict withdraws it", async () => {
  const { verdicts, revocations, watch, release } = await setup();
  verdicts.record(KEY, "patch", 14);
  expect(await watch.check()).toBe(0);

  release.advisories.push("GHSA-late-late-late");
  expect(await watch.check()).toBe(1);
  expect(verdicts.active(KEY)).toEqual([]);
  expect(revocations.open()).toMatchObject([
    { key: KEY, pkg: "typescript", to: "5.9.3", advisories: ["GHSA-late-late-late"] },
  ]);
});

test("one you knew about when deciding doesn't, but the next one does, even once dismissed", async () => {
  const { verdicts, revocations, watch, release } = await setup();
  release.advisories.push("GHSA-seen-seen-seen");
  verdicts.record(KEY, "patch", 14, ["GHSA-seen-seen-seen"]);
  expect(await watch.check()).toBe(0);
  expect(verdicts.active(KEY)).toHaveLength(1);

  release.advisories.push("GHSA-next-next-next");
  expect(await watch.check()).toBe(1);
  revocations.dismiss(KEY);
  expect(revocations.open()).toEqual([]);

  // Decided again, knowing both; a third advisory raises the notice again.
  verdicts.record(KEY, "patch", 14, ["GHSA-next-next-next", "GHSA-seen-seen-seen"]);
  release.advisories.push("GHSA-more-more-more");
  expect(await watch.check()).toBe(1);
  expect(revocations.open()).toMatchObject([{ key: KEY, advisories: ["GHSA-more-more-more"] }]);
});
