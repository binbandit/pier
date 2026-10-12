import type { Actor, Side, Thread, TimelineEntry } from "@pier/core/wire";

import type { PrDetailQuery } from "./gql/graphql";

// The full-tier picture of one PR, read when its canvas opens: threads, reviews, conversation and
// history. Viewer-specific (your viewed files, your pending review), so stored per account.

export type PrDetail = {
  prId: string;
  headRefOid: string;
  bodyHTML: string;
  viewerLatestReview: {
    state: string;
    commitOid: string | null;
    submittedAt: string | null;
  } | null;
  pendingReview: {
    id: string;
    commitOid: string | null;
    comments: {
      id: string;
      body: string;
      path: string;
      line: number | null;
      startLine: number | null;
    }[];
  } | null;
  threads: Omit<Thread, "pending">[];
  timeline: TimelineEntry[];
  viewed: Record<string, "VIEWED" | "UNVIEWED" | "DISMISSED">;
};

type Node = Extract<NonNullable<PrDetailQuery["node"]>, { headRefOid: string }>;

export function isDetailNode(node: PrDetailQuery["node"]): node is Node {
  return node !== null && "headRefOid" in node;
}

function actor(author: { login: string; avatarUrl: string } | null | undefined): Actor | null {
  return author
    ? { login: author.login, avatarUrl: author.avatarUrl, isBot: author.login.endsWith("[bot]") }
    : null;
}

export function toPrDetail(node: Node): PrDetail {
  const pending = node.pendingReviews?.nodes?.[0] ?? null;

  const threads = (node.reviewThreads.nodes ?? []).flatMap((thread) => {
    if (!thread) return [];
    const comments = (thread.comments.nodes ?? []).flatMap((c) =>
      // Comments in someone's unsubmitted review aren't visible to anyone else.
      c && c.state !== "PENDING"
        ? [
            {
              id: c.id,
              author: actor(c.author),
              body: c.body,
              bodyHTML: c.bodyHTML,
              createdAt: c.createdAt,
              edited: c.lastEditedAt !== null && c.lastEditedAt !== undefined,
            },
          ]
        : [],
    );
    if (comments.length === 0) return [];
    const side: Side = thread.diffSide === "LEFT" ? "LEFT" : "RIGHT";
    return [
      {
        id: thread.id,
        path: thread.path,
        side,
        line: thread.line ?? null,
        startLine: thread.startLine ?? null,
        originalLine: thread.originalLine ?? null,
        subject: thread.subjectType === "FILE" ? ("file" as const) : ("line" as const),
        resolved: thread.isResolved,
        outdated: thread.isOutdated,
        resolvedBy: thread.resolvedBy?.login ?? null,
        canResolve: thread.isResolved ? thread.viewerCanUnresolve : thread.viewerCanResolve,
        canReply: thread.viewerCanReply,
        diffHunk: thread.comments.nodes?.[0]?.diffHunk ?? "",
        comments,
      },
    ];
  });

  const timeline: TimelineEntry[] = [];
  for (const c of node.comments.nodes ?? []) {
    if (c)
      timeline.push({
        kind: "comment",
        id: c.id,
        author: actor(c.author),
        bodyHTML: c.bodyHTML,
        at: c.createdAt,
      });
  }
  for (const r of node.reviews?.nodes ?? []) {
    if (!r?.submittedAt || r.state === "PENDING") continue;
    // GitHub wraps every thread reply in an empty "commented" review; the reply already shows in
    // its thread, so these would only be noise in the timeline.
    if (r.state === "COMMENTED" && !r.body.trim()) continue;
    timeline.push({
      kind: "review",
      id: r.id,
      author: actor(r.author),
      state: r.state,
      bodyHTML: r.bodyHTML,
      at: r.submittedAt,
      commitOid: r.commit?.oid ?? null,
    });
  }
  for (const entry of node.allCommits.nodes ?? []) {
    if (!entry) continue;
    const c = entry.commit;
    timeline.push({
      kind: "commit",
      oid: c.oid,
      headline: c.messageHeadline,
      author: c.author?.user?.login ?? c.author?.name ?? null,
      at: c.committedDate,
    });
  }
  for (const item of node.timelineItems.nodes ?? []) {
    const entry = item ? timelineEvent(item) : null;
    if (entry) timeline.push(entry);
  }
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  const viewed: PrDetail["viewed"] = {};
  for (const file of node.files?.nodes ?? []) if (file) viewed[file.path] = file.viewerViewedState;

  return {
    prId: node.id,
    headRefOid: node.headRefOid,
    bodyHTML: node.bodyHTML,
    viewerLatestReview: node.viewerLatestReview
      ? {
          state: node.viewerLatestReview.state,
          commitOid: node.viewerLatestReview.commit?.oid ?? null,
          submittedAt: node.viewerLatestReview.submittedAt ?? null,
        }
      : null,
    pendingReview: pending
      ? {
          id: pending.id,
          commitOid: pending.commit?.oid ?? null,
          comments: (pending.comments.nodes ?? []).flatMap((c) =>
            c
              ? [
                  {
                    id: c.id,
                    body: c.body,
                    path: c.path,
                    line: c.line ?? null,
                    startLine: c.startLine ?? null,
                  },
                ]
              : [],
          ),
        }
      : null,
    threads,
    timeline,
    viewed,
  };
}

