import type { CodeOwnerRule } from "./codeowners";
// Everything the daemon sends to the web app. Plain types only: the daemon is trusted,
// so outputs are typed rather than validated. Inputs live in `contract.ts` as ArkType schemas.
import type { DepsPolicy, Scope } from "./settings";

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

export type Person = { login: string; avatarUrl: string };
/** Someone GitHub suggests asking to review; bots (Copilot) only appear where they're enabled. */
export type SuggestedReviewer = Person & { bot: boolean };
export type LinkedIssue = {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED";
};
export type Label = { name: string; color: string; description: string | null };
export type Milestone = { number: number; title: string; dueOn: string | null };

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
  | "unviewed"
  | "notification-done"
  | "rerun-failed"
  | "merge"
  | "auto-merge"
  | "update-branch"
  | "labels"
  | "assignees"
  | "reviewers"
  | "milestone"
  | "draft"
  | "close"
  | "reopen"
  | "react"
  | "edit-comment"
  | "delete-comment"
  | "minimize"
  | "edit-pr"
  | "dismiss-review"
  | "lock"
  | "rerun-all"
  | "rerun-job"
  | "cancel-run"
  | "approve-run"
  | "approve-deployment"
  | "enqueue"
  | "dequeue"
  | "delete-branch"
  | "restore-branch"
  | "revert"
  | "suggestions"
  | "subscription"
  | "notification-read"
  | "unstack"
  | "archive"
  | "unarchive"
  | "project";

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
  state: PrView["state"];
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

/** Tracked PRs in GitHub's merge queue or armed to merge when ready. */
export type MergeQueueItem = PrItem & {
  baseRefName: string;
  position: number | null;
  queueState: string | null;
  autoMerge: string | null;
};

/** What a search found: the first matches, how many there were, and what didn't parse. */
export type SearchResult = { items: PrItem[]; total: number; errors: string[] };

/** GitHub's own answer to a search: what it found, the query it was asked, what was left out. */
export type RemoteSearch = { items: PrItem[]; query: string; dropped: string[] };

/** The projects a PR is on and could go on, or the scope it would take to see them. */
export type PrProjects =
  | {
      state: "ok";
      on: {
        projectId: string;
        itemId: string;
        title: string;
        status: string | null;
        url: string;
      }[];
      available: { id: string; title: string; url: string }[];
    }
  | { state: "no-scope"; fix: string };

/** A reply saved for reuse. */
export type SavedReply = { id: string; title: string; body: string };

/** A saved search, with how many PRs it finds now. */
export type SavedView = { id: string; name: string; query: string; count: number };

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
  /** A single-bump PR whose changed-file set or +/- stats differ from the representative PR. */
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
  /** Your verdict on this version, withdrawn by an advisory, until you dismiss the notice. */
  revocation: Revocation | null;
};

export type PrRef = { prId: string; repo: string; number: number; title: string };

/**
 * A verdict withdrawn because an advisory against its version appeared after you gave it. The
 * open PRs carrying the version no longer count as decided; the merged ones already shipped it.
 */
export type Revocation = {
  key: string;
  ecosystem: Ecosystem;
  pkg: string;
  to: string;
  /** Advisories that weren't known when you decided. */
  advisories: string[];
  decidedAt: string;
  revokedAt: string;
  /** `approved`: your approval stands on GitHub, so automation can still merge it. */
  open: (PrRef & { approved: boolean })[];
  merged: PrRef[];
};

// ---------------------------------------------------------------------------
// Writes

/** `ignore`: close the PR and have the bot skip this version (Dependabot's "ignore this version"). */
export type ActionKind = "approve" | "rebase" | "recreate" | "ignore";

