import { expect, test } from "bun:test";

import { Model } from "@/domain/model";
import { searchRecords } from "@/domain/search";
import { createFakePorts, generateScenario } from "@/github/fake/scenario";
import { memoryStores } from "@/store/db";
import { parseQuery } from "@pier/core/query";

const NOW = Date.parse("2026-10-13T12:00:00Z");

async function setup() {
  const world = generateScenario({ preset: "sandbox", clock: "manual", start: NOW });
  const you = createFakePorts(world).get("binbandit")!;
  const model = new Model(memoryStores().cache);
  for (const { doc, viewer } of await you.hydrate([...world.prs.keys()])) {
    model.upsert(doc, viewer, "binbandit");
  }
  const records = [...model.all()];
  const find = (q: string) =>
    searchRecords(records, parseQuery(q), {
      you: ["binbandit"],
      turn: new Set(),
      bots: new Map(),
      now: NOW,
    }).map((r) => r.doc);
  return { world, find };
}

test("qualifiers narrow the way GitHub's do, and words match titles", async () => {
  const { find } = await setup();
  const sage = find("is:open author:sage-smudge");
  expect(sage.length).toBeGreaterThan(0);
  expect(sage.every((d) => d.state === "OPEN" && d.author?.login === "sage-smudge")).toBe(true);

  expect(find("cursors").map((d) => d.title)).toContain("Paginate events with cursors");
  expect(find("cursors -author:sage-smudge").every((d) => d.author?.login !== "sage-smudge")).toBe(
    true,
  );
  // Comma means either; quotes keep a value whole.
  const labelled = find('repo:WastedHippie/sandbox-api label:"go",docker');
  expect(labelled.length).toBe(3);
  expect(labelled.every((d) => d.repo === "WastedHippie/sandbox-api")).toBe(true);
  expect(
    find("review-requested:@me").every((d) =>
      d.reviewRequests.some((r) => r.login === "binbandit"),
    ),
  ).toBe(true);
  expect(find("author:app/dependabot").length).toBeGreaterThan(0);
});

test("dates, sizes and sort", async () => {
  const { find } = await setup();
  const all = find("is:open");
  expect(find("updated:>1000d")).toHaveLength(all.length);
  expect(find("updated:<1000d")).toHaveLength(0);
  expect(find("size:xs").every((d) => d.additions + d.deletions < 10)).toBe(true);
  expect(find("size:>100").every((d) => d.additions + d.deletions > 100)).toBe(true);
  const oldest = find("is:open sort:created-asc");
  expect(oldest.map((d) => d.createdAt)).toEqual(oldest.map((d) => d.createdAt).toSorted());
});

test("what doesn't parse is said, not ignored", () => {
  expect(parseQuery("is:open colour:red label:").errors).toEqual([
    'pier doesn\'t know "colour:"',
    '"label:" needs a value',
  ]);
  expect(parseQuery('label:"needs review",bug -is:draft').terms).toEqual([
    { kind: "qualifier", key: "label", values: ["needs review", "bug"], negated: false },
    { kind: "qualifier", key: "is", values: ["draft"], negated: true },
  ]);
});
