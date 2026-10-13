import { describe, expect, test } from "bun:test";

import { buildRunway } from "@/domain/runway";
import type { MergeInfo } from "@/github/port";
import type { PrDoc } from "@/github/pr-doc";

const info = (overrides: Partial<MergeInfo> = {}): MergeInfo => ({
  isDraft: false,
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  canUpdateBranch: true,
  canEnableAutoMerge: true,
  autoMerge: null,
  mergeQueue: null,
  messages: {},
  methods: ["SQUASH", "MERGE"],
  defaultMethod: "SQUASH",
  autoMergeAllowed: true,
  canMergeAsAdmin: false,
  mergeQueueEnabled: false,
  ...overrides,
});

const doc = (checks: PrDoc["checks"]["state"], failing = 0, pending = 0) =>
  ({ checks: { state: checks, total: 3, failing, pending, contexts: [] } }) as unknown as PrDoc;

describe("merge runway", () => {
  test("a clean, green PR is ready with nothing in the way", () => {
    const runway = buildRunway(doc("success"), info());
    expect(runway.ready).toBe(true);
    expect(runway.blockers).toEqual([]);
  });

  test("each problem names its fix", () => {
    const runway = buildRunway(
      doc("failure", 2),
      info({ isDraft: true, mergeStateStatus: "BEHIND", reviewDecision: "REVIEW_REQUIRED" }),
    );
    expect(runway.ready).toBe(false);
    expect(runway.blockers.map((b) => b.fix)).toEqual([
      "ready",
      "update-branch",
      "rerun",
      "auto-merge",
    ]);
  });

  test("running checks can be handed to auto-merge only where the repo allows it", () => {
    expect(buildRunway(doc("pending", 0, 1), info()).blockers[0]?.fix).toBe("auto-merge");
    expect(
      buildRunway(doc("pending", 0, 1), info({ autoMergeAllowed: false })).blockers[0]?.fix,
    ).toBeNull();
  });

  test("conflicts can't be fixed from here, and an unexplained block is said plainly", () => {
    expect(
      buildRunway(doc("success"), info({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }))
        .blockers,
    ).toEqual([{ text: "It conflicts with the base branch", fix: null }]);
    expect(
      buildRunway(doc("success"), info({ mergeStateStatus: "BLOCKED" })).blockers[0]?.text,
    ).toMatch(/branch rule/);
  });

  test("an admin can merge past rules but not past conflicts, and a queue changes what merging means", () => {
    const blocked = info({ mergeStateStatus: "BLOCKED", canMergeAsAdmin: true });
    expect(buildRunway(doc("success"), blocked).canBypass).toBe(true);
    expect(
      buildRunway(doc("success"), {
        ...blocked,
        mergeable: "CONFLICTING",
        mergeStateStatus: "DIRTY",
      }).canBypass,
    ).toBe(false);
    expect(buildRunway(doc("success"), info({ canMergeAsAdmin: true })).canBypass).toBe(false);
    expect(buildRunway(doc("success"), info({ mergeQueueEnabled: true })).queued).toBe(true);
  });
});
