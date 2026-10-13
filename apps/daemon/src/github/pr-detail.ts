import type {
  Actor,
  CommitView,
  Subscription,
  LinkedIssue,
  LockReason,
  PendingReview,
  Reaction,
  ReactionContent,
  Side,
  Thread,
  TimelineEntry,
} from "@pier/core/wire";

import type { PrDetailQuery } from "./gql/graphql";
import { rollupState } from "./pr-doc";

// The full-tier picture of one PR, read when its canvas opens: threads, reviews, conversation and
// history. Viewer-specific (your viewed files, your pending review), so stored per account.

export type PrDetail = {
  prId: string;
  headRefOid: string;
  bodyHTML: string;
  /** The description's reactions, whether you can edit it, and the lock reason if locked. */
  reactions: Reaction[];
  canEdit: boolean;
  locked: string | null;
  linkedIssues: LinkedIssue[];
  /** Names of the head's checks that must pass to merge. */
  requiredChecks: string[];
  commits: CommitView[];
  headBranch: { exists: boolean; canDelete: boolean; crossRepo: boolean };
  /** Where the head branch lives, for committing to it (applying suggestions). */
  head: { repo: string | null; branch: string; canEditFiles: boolean };
  /** GitHub's numeric ids of the people commenting in threads, for Co-authored-by trailers. */
  userIds: Record<string, number>;
  subscription: Subscription | null;
  viewerLatestReview: {
    state: string;
    commitOid: string | null;
    submittedAt: string | null;
  } | null;
  pendingReview: PendingReview | null;
  threads: Omit<Thread, "pending">[];
  timeline: TimelineEntry[];
  viewed: Record<string, "VIEWED" | "UNVIEWED" | "DISMISSED">;
};

type Node = Extract<NonNullable<PrDetailQuery["node"]>, { headRefOid: string }>;

/** GraphQL's lock reasons, spelled the way the REST lock endpoint (and pier) takes them. */
const LOCK_REASONS: Record<string, LockReason> = {
  OFF_TOPIC: "off-topic",
  TOO_HEATED: "too heated",
  RESOLVED: "resolved",
  SPAM: "spam",
};

