import { expect, test } from "bun:test";

import { Model } from "@/domain/model";
import { searchRecords } from "@/domain/search";
import { createFakePorts, generateScenario } from "@/github/fake/scenario";
import { memoryStores } from "@/store/db";
import { parseQuery, parseRange, toGitHubQuery } from "@pier/core/query";

const NOW = Date.parse("2026-10-13T12:00:00Z");

function setup() {
  return setupFrom(generateScenario({ preset: "sandbox", clock: "manual", start: NOW }));
}

/** The replica as binbandit reads `world` now, and a search over it. */
async function setupFrom(world: ReturnType<typeof generateScenario>) {
  const you = createFakePorts(world).get("binbandit")!;
  const model = new Model(memoryStores().cache);
  for (const { doc, viewer } of await you.hydrate([...world.prs.keys()])) {
    model.upsert(doc, viewer, "binbandit");
  }
  const records = [...model.all()];
  const find = (q: string) =>
    searchRecords(records, parseQuery(q), {
      you: ["binbandit"],
      teams: ["WastedHippie/reviewers"],
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

const number = (end: string) => ({ min: Number(end), max: Number(end) });
const day = (end: string) => {
  const at = Date.parse(end);
  return { min: at, max: at + 86_400_000 - 1 };
};

test("ranges keep GitHub's edges: > is strictly after, and a bare date is the whole day", () => {
  expect(parseRange(">100", number)).toEqual({ min: 101, max: Infinity });
  expect(parseRange("<100", number)).toEqual({ min: -Infinity, max: 99 });
  const jan1 = Date.parse("2026-01-01");
  expect(parseRange(">2026-01-01", day)?.min).toBe(jan1 + 86_400_000);
  expect(parseRange("<=2026-01-01", day)?.max).toBe(jan1 + 86_400_000 - 1);
  expect(parseRange("2026-01-01..2026-01-31", day)?.max).toBe(
    Date.parse("2026-01-31") + 86_400_000 - 1,
  );
});

test("review-requested:@me counts requests to your teams", async () => {
  const world = generateScenario({ preset: "sandbox", clock: "manual", start: NOW });
  const pr = [...world.prs.values()].find(
    (p) => p.state === "OPEN" && p.requested.size === 0 && p.repo.fullName.endsWith("api"),
  )!;
  world.addTeam("WastedHippie", "reviewers", ["binbandit"]);
  world.requestReview(pr.id, "WastedHippie/reviewers");
  const { find } = await setupFrom(world);
  expect(find("review-requested:@me").map((d) => d.id)).toContain(pr.id);
});

test("a search asked of GitHub uses only syntax GitHub reads", () => {
  const { text, dropped } = toGitHubQuery(
    parseQuery("author:alice,bob -label:wip,blocked updated:>7d no:reviewer turn:me cursor"),
    Date.parse("2026-10-13T12:00:00Z"),
  );
  expect(text).toBe(
    "is:pr (author:alice OR author:bob) -label:wip,blocked updated:>2026-10-06T12:00:00+00:00 cursor sort:updated-desc",
  );
  expect(dropped).toEqual(["no:reviewer", "turn:"]);
});
