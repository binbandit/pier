import type {
  Actor,
  CheckState,
  CheckSummary,
  Mergeable,
  Milestone,
  Person,
  ReviewDecision,
} from "@pier/core/wire";

import type { HydrateQuery, SweepQuery } from "./gql/graphql";

// The one shape pier stores per PR. It is mapped from GraphQL at the boundary so the rest of the
// daemon (and the fake GitHub used in tests) never sees GitHub's response shapes.

export type PrState = "OPEN" | "CLOSED" | "MERGED";

export type CheckContext = {
  name: string;
  state: "success" | "failure" | "pending" | "neutral" | "skipped";
};

export type PrCommit = {
  oid: string;
  message: string;
  committedDate: string;
  authorLogin: string | null;
  authorName: string | null;
  authorEmail: string | null;
  signatureValid: boolean | null;
};

export type PrDoc = {
  id: string;
  number: number;
  title: string;
  url: string;
  body: string;
  state: PrState;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  repo: string;
  repoId: string;
  isPrivate: boolean;
  viewerPermission: string | null;
  baseRefName: string;
  headRefName: string;
  baseRefOid: string;
  headRefOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: Mergeable;
  mergeStateStatus: string;
  reviewDecision: ReviewDecision;
  author: Actor | null;
  autoMerge: { enabledAt: string | null; method: string } | null;
  mergeQueue: { position: number; state: string } | null;
  labels: { name: string; color: string }[];
  assignees: Person[];
  milestone: Milestone | null;
  files: { path: string; additions: number; deletions: number; changeType: string }[];
  filesTotal: number;
  /** The most recent commits, oldest first. */
  commits: PrCommit[];
  commitsTotal: number;
  checks: CheckSummary & { contexts: CheckContext[] };
  reviewRequests: { kind: "user" | "team" | "bot"; login: string; asCodeOwner: boolean }[];
  latestReviews: { state: string; author: string | null; commitOid: string | null }[];
};

/** Fields that belong to the account that read the PR, not to the PR. */
export type PrViewer = {
  latestReview: { state: string; submittedAt: string | null; commitOid: string | null } | null;
};

/** The volatile subset that the sweep polls; applied on top of a stored doc. */
export type VolatileState = Pick<
  PrDoc,
  | "id"
  | "state"
  | "isDraft"
  | "updatedAt"
  | "headRefOid"
  | "mergeable"
  | "mergeStateStatus"
  | "reviewDecision"
> & {
  autoMerge: { enabledAt: string | null } | null;
  mergeQueue: PrDoc["mergeQueue"];
  rollup: CheckState;
};

type HydratedNode = Extract<NonNullable<HydrateQuery["nodes"][number]>, { id: string }>;
type SweptNode = Extract<NonNullable<SweepQuery["nodes"][number]>, { id: string }>;

export function isHydrated(node: HydrateQuery["nodes"][number]): node is HydratedNode {
  return node !== null && "id" in node;
}

export function isSwept(node: SweepQuery["nodes"][number]): node is SweptNode {
  return node !== null && "id" in node;
}

