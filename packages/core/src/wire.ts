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
  | "held"
  | "queued"
  | "claimed"
  | "acked"
  | "unknown"
  | "failed"
  | "cancelled";

export type PendingWrite = {
  commandId: string;
  kind: CommandKind;
  state: OutboxState;
  sendAt: string;
};

export type CommandKind = "approve" | "bot-command";

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

export type PrView = {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  body: string;
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
  account: string;
  approvedByYou: boolean;
  pending: PendingWrite | null;
  /** Null until fetched; the first open of a PR loads them. */
  files: DiffFile[] | null;
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
  outbox: { queued: number; held: number; failed: number; unknown: number };
  counts: SplitCounts;
};