export type PlanStep = {
  prId: string;
  repo: string;
  number: number;
  account: string;
  writes: ("approve" | "comment" | "close")[];
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

export type ReactionContent =
  | "THUMBS_UP"
  | "THUMBS_DOWN"
  | "LAUGH"
  | "HOORAY"
  | "CONFUSED"
  | "HEART"
  | "ROCKET"
  | "EYES";

export type Reaction = { content: ReactionContent; count: number; mine: boolean };

/** Why a comment is hidden, in GitHub's words. */
export type MinimizeReason =
  | "SPAM"
  | "ABUSE"
  | "OFF_TOPIC"
  | "OUTDATED"
  | "DUPLICATE"
  | "RESOLVED"
  | "LOW_QUALITY";

/** Why a conversation is locked, as GitHub's lock endpoint takes it. */
export type LockReason = "off-topic" | "too heated" | "resolved" | "spam";

/** Which GitHub object a piece of writing is, so edits and deletes reach the right mutation. */
export type CommentSubject = "issue-comment" | "review-comment" | "review" | "pull-request";

/** A comment, review or description, with what you can do to it. */
export type Commentable = {
  subject: CommentSubject;
  body: string;
  edited: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canMinimize: boolean;
  /** Why it was hidden, when it was. */
  minimized: string | null;
  reactions: Reaction[];
  /** Your edit hasn't reached GitHub yet, so `body` is newer than `bodyHTML`. */
  unsent: boolean;
};

/** One version of something that was edited, newest first in lists. */
export type Revision = { editedAt: string; editor: string | null; body: string };

export type ThreadComment = Commentable & {
  id: string;
  author: Actor | null;
  bodyHTML: string;
  createdAt: string;
};

export type Thread = {
  id: string;
  path: string;
  side: Side;
  /** Current position; null when the thread is outdated (its lines no longer exist). */
  line: number | null;
  startLine: number | null;
  /** Which side a multi-line comment starts on (it can start on removed lines). */
  startSide: Side | null;
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
  /** Null for a comment on the whole file. */
  line: number | null;
  startLine: number | null;
  body: string;
  /** The head commit the draft was written against. */
  headOid: string;
  createdAt: string;
};

export type TimelineEntry =
  | (Commentable & {
      kind: "comment";
      id: string;
      author: Actor | null;
      bodyHTML: string;
      at: string;
    })
  | (Commentable & {
      kind: "review";
      id: string;
      author: Actor | null;
      state: string;
      bodyHTML: string;
      at: string;
      commitOid: string | null;
      /** You can dismiss it: someone else's approval or change request, and you can write. */
      canDismiss: boolean;
    })
  | { kind: "commit"; oid: string; headline: string; author: string | null; at: string }
  | {
      kind: "force-push";
      before: string | null;
      after: string | null;
      actor: string | null;
      at: string;
    }
  | {
      kind: "event";
      text: string;
      actor: string | null;
      at: string;
      /** Where the event points, when it's about another issue or PR. */
      url?: string;
    };

export type ViewedState = "viewed" | "unviewed" | "changed";

export type PendingReview = {
  id: string;
  /** The commit it was started on, which may be older than the head. */
  commitOid: string | null;
  /** Its comments so far; `line` is null for one on the whole file (or whose line is gone). */
  comments: {
    id: string;
    path: string;
    line: number | null;
    startLine: number | null;
    body: string;
  }[];
};

export type PrView = {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  body: string;
  /** GitHub's rendered body (mentions and references resolved). Sanitised again on render. */
  bodyHTML: string | null;
  /** The description's reactions, and whether you can edit the title and description. */
  reactions: Reaction[];
  canEdit: boolean;
  /** The lock reason when the conversation is locked ("resolved", "too heated", …). */
  locked: string | null;
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
  /**
   * `state` is "requested" for a pending request, else the review state (APPROVED, …).
   * `codeOwner` marks a request GitHub made because the reviewer owns files here.
   */
  reviewers: { login: string; kind: "user" | "team" | "bot"; state: string; codeOwner: boolean }[];
  assignees: Person[];
  milestone: Milestone | null;
  /** Issues this PR closes when it merges. */
  linkedIssues: LinkedIssue[];
  /** Names of checks branch rules require to pass before merging. */
  requiredChecks: string[];
  /** The PR's commits, oldest first (the last 100). */
  commits: CommitView[];
  /** How many commits it has in all, when that's more than `commits` holds. */
  commitsTotal: number;
  /** Null when the base branch has no CODEOWNERS. */
  codeOwners: CodeOwners | null;
  /** You can push to the head branch, so review suggestions can be committed to it. */
  canApplySuggestions: boolean;
  /** Whether GitHub notifies you about everything here, only when you're involved, or never. */
  subscription: Subscription | null;
  /** The stack it's part of, if it is. */
  stack: PrStack | null;
  /** The head branch: whether it's still there, and what you can do about it. */
  headBranch: { exists: boolean; canDelete: boolean; canRestore: boolean };
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
  /** A review you started on github.com and haven't submitted; submitting here continues it. */
  pendingReview: PendingReview | null;
  /** Detail (threads, timeline) has loaded at least once. */
  detailLoaded: boolean;
};

/**
 * Which changes to show: all of them, only what changed since you last reviewed, or what a run of
 * commits did (`from` and `to` are the same commit for a single one).
 */
export type DiffView =
  | { range: "all" }
  | { range: "since-review" }
  | { range: "commits"; from: string; to: string };

export type DiffRange = DiffView["range"];

/** The base branch's CODEOWNERS, and the owner names that mean you (`@login`, `@org/team`). */
export type CodeOwners = { rules: CodeOwnerRule[]; you: string[] };

/**
 * A stack of PRs, each on top of the one below: merging one merges everything under it too.
 * Position 1 sits on `base`.
 */
export type PrStack = {
  number: number;
  base: string;
  /** Bottom to top. `title` is null for a PR pier doesn't track. */
  prs: {
    number: number;
    position: number;
    title: string | null;
    state: "open" | "closed";
    draft: boolean;
    merged: boolean;
  }[];
};

/** GitHub's notification settings for one PR: all activity, only when involved, or muted. */
export type Subscription = "SUBSCRIBED" | "UNSUBSCRIBED" | "IGNORED";

/** One commit on the PR, for picking which ones to look at. */
export type CommitView = {
  oid: string;
  headline: string;
  body: string;
  author: string | null;
  at: string;
  /** Its checks' overall state. */
  checks: CheckState;
  /** A verified signature (true), a bad one (false), or none (null). */
  verified: boolean | null;
};

export type PrDiff = {
  range: DiffRange;
  files: DiffFile[];
  /** Set when the requested range couldn't be computed and the full diff was returned instead. */
  fallback: string | null;
  fromOid: string | null;
  toOid: string;
};

export type MergeMethod = "MERGE" | "SQUASH" | "REBASE";

/** One reason a PR can't merge yet, and the key that fixes it when there is one. */
export type Blocker = {
  text: string;
  fix: "update-branch" | "rerun" | "auto-merge" | "ready" | null;
};

export type Runway = {
  ready: boolean;
  blockers: Blocker[];
  methods: MergeMethod[];
  defaultMethod: MergeMethod;
  /** GitHub's default commit title and body for each method (rebase has none). */
  messages: Partial<Record<MergeMethod, { headline: string; body: string }>>;
  canAutoMerge: boolean;
  canCancelAutoMerge: boolean;
  autoMerge: { method: MergeMethod; headline?: string; body?: string } | null;
  mergeQueue: { position: number; state: string } | null;
  canUpdateBranch: boolean;
  /** The base branch merges through a queue, so "merge" means "add to the queue". */
  queued: boolean;
  /** Rules block it, but you're an admin who may merge anyway (after typing the repo's name). */
  canBypass: boolean;
};

export type CheckRunView = {
  id: number;
  name: string;
  state: CheckRun["state"];
  /** A check run (Actions or an app) or a commit status (most external CI). */
  kind: "check" | "status";
  /** The Actions job behind this check, when it is one (for logs and re-runs). */
  jobId: number | null;
  runId: number | null;
  url: string;
  /** A commit status's one-line description, or a check run's title. */
  summary: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** Annotations the check left on the code. */
  annotations: number;
  /** For an Actions job, its workflow's name; GitHub calls the check "workflow / job". */
  workflow: string | null;
  /** What triggered the workflow, when another run of it on this commit had a different trigger. */
  event: string | null;
};

/** An Actions workflow run on the head, for what's done to a run as a whole. */
export type WorkflowRunView = {
  id: number;
  /** The workflow file it ran; two files can share a name. */
  workflowId: number;
  name: string;
  /** What triggered it: "pull_request", "push", "pull_request_review", … */
  event: string;
  state: CheckRun["state"];
  /** Held until someone with write access approves it (a first-time or fork contributor). */
  needsApproval: boolean;
  /** Environments it's waiting on a reviewer for, and whether you can approve them. */
  waitingOn: { id: number; name: string; canApprove: boolean }[];
  url: string;
};

export type DeploymentView = {
  id: number;
  environment: string;
  state: string;
  url: string | null;
  at: string;
};

/** Everything CI says about the head: checks, statuses, runs and deployments. */
export type ChecksView = {
  runs: CheckRunView[];
  workflows: WorkflowRunView[];
  deployments: DeploymentView[];
};

export type Annotation = {
  check: string;
  path: string;
  startLine: number;
  endLine: number;
  level: "notice" | "warning" | "failure";
  title: string | null;
  message: string;
};

/** One step of a job, with the parts of the log it wrote (an action's own groups nest here). */
export type StepLog = {
  name: string;
  state: CheckRun["state"];
  sections: LogSection[];
};

/** A slice of a job's log under one `##[group]` heading (a step, or part of one). */
export type LogSection = {
  title: string;
  lines: string[];
  /** Indexes into `lines` that GitHub marked as errors. */
  errors: number[];
};

export type CheckLog = {
  steps: StepLog[];
  /** The log was longer than pier keeps; the earliest lines were left out. */
  truncated: boolean;
  url: string;
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

/** The settings screen: what pier watches, how many PRs each search finds, and the deps policy. */
export type SettingsView = {
  /** `found`: open PRs on the scope's last full search; null before it has run. */
  scopes: (Scope & { found: number | null })[];
  /** Owners whose repos you work in, where pier doesn't watch bot PRs yet. */
  suggestions: { owner: string; repos: number; account: string }[];
  policy: DepsPolicy;
};