type TimelineNode = NonNullable<NonNullable<Node["timelineItems"]["nodes"]>[number]>;

function timelineEvent(item: TimelineNode): TimelineEntry | null {
  switch (item.__typename) {
    case "HeadRefForcePushedEvent":
      return {
        kind: "force-push",
        before: item.beforeCommit?.oid ?? null,
        after: item.afterCommit?.oid ?? null,
        actor: item.actor?.login ?? null,
        at: item.createdAt,
      };
    case "ReviewRequestedEvent": {
      const who = item.requestedReviewer;
      const name =
        who?.__typename === "User" ? who.login : who?.__typename === "Team" ? who.slug : "someone";
      return {
        kind: "event",
        text: `requested review from ${name}`,
        actor: item.actor?.login ?? null,
        at: item.createdAt,
      };
    }
    case "ReadyForReviewEvent":
      return {
        kind: "event",
        text: "marked this ready for review",
        actor: item.actor?.login ?? null,
        at: item.createdAt,
      };
    case "ConvertToDraftEvent":
      return {
        kind: "event",
        text: "converted this to a draft",
        actor: item.actor?.login ?? null,
        at: item.createdAt,
      };
    case "MergedEvent":
      return {
        kind: "event",
        text: "merged this",
        actor: item.actor?.login ?? null,
        at: item.createdAt,
      };
    case "ClosedEvent":
      return {
        kind: "event",
        text: "closed this",
        actor: item.actor?.login ?? null,
        at: item.createdAt,
      };
    case "ReopenedEvent":
      return {
        kind: "event",
        text: "reopened this",
        actor: item.actor?.login ?? null,
        at: item.createdAt,
      };
    case "LabeledEvent":
      return {
        kind: "event",
        text: `added the ${item.label.name} label`,
        actor: item.actor?.login ?? null,
        at: item.createdAt,
      };
    case "UnlabeledEvent":
      return {
        kind: "event",
        text: `removed the ${item.label.name} label`,
        actor: item.actor?.login ?? null,
        at: item.createdAt,
      };
    case "RenamedTitleEvent":
      return {
        kind: "event",
        text: `renamed this from "${item.previousTitle}"`,
        actor: item.actor?.login ?? null,
        at: item.createdAt,
      };
    case "ReviewDismissedEvent":
      return {
        kind: "event",
        text: "dismissed a review",
        actor: item.actor?.login ?? null,
        at: item.createdAt,
      };
    case "BaseRefForcePushedEvent":
      return {
        kind: "event",
        text: "force-pushed the base branch",
        actor: item.actor?.login ?? null,
        at: item.createdAt,
      };
    default:
      return null;
  }
}
