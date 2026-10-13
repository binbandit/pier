import { describe, expect, test } from "bun:test";

import { overlayMetadata, type PendingEdit } from "@/domain/metadata";
import { createFakePorts, generateScenario } from "@/github/fake/scenario";
import type { PrDoc } from "@/github/pr-doc";

const doc = {
  labels: [{ name: "bug", color: "d73a4a" }],
  assignees: [{ login: "alice", avatarUrl: "a.png" }],
  reviewRequests: [{ kind: "user", login: "bob", asCodeOwner: false }],
  milestone: null,
  isDraft: false,
} as unknown as PrDoc;

const known = {
  labels: [{ name: "enhancement", color: "a2eeef", description: null }],
  people: [{ login: "carol", avatarUrl: "c.png" }],
  milestones: [{ number: 2, title: "Backlog", dueOn: null }],
};

describe("pending metadata edits", () => {
  test("lay over what GitHub last said, in the order they were made", () => {
    const pending: PendingEdit[] = [
      { kind: "labels", payload: { add: ["enhancement"], remove: ["bug"] } },
      { kind: "assignees", payload: { add: ["carol"], remove: [] } },
      { kind: "reviewers", payload: { add: ["acme/web"], remove: ["bob"] } },
      { kind: "milestone", payload: { milestone: 2 } },
      { kind: "draft", payload: { draft: true } },
      { kind: "labels", payload: { add: ["bug"], remove: [] } },
    ];
    const view = overlayMetadata(doc, pending, known);
    expect(view.labels).toEqual([
      { name: "enhancement", color: "a2eeef" },
      { name: "bug", color: "d73a4a" },
    ]);
    expect(view.assignees.map((a) => a.avatarUrl)).toEqual(["a.png", "c.png"]);
    expect(view.requested).toEqual(["acme/web"]);
    expect(view.milestone?.title).toBe("Backlog");
    expect(view.isDraft).toBe(true);
  });

  test("leave the PR as it was when nothing is pending", () => {
    const view = overlayMetadata(doc, [], known);
    expect(view.labels).toEqual(doc.labels);
    expect(view.requested).toEqual(["bob"]);
    expect(view.milestone).toBeNull();
  });
});

describe("metadata edits against the fake", () => {
  test("land on the PR and come back on the next read", async () => {
    const world = generateScenario({ preset: "sandbox" });
    const port = createFakePorts(world).get("binbandit")!;
    const pr = [...world.prs.values()].find(
      (p) => p.author === "sage-smudge" && p.state === "OPEN",
    )!;
    const repo = pr.repo.fullName;

    await port.editMetadata(repo, pr.number, "labels", { add: ["enhancement"], remove: [] });
    await port.editMetadata(repo, pr.number, "assignees", { add: ["binbandit"], remove: [] });
    await port.editMetadata(repo, pr.number, "reviewers", { add: ["WastedHippie"], remove: [] });
    await port.setMilestone(repo, pr.number, 1);
    await port.setDraft(pr.id, true);

    const [hydrated] = await port.hydrate([pr.id]);
    expect(hydrated?.doc.labels.map((l) => l.name)).toContain("enhancement");
    expect(hydrated?.doc.assignees.map((a) => a.login)).toEqual(["binbandit"]);
    expect(hydrated?.doc.reviewRequests.map((r) => r.login)).toContain("WastedHippie");
    expect(hydrated?.doc.milestone?.title).toBe("Next release");
    expect(hydrated?.doc.isDraft).toBe(true);

    const refused = await port
      .editMetadata(repo, pr.number, "reviewers", { add: [pr.author], remove: [] })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(String(refused)).toMatch(/pull request author/);
  });
});
