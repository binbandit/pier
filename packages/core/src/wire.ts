// Everything the daemon sends to the web app. Plain types only: the daemon is trusted,
// so outputs are typed rather than validated. Inputs live in `contract.ts` as ArkType schemas.

export type Ecosystem =
  | "npm"
  | "gomod"
  | "github-actions"
  | "cargo"
  | "pip"
  | "bundler"
  | "composer"
  | "maven"
  | "gradle"
  | "nuget"
  | "docker"
  | "terraform"
  | "unknown";

export type SemverClass = "major" | "minor" | "patch" | "unknown";

export type Bot = "dependabot" | "renovate";

/** One dependency moving from one version to another inside a PR. */
export type Bump = {
  ecosystem: Ecosystem;
  pkg: string;
  from: string | null;
  to: string;
  semver: SemverClass;
  directory: string;
  dependencyType: string | null;
};

export type CheckState = "success" | "failure" | "pending" | "none";

export type CheckSummary = {
  state: CheckState;
  total: number;
  failing: number;
  pending: number;
};

export type Mergeable = "mergeable" | "conflicting" | "unknown";

export type ReviewDecision = "approved" | "changes_requested" | "review_required" | null;

/** How a PR will actually land once it is approved. */
export type MergePath = "auto-merge" | "merge-queue" | "none-armed" | "unknown";

export type GateId =
  | "semver"
  | "release-age"
  | "paths"
  | "transitive"
  | "provenance"
  | "install-script"
  | "advisory"
  | "checks";

export type GateStatus = "pass" | "fail" | "na" | "unknown";

export type GateResult = {
  gate: GateId;
  status: GateStatus;
  detail: string;
};

export type Cohort = "clear" | "look" | "stuck";

export type Actor = {
  login: string;
  avatarUrl: string;
  isBot: boolean;
};

export type Split = "review" | "deps" | "mine";

export type OutboxState =
  /** Waiting for another PR in the same repo to merge first. */
  "waiting" | "held" | "queued" | "claimed" | "acked" | "unknown" | "failed" | "cancelled";

export type PendingWrite = {
  commandId: string;
  kind: CommandKind;
  state: OutboxState;
  sendAt: string;
};

export type CommandKind =
  | "approve"
  | "bot-command"
  | "review"
  | "reply"
  | "comment"
  | "resolve"
  | "unresolve"
  | "viewed"
  | "unviewed";

// ---------------------------------------------------------------------------
// Inbox

export type GroupItem = {
  kind: "group";
  key: string;
  ecosystem: Ecosystem;
  pkg: string;
  to: string;
  fromVersions: string[];
  semver: SemverClass;
  repoCount: number;
  cohorts: Record<Cohort, number>;
  /** PRs that already carry a verdict and only need one key to act on. */
  covered: number;
  reason: string;
  updatedAt: string;
  accounts: string[];
};

export type PrItem = {
  kind: "pr";
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: Actor | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  isDraft: boolean;
  checks: CheckSummary;
  reviewDecision: ReviewDecision;
  reason: string;
  updatedAt: string;
  account: string;
};

export type QueueItem = GroupItem | PrItem;

export type SplitCounts = Record<Split, number>;

// ---------------------------------------------------------------------------
// Group canvas

export type BumpRef = Pick<Bump, "ecosystem" | "pkg" | "from" | "to" | "semver">;

export type GroupRow = {
  prId: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  directory: string;
  from: string | null;
  account: string;
  cohort: Cohort;
  /** Failed gates or stuck causes, in plain words. Empty for clear rows. */
  reasons: string[];
  gates: GateResult[];
  checks: CheckSummary;
  mergeable: Mergeable;
  approvalRequired: boolean | null;
  mergePath: MergePath;
  /** Other bumps this PR carries (grouped Dependabot PRs). */
  otherBumps: BumpRef[];
  /** Changed-file set or +/- stats differ from the representative PR. */
  differs: boolean;
  approvedByYou: boolean;
  createdAt: string;
  updatedAt: string;
  pending: PendingWrite | null;
};

export type DiffFile = {
  path: string;
  previousPath: string | null;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  /** Unified diff hunks. Null when GitHub omits the patch (binary or too large). */
  patch: string | null;
};

export type ReleaseInfo = {
  publishedAt: string | null;
  ageDays: number | null;
  advisories: string[];
  hasNewInstallScript: boolean | null;
  links: { label: string; url: string }[];
};

export type Verdict = {
  key: string;
  semver: SemverClass;
  decidedAt: string;
  expiresAt: string;
};

export type GroupView = {
  key: string;
  ecosystem: Ecosystem;
  pkg: string;
  to: string;
  semver: SemverClass;
  fromVersions: { version: string; count: number }[];
  release: ReleaseInfo | null;
  /** Group-level gate summary: fail if any row fails, na if no row applies. */
  gates: GateResult[];
  /** Release notes as the bot wrote them (markdown). Sanitised on render, never trusted. */
  notes: string | null;
  representative: { prId: string; repo: string; number: number; files: DiffFile[] } | null;
  rows: GroupRow[];
  verdicts: Verdict[];
};