/** Only reactions someone actually left; GitHub lists all eight with zero counts. */
function reactions(
  groups:
    | readonly {
        content: ReactionContent;
        viewerHasReacted: boolean;
        reactors: { totalCount: number };
      }[]
    | null
    | undefined,
): Reaction[] {
  return (groups ?? []).flatMap((g) =>
    g.reactors.totalCount > 0
      ? [{ content: g.content, count: g.reactors.totalCount, mine: g.viewerHasReacted }]
      : [],
  );
}

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
  const userIds: Record<string, number> = {};

  const threads = (node.reviewThreads.nodes ?? []).flatMap((thread) => {
    if (!thread) return [];
    for (const c of thread.comments.nodes ?? []) {
      if (c?.author && "databaseId" in c.author && c.author.databaseId)
        userIds[c.author.login] = c.author.databaseId;
    }
    const comments = (thread.comments.nodes ?? []).flatMap((c) =>
      // Comments in someone's unsubmitted review aren't visible to anyone else.
      c && c.state !== "PENDING"
        ? [
            {
              id: c.id,
              author: actor(c.author),
              bodyHTML: c.bodyHTML,
              createdAt: c.createdAt,
              subject: "review-comment" as const,
              body: c.body,
              edited: Boolean(c.lastEditedAt),
              canEdit: c.viewerCanUpdate,
              canDelete: c.viewerCanDelete,
              canMinimize: c.viewerCanMinimize,
              minimized: c.isMinimized ? (c.minimizedReason ?? "hidden") : null,
              reactions: reactions(c.reactionGroups),
              unsent: false,
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
        startSide:
          thread.startLine === null || thread.startLine === undefined
            ? null
            : thread.startDiffSide === "LEFT"
              ? ("LEFT" as const)
              : ("RIGHT" as const),
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
        subject: "issue-comment",
        body: c.body,
        edited: Boolean(c.lastEditedAt),
        canEdit: c.viewerCanUpdate,
        canDelete: c.viewerCanDelete,
        canMinimize: c.viewerCanMinimize,
        minimized: c.isMinimized ? (c.minimizedReason ?? "hidden") : null,
        reactions: reactions(c.reactionGroups),
        unsent: false,
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
      // Who may dismiss depends on the account reading, so the view fills it in.
      canDismiss: false,
      subject: "review",
      body: r.body,
      edited: Boolean(r.lastEditedAt),
      canEdit: r.viewerCanUpdate,
      canDelete: false,
      canMinimize: false,
      minimized: null,
      reactions: reactions(r.reactionGroups),
      unsent: false,
    });
  }
  const commits: CommitView[] = [];
  for (const entry of node.allCommits.nodes ?? []) {
    if (!entry) continue;
    const c = entry.commit;
    commits.push({
      oid: c.oid,
      headline: c.messageHeadline,
      author: c.author?.user?.login ?? c.author?.name ?? null,
      at: c.committedDate,
      checks: rollupState(c.statusCheckRollup?.state ?? null),
      verified: c.signature ? c.signature.isValid : null,
    });
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
  // Every merge also records a close; GitHub shows only the merge, and so does pier.
  const mergedAt = timeline.flatMap((e) =>
    e.kind === "event" && e.text === "merged this" ? [Date.parse(e.at)] : [],
  );
  const shown = timeline.filter(
    (e) =>
      !(
        e.kind === "event" &&
        e.text === "closed this" &&
        mergedAt.some((at) => Math.abs(Date.parse(e.at) - at) < 60_000)
      ),
  );

  const viewed: PrDetail["viewed"] = {};
  for (const file of node.files?.nodes ?? []) if (file) viewed[file.path] = file.viewerViewedState;

  return {
    prId: node.id,
    headRefOid: node.headRefOid,
    bodyHTML: node.bodyHTML,
    reactions: reactions(node.reactionGroups),
    canEdit: node.viewerCanUpdate,
    headBranch: {
      exists: node.headRef !== null && node.headRef !== undefined,
      canDelete: node.viewerCanDeleteHeadRef,
      crossRepo: node.isCrossRepository,
    },
    head: {
      repo: node.headRepository?.nameWithOwner ?? null,
      branch: node.headRefName,
      canEditFiles: node.viewerCanEditFiles,
    },
    userIds,
    subscription: node.viewerSubscription ?? null,
    requiredChecks: (
      node.headChecks.nodes?.[0]?.commit.statusCheckRollup?.contexts.nodes ?? []
    ).flatMap((ctx) => {
      if (!ctx || !("isRequired" in ctx) || !ctx.isRequired) return [];
      return [ctx.__typename === "CheckRun" ? ctx.name : ctx.context];
    }),
    linkedIssues: (node.closingIssuesReferences?.nodes ?? []).flatMap((issue) =>
      issue
        ? [
            {
              repo: issue.repository.nameWithOwner,
              number: issue.number,
              title: issue.title,
              url: issue.url,
              state: issue.state === "OPEN" ? ("OPEN" as const) : ("CLOSED" as const),
            },
          ]
        : [],
    ),
    locked: node.locked ? (LOCK_REASONS[node.activeLockReason ?? ""] ?? "locked") : null,
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
    commits,
    timeline: shown,
    viewed,
  };
}

type TimelineNode = NonNullable<NonNullable<Node["timelineItems"]["nodes"]>[number]>;

function event(
  item: { createdAt: string; actor?: { login: string } | null },
  text: string,
  url?: string,
): TimelineEntry {
  return {
    kind: "event",
    text,
    actor: item.actor?.login ?? null,
    at: item.createdAt,
    ...(url ? { url } : {}),
  };
}

type Referenced =
  | {
      __typename: "Issue" | "PullRequest";
      number: number;
      title: string;
      url: string;
      repository: { nameWithOwner: string };
    }
  | { __typename: string };

/** "acme/api#12 Fix the thing", for an issue or PR another event points at. */
function reference(subject: Referenced | null | undefined): { label: string; url: string } | null {
  if (!subject || !("number" in subject)) return null;
  return {
    label: `${subject.repository.nameWithOwner}#${subject.number} ${subject.title}`,
    url: subject.url,
  };
}

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
    case "ReviewRequestedEvent":
    case "ReviewRequestRemovedEvent": {
      const who = item.requestedReviewer;
      const name =
        who?.__typename === "User" ? who.login : who?.__typename === "Team" ? who.slug : "someone";
      return {
        kind: "event",
        text:
          item.__typename === "ReviewRequestedEvent"
            ? `requested review from ${name}`
            : `removed the review request for ${name}`,
        actor: item.actor?.login ?? null,
        at: item.createdAt,
      };
    }
    case "AssignedEvent":
    case "UnassignedEvent": {
      const who = item.assignee && "login" in item.assignee ? item.assignee.login : "someone";
      const self = who === item.actor?.login;
      return {
        kind: "event",
        text:
          item.__typename === "AssignedEvent"
            ? self
              ? "self-assigned this"
              : `assigned ${who}`
            : self
              ? "removed their assignment"
              : `unassigned ${who}`,
        actor: item.actor?.login ?? null,
        at: item.createdAt,
      };
    }
    case "MilestonedEvent":
    case "DemilestonedEvent":
      return {
        kind: "event",
        text:
          item.__typename === "MilestonedEvent"
            ? `added this to ${item.milestoneTitle}`
            : `removed this from ${item.milestoneTitle}`,
        actor: item.actor?.login ?? null,
        at: item.createdAt,
      };
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
    case "LockedEvent":
      return event(
        item,
        item.lockReason
          ? `locked this as ${LOCK_REASONS[item.lockReason] ?? item.lockReason.toLowerCase()}`
          : "locked this",
      );
    case "UnlockedEvent":
      return event(item, "unlocked this");
    case "BaseRefChangedEvent":
      return event(
        item,
        `changed the base branch from ${item.previousRefName} to ${item.currentRefName}`,
      );
    case "AutomaticBaseChangeSucceededEvent":
      return event(
        item,
        `changed the base branch from ${item.oldBase} to ${item.newBase} when it merged`,
      );
    case "CrossReferencedEvent": {
      const ref = reference(item.source);
      return event(
        item,
        `${item.willCloseTarget ? "linked" : "mentioned"} this in ${ref?.label ?? "another thread"}`,
        ref?.url,
      );
    }
    case "ConnectedEvent":
    case "DisconnectedEvent": {
      const ref = reference(item.subject);
      return event(
        item,
        `${item.__typename === "ConnectedEvent" ? "linked" : "unlinked"} ${ref?.label ?? "an issue"}`,
        ref?.url,
      );
    }
    case "AutoMergeEnabledEvent":
      return event(item, "turned on auto-merge");
    case "AutoMergeDisabledEvent":
      return event(
        item,
        item.reason ? `turned off auto-merge: ${item.reason}` : "turned off auto-merge",
      );
    case "HeadRefDeletedEvent":
      return event(item, `deleted the ${item.headRefName} branch`);
    case "HeadRefRestoredEvent":
      return event(item, "restored the head branch");
    case "AddedToMergeQueueEvent":
      return event(item, "added this to the merge queue");
    case "RemovedFromMergeQueueEvent":
      return event(
        item,
        item.reason
          ? `removed this from the merge queue: ${item.reason}`
          : "removed this from the merge queue",
      );
    case "MarkedAsDuplicateEvent": {
      const ref = reference(item.canonical);
      return event(
        item,
        `marked this as a duplicate of ${ref?.label ?? "another thread"}`,
        ref?.url,
      );
    }
    case "CommentDeletedEvent":
      return event(
        item,
        item.deletedCommentAuthor?.login && item.deletedCommentAuthor.login !== item.actor?.login
          ? `deleted a comment from ${item.deletedCommentAuthor.login}`
          : "deleted a comment",
      );
    case "DeployedEvent":
      return event(item, `deployed this to ${item.deployment.environment ?? "an environment"}`);
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
