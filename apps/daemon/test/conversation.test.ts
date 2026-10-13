import { describe, expect, test } from "bun:test";

import { overlayConversation } from "@/domain/conversation";
import { createFakePorts, generateScenario } from "@/github/fake/scenario";
import type { PrView } from "@pier/core/wire";

const writing = {
  body: "Looks right",
  edited: false,
  canEdit: true,
  canDelete: true,
  canMinimize: true,
  minimized: null,
  reactions: [{ content: "HEART" as const, count: 1, mine: false }],
  unsent: false,
};

const view = {
  id: "PR_1",
  title: "Old title",
  baseRefName: "main",
  body: "Description",
  bodyHTML: "<p>Description</p>",
  reactions: [],
  locked: null,
  threads: [
    {
      id: "T_1",
      comments: [
        { ...writing, id: "C_1", subject: "review-comment" },
        { ...writing, id: "C_2", subject: "review-comment" },
      ],
    },
  ],
  timeline: [
    { ...writing, kind: "comment", id: "IC_1", subject: "issue-comment" },
    {
      ...writing,
      kind: "review",
      id: "R_1",
      subject: "review",
      state: "APPROVED",
      canDismiss: true,
    },
  ],
} as unknown as PrView;

describe("unsent conversation writes", () => {
  test("show the moment they're made", () => {
    const next = overlayConversation(view, [
      { kind: "react", payload: { subjectId: "IC_1", content: "THUMBS_UP", on: true } },
      { kind: "react", payload: { subjectId: "PR_1", content: "ROCKET", on: true } },
      {
        kind: "edit-comment",
        payload: { subject: "review-comment", subjectId: "C_1", body: "Fixed" },
      },
      { kind: "delete-comment", payload: { subject: "review-comment", subjectId: "C_2" } },
      { kind: "minimize", payload: { subjectId: "IC_1", reason: "OFF_TOPIC" } },
      { kind: "dismiss-review", payload: { subjectId: "R_1", body: "Stale" } },
      { kind: "edit-pr", payload: { title: "New title", base: "release" } },
      { kind: "lock", payload: { lockReason: "resolved" } },
    ]);
    const comment = next.timeline.find((e) => e.kind === "comment");
    expect(comment?.kind === "comment" && comment.reactions).toEqual([
      { content: "THUMBS_UP", count: 1, mine: true },
      { content: "HEART", count: 1, mine: false },
    ]);
    expect(comment?.kind === "comment" && comment.minimized).toBe("off-topic");
    expect(next.reactions).toEqual([{ content: "ROCKET", count: 1, mine: true }]);
    expect(next.threads[0]?.comments.map((c) => [c.id, c.body, c.unsent])).toEqual([
      ["C_1", "Fixed", true],
    ]);
    const review = next.timeline.find((e) => e.kind === "review");
    expect(review?.kind === "review" && [review.state, review.canDismiss]).toEqual([
      "DISMISSED",
      false,
    ]);
    expect([next.title, next.baseRefName, next.locked]).toEqual([
      "New title",
      "release",
      "resolved",
    ]);
  });

  test("taking a reaction back removes it when it was the only one", () => {
    const mine = overlayConversation(view, [
      { kind: "react", payload: { subjectId: "IC_1", content: "HEART", on: true } },
    ]);
    const undone = overlayConversation(mine, [
      { kind: "react", payload: { subjectId: "IC_1", content: "HEART", on: false } },
    ]);
    const comment = undone.timeline.find((e) => e.kind === "comment");
    expect(comment?.kind === "comment" && comment.reactions).toEqual([
      { content: "HEART", count: 1, mine: false },
    ]);
  });
});

/** The sandbox world, a human PR in it, and ports for its reviewer and its author. */
const setup = () => {
  const world = generateScenario({ preset: "sandbox" });
  const ports = createFakePorts(world);
  const pr = [...world.prs.values()].find(
    (p) => p.author === "sage-smudge" && p.state === "OPEN" && p.files.length > 0,
  )!;
  return { world, pr, you: ports.get("binbandit")!, author: ports.get("sage-smudge")! };
};

describe("conversation writes against the fake", () => {
  test("reactions, edits, hiding and deleting land and read back", async () => {
    const { pr, you, author } = setup();
    const { id: commentId } = await author.comment(pr.id, "First thoughts");
    await you.react(commentId, "EYES", true);
    await author.editWriting("issue-comment", commentId, "Second thoughts");
    await you.minimize(commentId, "OUTDATED");
    let detail = await you.detail(pr.id);
    const entry = detail?.timeline.find((e) => e.kind === "comment" && e.id === commentId);
    expect(entry?.kind === "comment" && [entry.body, entry.edited, entry.minimized]).toEqual([
      "Second thoughts",
      true,
      "outdated",
    ]);
    expect(entry?.kind === "comment" && entry.reactions).toEqual([
      { content: "EYES", count: 1, mine: true },
    ]);

    expect((await you.history(commentId)).map((r) => r.body)).toEqual([
      "Second thoughts",
      "First thoughts",
    ]);

    await author.deleteComment("issue-comment", commentId);
    detail = await you.detail(pr.id);
    expect(detail?.timeline.some((e) => e.kind === "comment" && e.id === commentId)).toBe(false);
  });

  test("title, base and lock change, and a review can be dismissed", async () => {
    const { pr, you, author } = setup();
    const review = await you.submitReview({
      prId: pr.id,
      commitOid: pr.commits.at(-1)!.oid,
      event: "REQUEST_CHANGES",
      body: "Needs a test",
      threads: [],
    });
    await author.editPr(pr.id, { title: "Renamed", base: "release" });
    await you.setLocked(pr.repo.fullName, pr.number, "too heated");
    await you.dismissReview(review.id, "Addressed in the latest push");
    expect([pr.title, pr.baseRefName, pr.locked]).toEqual(["Renamed", "release", "too heated"]);
    expect(pr.reviews.find((r) => r.id === review.id)?.state).toBe("DISMISSED");
  });

  test("a review started elsewhere is continued, with a file comment, not doubled", async () => {
    const { world, pr, you } = setup();
    const file = pr.files[0]!;
    // Started on github.com: a pending review with one comment.
    world.review(pr.id, "binbandit", {
      event: "PENDING",
      threads: [{ subject: "file", path: file.path, body: "Started on the web" }],
    });
    const submitted = await you.submitReview({
      prId: pr.id,
      commitOid: pr.commits.at(-1)!.oid,
      event: "COMMENT",
      body: "Finished in pier",
      threads: [
        { subject: "file", path: file.path, body: "Started on the web" },
        { subject: "file", path: file.path, body: "And one more" },
      ],
    });
    const mine = pr.reviews.filter((r) => r.author === "binbandit");
    expect(mine.map((r) => r.state)).toEqual(["COMMENTED"]);
    expect(submitted.id).toBe(mine[0]!.id);
    const bodies = pr.threads.filter((t) => t.subject === "file").map((t) => t.comments[0]?.body);
    expect(bodies).toEqual(["Started on the web", "And one more"]);
  });
});