// ---------------------------------------------------------------------------
// Writes

export type ActionKind = "approve" | "rebase" | "recreate";

export type PlanStep = {
  prId: string;
  repo: string;
  number: number;
  account: string;
  writes: ("approve" | "comment")[];
  /** Why this PR is skipped, if it is. Skipped steps cost no writes. */
  skip: string | null;
};

export type PlanPreview = {
  planId: string;
  action: ActionKind;
  steps: PlanStep[];
  writes: number;
  perAccount: { account: string; writes: number; hourShare: number }[];
  etaSeconds: number;
  /** Verdicts recorded when the plan is committed. */
  verdicts: { key: string; semver: SemverClass }[];
  warnings: string[];
};

export type LogEntry = {
  commandId: string;
  kind: CommandKind;
  account: string;
  target: { repo: string; number: number; title: string };
  state: OutboxState;
  detail: string | null;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// PR canvas

export type CheckRun = {
  name: string;
  state: "success" | "failure" | "pending" | "neutral" | "skipped";
};

export type Side = "LEFT" | "RIGHT";

export type ThreadComment = {
  id: string;
  author: Actor | null;
  body: string;
  bodyHTML: string;
  createdAt: string;
  edited: boolean;
};

export type Thread = {
  id: string;
  path: string;
  side: Side;
  /** Current position; null when the thread is outdated (its lines no longer exist). */
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  subject: "line" | "file";
  resolved: boolean;
  outdated: boolean;
  resolvedBy: string | null;
  canResolve: boolean;
  canReply: boolean;
  /** The hunk the thread was written against, for showing outdated threads in context. */
  diffHunk: string;
  comments: ThreadComment[];
  /** A reply or resolve that hasn't reached GitHub yet. */
  pending: PendingWrite | null;
};

/** A new inline comment that lives only in pier until the review is submitted. */
export type Draft = {
  id: string;
  path: string;
  side: Side;
  line: number;
  startLine: number | null;
  body: string;
  /** The head commit the draft was written against. */
  headOid: string;
  createdAt: string;
};

export type TimelineEntry =
  | { kind: "comment"; id: string; author: Actor | null; bodyHTML: string; at: string }
  | {
      kind: "review";
      id: string;
      author: Actor | null;
      state: string;
      bodyHTML: string;
      at: string;
      commitOid: string | null;
    }
  | { kind: "commit"; oid: string; headline: string; author: string | null; at: string }
  | {
      kind: "force-push";
      before: string | null;
      after: string | null;
      actor: string | null;
      at: string;
    }
  | { kind: "event"; text: string; actor: string | null; at: string };

export type ViewedState = "viewed" | "unviewed" | "changed";

export type PrView = {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  body: string;
  /** GitHub's rendered body (mentions and references resolved). Sanitised again on render. */
  bodyHTML: string | null;
  author: Actor | null;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  createdAt: string;
  updatedAt: string;
  checks: CheckSummary & { contexts: CheckRun[] };
  reviewDecision: ReviewDecision;
  mergeable: Mergeable;
  labels: { name: string; color: string }[];
  /** `state` is "requested" for a pending request, else the review state (APPROVED, …). */
  reviewers: { login: string; kind: "user" | "team" | "bot"; state: string }[];
  account: string;
  approvedByYou: boolean;
  /** The commit your last review was against, if you've reviewed before. */
  lastReviewedOid: string | null;
  pending: PendingWrite | null;
  /** Null until fetched; the first open of a PR loads them. */
  files: DiffFile[] | null;
  threads: Thread[];
  drafts: Draft[];
  timeline: TimelineEntry[];
  viewed: Record<string, ViewedState>;
  /** A review started on github.com that hasn't been submitted; submitting here continues it. */
  pendingReviewId: string | null;
  /** Detail (threads, timeline) has loaded at least once. */
  detailLoaded: boolean;
};

/** "All changes", or only what changed since you last reviewed. */
export type DiffRange = "all" | "since-review";

export type PrDiff = {
  range: DiffRange;
  files: DiffFile[];
  /** Set when the requested range couldn't be computed and the full diff was returned instead. */
  fallback: string | null;
  fromOid: string | null;
  toOid: string;
};

// ---------------------------------------------------------------------------
// In flight

export type FlightItem = {
  prId: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  account: string;
  /** Whose move it is and what they are waiting on. */
  waitingOn: string;
  checks: CheckSummary;
  mergePath: MergePath;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Status line

export type AccountStatus = {
  login: string;
  avatarUrl: string;
  ok: boolean;
  scopes: string[];
  missingScopes: string[];
  graphql: { remaining: number; limit: number; resetAt: string } | null;
  rest: { remaining: number; limit: number; resetAt: string } | null;
  writesThisHour: number;
};

export type AppStatus = {
  version: string;
  accounts: AccountStatus[];
  sync: {
    state: "idle" | "syncing" | "error";
    lastSyncAt: string | null;
    trackedPrs: number;
    message: string | null;
  };
  outbox: { queued: number; held: number; waiting: number; failed: number; unknown: number };
  counts: SplitCounts;
};