export function toPrDoc(node: HydratedNode): { doc: PrDoc; viewer: PrViewer } {
  const rollup = node.lastCommit.nodes?.[0]?.commit.statusCheckRollup ?? null;
  const contexts: CheckContext[] = (rollup?.contexts.nodes ?? []).flatMap((ctx) => {
    if (!ctx) return [];
    if (ctx.__typename === "CheckRun")
      return [{ name: ctx.name, state: checkRunState(ctx.status, ctx.conclusion) }];
    if (ctx.__typename === "StatusContext")
      return [{ name: ctx.context, state: statusContextState(ctx.state) }];
    return [];
  });

  const doc: PrDoc = {
    id: node.id,
    number: node.number,
    title: node.title,
    url: node.url,
    body: node.body,
    state: node.state,
    isDraft: node.isDraft,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    repo: node.repository.nameWithOwner,
    repoId: node.repository.id,
    isPrivate: node.repository.isPrivate,
    viewerPermission: node.repository.viewerPermission ?? null,
    baseRefName: node.baseRefName,
    headRefName: node.headRefName,
    baseRefOid: node.baseRefOid,
    headRefOid: node.headRefOid,
    additions: node.additions,
    deletions: node.deletions,
    changedFiles: node.changedFiles,
    mergeable: mergeable(node.mergeable),
    mergeStateStatus: node.mergeStateStatus,
    reviewDecision: reviewDecision(node.reviewDecision),
    author: node.author
      ? {
          login: node.author.login,
          avatarUrl: node.author.avatarUrl,
          isBot: node.author.__typename === "Bot",
        }
      : null,
    autoMerge: node.autoMergeRequest
      ? { enabledAt: node.autoMergeRequest.enabledAt, method: node.autoMergeRequest.mergeMethod }
      : null,
    mergeQueue: node.mergeQueueEntry,
    labels: (node.labels?.nodes ?? []).flatMap((label) => (label ? [label] : [])),
    assignees: (node.assignees.nodes ?? []).flatMap((user) => (user ? [user] : [])),
    milestone: node.milestone
      ? {
          number: node.milestone.number,
          title: node.milestone.title,
          dueOn: node.milestone.dueOn ?? null,
        }
      : null,
    files: (node.files?.nodes ?? []).flatMap((file) => (file ? [file] : [])),
    filesTotal: node.files?.totalCount ?? 0,
    commits: (node.commits.nodes ?? []).flatMap((entry) =>
      entry
        ? [
            {
              oid: entry.commit.oid,
              message: entry.commit.message,
              committedDate: entry.commit.committedDate,
              authorLogin: entry.commit.author?.user?.login ?? null,
              authorName: entry.commit.author?.name ?? null,
              authorEmail: entry.commit.author?.email ?? null,
              signatureValid: entry.commit.signature?.isValid ?? null,
            },
          ]
        : [],
    ),
    commitsTotal: node.commits.totalCount,
    checks: { ...summarize(rollupState(rollup?.state ?? null), contexts), contexts },
    reviewRequests: (node.reviewRequests?.nodes ?? []).flatMap<PrDoc["reviewRequests"][number]>(
      (request) => {
        const reviewer = request?.requestedReviewer;
        if (!request || !reviewer) return [];
        if (reviewer.__typename === "User")
          return [{ kind: "user", login: reviewer.login, asCodeOwner: request.asCodeOwner }];
        if (reviewer.__typename === "Bot")
          return [{ kind: "bot", login: reviewer.login, asCodeOwner: request.asCodeOwner }];
        if (reviewer.__typename === "Team") {
          return [
            {
              kind: "team",
              login: `${reviewer.organization.login}/${reviewer.slug}`,
              asCodeOwner: request.asCodeOwner,
            },
          ];
        }
        return [];
      },
    ),
    latestReviews: (node.latestOpinionatedReviews?.nodes ?? []).flatMap((review) =>
      review
        ? [
            {
              state: review.state,
              author: review.author?.login ?? null,
              commitOid: review.commit?.oid ?? null,
            },
          ]
        : [],
    ),
  };

  const viewer: PrViewer = {
    latestReview: node.viewerLatestReview
      ? {
          state: node.viewerLatestReview.state,
          submittedAt: node.viewerLatestReview.submittedAt ?? null,
          commitOid: node.viewerLatestReview.commit?.oid ?? null,
        }
      : null,
  };
  return { doc, viewer };
}

export function toVolatile(node: SweptNode): VolatileState {
  return {
    id: node.id,
    state: node.state,
    isDraft: node.isDraft,
    updatedAt: node.updatedAt,
    headRefOid: node.headRefOid,
    mergeable: mergeable(node.mergeable),
    mergeStateStatus: node.mergeStateStatus,
    reviewDecision: reviewDecision(node.reviewDecision),
    autoMerge: node.autoMergeRequest,
    mergeQueue: node.mergeQueueEntry,
    rollup: rollupState(node.commits.nodes?.[0]?.commit.statusCheckRollup?.state ?? null),
  };
}

/** A short fingerprint of the volatile fields; a change means the PR needs a closer look. */
export function volatileHash(v: VolatileState): string {
  return [
    v.state,
    v.isDraft,
    v.updatedAt,
    v.headRefOid,
    v.mergeable,
    v.mergeStateStatus,
    v.reviewDecision,
    Boolean(v.autoMerge),
    v.mergeQueue?.state ?? "",
    v.rollup,
  ].join("|");
}

export function volatileOf(doc: PrDoc): VolatileState {
  return {
    id: doc.id,
    state: doc.state,
    isDraft: doc.isDraft,
    updatedAt: doc.updatedAt,
    headRefOid: doc.headRefOid,
    mergeable: doc.mergeable,
    mergeStateStatus: doc.mergeStateStatus,
    reviewDecision: doc.reviewDecision,
    autoMerge: doc.autoMerge ? { enabledAt: doc.autoMerge.enabledAt } : null,
    mergeQueue: doc.mergeQueue,
    rollup: doc.checks.state,
  };
}

function summarize(state: CheckState, contexts: CheckContext[]): CheckSummary {
  return {
    state,
    total: contexts.length,
    failing: contexts.filter((c) => c.state === "failure").length,
    pending: contexts.filter((c) => c.state === "pending").length,
  };
}

function rollupState(state: string | null): CheckState {
  switch (state) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return "none";
  }
}

function checkRunState(status: string, conclusion: string | null): CheckContext["state"] {
  if (status !== "COMPLETED") return "pending";
  switch (conclusion) {
    case "SUCCESS":
      return "success";
    case "NEUTRAL":
      return "neutral";
    case "SKIPPED":
    case "STALE":
      return "skipped";
    default:
      return "failure";
  }
}

function statusContextState(state: string): CheckContext["state"] {
  if (state === "SUCCESS") return "success";
  if (state === "PENDING" || state === "EXPECTED") return "pending";
  return "failure";
}

function mergeable(state: string): Mergeable {
  if (state === "MERGEABLE") return "mergeable";
  if (state === "CONFLICTING") return "conflicting";
  return "unknown";
}

function reviewDecision(decision: string | null): ReviewDecision {
  if (decision === "APPROVED") return "approved";
  if (decision === "CHANGES_REQUESTED") return "changes_requested";
  if (decision === "REVIEW_REQUIRED") return "review_required";
  return null;
}
