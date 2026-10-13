import { GitHubError } from "@/github/client";
import type { DraftThreadInput, GitHubPort, ReviewEvent } from "@/github/port";
import type { CheckContext, PrCommit, PrState } from "@/github/pr-doc";
import { codeOwnersMatcher, parseCodeOwners } from "@pier/core/codeowners";
import type {
  Actor,
  Bump,
  CheckState,
  DiffFile,
  Ecosystem,
  MergeMethod,
  Mergeable,
  MinimizeReason,
  ReactionContent,
  ReviewDecision,
  Subscription,
  TimelineEntry,
} from "@pier/core/wire";

import { countPatch, diffHunkAt, movedLine, unifiedDiff } from "./diff";
import { Random } from "./random";

// The whole fake GitHub, in memory: users, orgs, repos, PRs and everything that happens to them.
// Ports (one per account) read and write it under GitHub's rules; scenarios and tests drive it
// directly through the helpers below. Time is the world's own clock, so the delays GitHub and
// the bots add (auto-merge, CI, Dependabot rebases) can be skipped in tests with `advance()`.

export type Permission = "ADMIN" | "MAINTAIN" | "WRITE" | "TRIAGE" | "READ";
export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";

export type FakeUser = { login: string; databaseId: number; name: string; isBot: boolean };

export type FakeRepo = {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
  archived: boolean;
  defaultBranch: string;
  /** Tip of the default branch; moves whenever a PR merges. */
  headOid: string;
  collaborators: Map<string, Permission>;
  /** Users subscribed to every PR in the repo. */
  watchers: Set<string>;
  requiredApprovals: number;
  dismissStaleReviews: boolean;
  /** Bot PRs open with auto-merge armed, and merge once approved. */
  automergeOnApproval: boolean;
  /** CI job names, used when a scenario gives checks as a single state. */
  checkNames: string[];
  /** Allowed merge methods; the first is the default. */
  mergeMethods: MergeMethod[];
  autoMergeAllowed: boolean;
  /** The repo's label catalogue, by name. */
  labels: Map<string, { color: string; description: string | null }>;
  /** Merges to the default branch go through a queue. */
  mergeQueue: boolean;
  /** Branches deleted (after their PR merged or closed). */
  deletedBranches: Set<string>;
  milestones: { number: number; title: string; dueOn: string | null }[];
  /** The default branch's CODEOWNERS, if it has one. */
  codeOwners: string | null;
  /** Projects (v2) its PRs can go on. */
  projects: { id: string; title: string }[];
};

export type RepoOptions = Partial<
  Pick<
    FakeRepo,
    | "isPrivate"
    | "archived"
    | "defaultBranch"
    | "requiredApprovals"
    | "dismissStaleReviews"
    | "automergeOnApproval"
    | "checkNames"
    | "mergeMethods"
    | "autoMergeAllowed"
    | "mergeQueue"
    | "codeOwners"
  >
> & { collaborators?: Record<string, Permission>; watchers?: string[] };

export type FakeFile = {
  path: string;
  previousPath: string | null;
  status: DiffFile["status"];
  patch: string | null;
  additions: number;
  deletions: number;
  /** Bumped by every push that touches the file; viewed marks from before it become DISMISSED. */
  revision: number;
};

/** What every piece of writing carries: when it was last edited, whether it's hidden, reactions. */
export type Writing = {
  editedAt: string | null;
  /** Every version once it's been edited, newest first, like GitHub's userContentEdits. */
  history: { editedAt: string; editor: string; body: string }[];
  minimized: string | null;
  /** Who left each reaction. */
  reactions: Map<ReactionContent, Set<string>>;
};

export type FakeReview = Writing & {
  id: string;
  author: string;
  state: ReviewState;
  commitOid: string;
  body: string;
  submittedAt: string | null;
};

export type FakeComment = Writing & { id: string; author: string; body: string; createdAt: string };

/** A piece of writing found by id; the subject says which kind it is. */
export type FoundWriting =
  | { pr: FakePr; subject: "pull-request"; target: FakePr }
  | { pr: FakePr; subject: "issue-comment" | "review-comment"; target: FakeComment }
  | { pr: FakePr; subject: "review"; target: FakeReview };

export type FakeThread = {
  id: string;
  /** On a line, or on the whole file (which never goes outdated). */
  subject: "line" | "file";
  path: string;
  side: "LEFT" | "RIGHT";
  /** Null once a push changes the file and the thread is outdated. */
  line: number | null;
  startLine: number | null;
  originalLine: number;
  resolved: boolean;
  resolvedBy: string | null;
  diffHunk: string;
  comments: (FakeComment & { reviewId: string; commitOid: string })[];
};

/** One Actions job reporting on a commit; like on GitHub, its check run id is the job id. */
export type FakeCheckRun = CheckContext & {
  id: number;
  runId: number;
  startedAt: string | null;
  completedAt: string | null;
};

export type FakeEvent = Extract<TimelineEntry, { kind: "force-push" | "event" }>;

export type FakeNotification = {
  threadId: string;
  prId: string;
  reason: string;
  updatedAt: string;
  unread: boolean;
};

export type FakePr = {
  id: string;
  number: number;
  repo: FakeRepo;
  title: string;
  body: string;
  author: string;
  state: PrState;
  /** Archived (a public preview): closed, and set aside. */
  archived?: boolean;
  /** Its items on projects, by project id. */
  projectItems?: Map<string, { itemId: string; status: string | null }>;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  baseRefName: string;
  headRefName: string;
  baseRefOid: string;
  /** Oldest first; the last one is the head. */
  commits: PrCommit[];
  files: FakeFile[];
  mergeable: Mergeable;
  labels: { name: string; color: string }[];
  assignees: string[];
  milestone: number | null;
  /** Reactions on the description. */
  reactions: Map<ReactionContent, Set<string>>;
  /** The lock reason ("resolved", "off-topic", …) while the conversation is locked. */
  locked: string | null;
  /** Place in the merge queue, while it's in one. */
  queuePosition: number | null;
  /** Check runs per commit; a commit with no entry has reported nothing. */
  checks: Map<string, FakeCheckRun[]>;
  reviews: FakeReview[];
  threads: FakeThread[];
  comments: FakeComment[];
  events: FakeEvent[];
  /** Requested reviewers: user logins, or "org/slug" for teams. */
  requested: Set<string>;
  /** login -> path -> the file revision they marked viewed. */
  viewed: Map<string, Map<string, number>>;
  mentions: Set<string>;
  autoMerge: { enabledAt: string; method: MergeMethod } | null;
  /** The merge base of every head this PR has had, so old heads resolve after a force-push. */
  bases: Map<string, string>;
  /** What a bot PR carries, as the scenario meant it; tests check parseBotPr against this. */
  bumps: Bump[];
};

export type FakeRelease = { publishedAt: string; advisories: string[]; installScript: boolean };

export type FakePackage = {
  ecosystem: Ecosystem;
  name: string;
  sourceUrl: string;
  releases: Map<string, FakeRelease>;
};

/** Contents and a patch diffed against the base, or a hand-written patch with no contents. */
export type FileChange =
  | { path: string; after: string | null; before?: string | null; previousPath?: string }
  | { path: string; patch: string; status?: DiffFile["status"] };

export type CommitInput = {
  message: string;
  /** Defaults to the PR author. */
  author?: string;
  /** Signed and verified; defaults to true for bots and unsigned (null) for people. */
  signed?: boolean | null;
  at?: number;
};

/** A rollup state (expanded over the repo's check names) or explicit contexts. */
export type ChecksInput = CheckState | CheckContext[];

export type OpenPrInput = {
  repo: string;
  author: string;
  title: string;
  body?: string;
  headRefName: string;
  baseRefName?: string;
  files: FileChange[];
  /** Oldest first. Defaults to one commit by the author, titled after the PR. */
  commits?: CommitInput[];
  isDraft?: boolean;
  labels?: { name: string; color: string }[];
  checks?: ChecksInput;
  reviewers?: string[];
  createdAt?: number;
  mergeable?: Mergeable;
  bumps?: Bump[];
};

export type ReviewInput = {
  event: ReviewEvent | "PENDING";
  body?: string;
  /** Defaults to the current head. */
  commitOid?: string;
  threads?: DraftThreadInput[];
};

export type FaultKind = "secondary-limit" | "server" | "network" | "drop-response" | "conflict";
export type FaultMethod = Exclude<keyof GitHubPort, "login" | "rates">;

/**
 * One injected failure, consumed in queue order by the first matching call. "drop-response"
 * applies a write and then fails as if the connection dropped before the answer arrived.
 */
export type Fault = {
  account?: string;
  method: FaultMethod;
  kind: FaultKind;
  times?: number;
  retryAfterMs?: number;
};

export type WorldOptions = {
  seed?: number;
  /** "real" follows the wall clock (plus any `advance`), "manual" only moves on `advance`. */
  clock?: "real" | "manual";
  /** Where a manual clock starts. */
  start?: number;
  automergeDelayMs?: number;
  /** How long the async merge API takes to merge an accepted request. */
  mergeDelayMs?: number;
  /** How long Dependabot takes to act on a command or rebase after a sibling merges. */
  botDelayMs?: number;
  ciDurationMs?: number;
  /** Added to every port call, so loading states show up in the UI. */
  latencyMs?: number;
  /** Requests per resource per rolling hour before GitHub refuses. */
  rateLimit?: number;
  /** How failed jobs end up after "re-run failed jobs". */
  rerunOutcome?: "success" | "failure";
};

const BOT_APPS = ["dependabot", "renovate", "github-actions"];

// GitHub's starter labels, plus the ones Dependabot adds.
const DEFAULT_LABELS = [
  { name: "bug", color: "d73a4a", description: "Something isn't working" },
  {
    name: "documentation",
    color: "0075ca",
    description: "Improvements or additions to documentation",
  },
  { name: "enhancement", color: "a2eeef", description: "New feature or request" },
  { name: "good first issue", color: "7057ff", description: "Good for newcomers" },
  { name: "help wanted", color: "008672", description: "Extra attention is needed" },
  { name: "question", color: "d876e3", description: "Further information is requested" },
  {
    name: "dependencies",
    color: "0366d6",
    description: "Pull requests that update a dependency file",
  },
];
const BOT_USER_IDS: Record<string, number> = {
  dependabot: 49699333,
  renovate: 29139614,
  "github-actions": 41898282,
};

export class FakeWorld {
  readonly random: Random;
  readonly options: Required<Omit<WorldOptions, "seed" | "clock" | "start">>;
  /** Logins that have a gh token, in gh's order. */
  accounts: string[] = [];
  readonly users = new Map<string, FakeUser>();
  /** org -> members */
  readonly orgs = new Map<string, Set<string>>();
  /** "org/slug" -> members */
  readonly teams = new Map<string, Set<string>>();
  readonly repos = new Map<string, FakeRepo>();
  readonly prs = new Map<string, FakePr>();
  readonly packages = new Map<string, FakePackage>();
  faults: Fault[] = [];
  /** Requests accepted by the async merge API, by uuid. */
  readonly mergeRequests = new Map<
    string,
    { prId: string; status: "pending" | "merged" | "failed"; message: string }
  >();
  /** Every "re-run failed jobs" request, for tests to assert on. */
  readonly reruns: { repo: string; runId: number; by: string; at: string }[] = [];

  private readonly byNumber = new Map<string, FakePr>();
  private readonly threadPrs = new Map<string, FakePr>();
  private readonly nextNumber = new Map<string, number>();
  /** `${repo}@${oid}` -> path -> contents, for the files scenarios gave contents for. */
  private readonly trees = new Map<string, Map<string, string>>();
  private readonly notes = new Map<string, Map<string, FakeNotification>>();
  /** Stacks by `${repo}#${number}`; their PRs bottom to top. */
  readonly stacks = new Map<string, { number: number; repo: FakeRepo; prIds: string[] }>();
  /** Per PR, who has changed how they're notified about it. */
  readonly subscriptions = new Map<string, Map<string, Subscription>>();
  private readonly noteIds = new Map<string, string>();
  private readonly noteVersions = new Map<string, number>();
  private timers: { at: number; seq: number; run: () => void }[] = [];
  private timerSeq = 0;
  private readonly clock: "real" | "manual";
  private readonly start: number;
  private skew = 0;
  /** While a scheduled event runs, the clock reads its due time. */
  private frozen: number | null = null;
  private nextDatabaseId = 1_000_000;
  private nextNoteId = 13_000_000_000;
  private nextRunId = 18_200_000_000;
  private nextJobId = 51_700_000_000;

  constructor(options: WorldOptions = {}) {
    this.random = new Random(options.seed ?? 1);
    this.clock = options.clock ?? "real";
    this.start = options.start ?? Date.now();
    this.options = {
      automergeDelayMs: options.automergeDelayMs ?? 30_000,
      mergeDelayMs: options.mergeDelayMs ?? 3_000,
      botDelayMs: options.botDelayMs ?? 45_000,
      ciDurationMs: options.ciDurationMs ?? 3 * 60_000,
      latencyMs: options.latencyMs ?? 0,
      rateLimit: options.rateLimit ?? 5_000,
      rerunOutcome: options.rerunOutcome ?? "success",
    };
    for (const bot of BOT_APPS) this.addUser(bot, { isBot: true });
  }

  // -------------------------------------------------------------------------
  // Clock

  now(): number {
    return this.frozen ?? (this.clock === "real" ? Date.now() : this.start) + this.skew;
  }

  /** GitHub's timestamp format: UTC, whole seconds. */
  iso(ms = this.now()): string {
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  advance(ms: number): void {
    this.skew += ms;
    this.tick();
  }

  /** Runs `fn` as if it happened at `ms`, for building history in the past. */
  at<T>(ms: number, fn: () => T): T {
    const previous = this.frozen;
    this.frozen = ms;
    try {
      return fn();
    } finally {
      this.frozen = previous;
    }
  }

  schedule(delayMs: number, run: () => void): void {
    this.timers.push({ at: this.now() + delayMs, seq: this.timerSeq++, run });
  }

  /** Runs everything that has come due, in order, each at its own time. */
  tick(): void {
    for (;;) {
      const now = this.now();
      const due = this.timers
        .filter((t) => t.at <= now)
        .toSorted((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!due) return;
      this.timers = this.timers.filter((t) => t !== due);
      this.frozen = due.at;
      try {
        due.run();
      } finally {
        this.frozen = null;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Ids

  nodeId(prefix: string, length = 16): string {
    return `${prefix}_kwDO${this.random.idChars(length)}`;
  }

  oid(): string {
    return this.random.hex(40);
  }

  // -------------------------------------------------------------------------
  // People and repos

  addUser(login: string, options: { name?: string; isBot?: boolean } = {}): FakeUser {
    const existing = this.users.get(login);
    if (existing) return existing;
    const user = {
      login,
      databaseId: BOT_USER_IDS[login] ?? this.nextDatabaseId++,
      name: options.name ?? login,
      isBot: options.isBot ?? false,
    };
    this.users.set(login, user);
    return user;
  }

  addOrg(org: string, members: string[]): void {
    this.orgs.set(org, new Set([...(this.orgs.get(org) ?? []), ...members]));
  }

  addTeam(org: string, slug: string, members: string[]): void {
    this.teams.set(`${org}/${slug}`, new Set(members));
  }

  addRepo(fullName: string, options: RepoOptions = {}): FakeRepo {
    const [owner = "", name = ""] = fullName.split("/");
    const repo: FakeRepo = {
      id: `R_kgDO${this.random.idChars(8)}`,
      owner,
      name,
      fullName,
      isPrivate: options.isPrivate ?? false,
      archived: options.archived ?? false,
      defaultBranch: options.defaultBranch ?? "main",
      headOid: this.oid(),
      collaborators: new Map(Object.entries(options.collaborators ?? {})),
      watchers: new Set(options.watchers ?? []),
      requiredApprovals: options.requiredApprovals ?? 1,
      dismissStaleReviews: options.dismissStaleReviews ?? false,
      automergeOnApproval: options.automergeOnApproval ?? false,
      checkNames: options.checkNames ?? ["build", "test", "lint"],
      mergeMethods: options.mergeMethods ?? ["MERGE", "SQUASH", "REBASE"],
      autoMergeAllowed: options.autoMergeAllowed ?? true,
      labels: new Map(DEFAULT_LABELS.map(({ name: label, ...rest }) => [label, rest])),
      mergeQueue: options.mergeQueue ?? false,
      codeOwners: options.codeOwners ?? null,
      projects: [],
      deletedBranches: new Set(),
      milestones: [
        { number: 1, title: "Next release", dueOn: this.iso(this.now() + 14 * 86_400_000) },
        { number: 2, title: "Backlog", dueOn: null },
      ],
    };
    this.repos.set(fullName, repo);
    return repo;
  }

  addRelease(
    ecosystem: Ecosystem,
    name: string,
    version: string,
    release: FakeRelease,
    sourceUrl = "",
  ): void {
    const key = `${ecosystem}:${name}`;
    const pkg = this.packages.get(key) ?? { ecosystem, name, sourceUrl, releases: new Map() };
    pkg.releases.set(version, release);
    this.packages.set(key, pkg);
  }

  release(ecosystem: Ecosystem, name: string, version: string): FakeRelease | null {
    return this.packages.get(`${ecosystem}:${name}`)?.releases.get(version) ?? null;
  }

  /** Drawn here (a letter on a tint) so a fake run never fetches a real person's picture. */
  avatarUrl(login: string): string {
    let hue = 0;
    for (let i = 0; i < login.length; i++) hue = (hue + login.charCodeAt(i)) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${hue} 30% 32%)"/><text x="32" y="42" font-family="sans-serif" font-size="30" fill="#e6e6e6" text-anchor="middle">${login.charAt(0).toUpperCase()}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  actor(login: string): Actor {
    return {
      login,
      avatarUrl: this.avatarUrl(login),
      isBot: this.users.get(login)?.isBot ?? false,
    };
  }

  permission(repo: FakeRepo, login: string): Permission | null {
    if (repo.owner === login) return "ADMIN";
    const explicit = repo.collaborators.get(login);
    if (explicit) return explicit;
    if (this.orgs.get(repo.owner)?.has(login)) return "WRITE";
    return repo.isPrivate ? null : "READ";
  }

  canWrite(repo: FakeRepo, login: string): boolean {
    const permission = this.permission(repo, login);
    return permission === "ADMIN" || permission === "MAINTAIN" || permission === "WRITE";
  }

  // -------------------------------------------------------------------------
  // Lookups

  pr(id: string): FakePr | undefined {
    return this.prs.get(id);
  }

  prByNumber(repo: string, number: number): FakePr | undefined {
    return this.byNumber.get(`${repo}#${number}`);
  }

  threadById(id: string): { pr: FakePr; thread: FakeThread } | undefined {
    const pr = this.threadPrs.get(id);
    const thread = pr?.threads.find((t) => t.id === id);
    return pr && thread ? { pr, thread } : undefined;
  }

  head(pr: FakePr): string {
    return pr.commits.at(-1)?.oid ?? pr.baseRefOid;
  }

  fileText(repo: string, oid: string, path: string): string | null {
    return this.trees.get(`${repo}@${oid}`)?.get(path) ?? null;
  }

  /** The base a head was cut from, for any head a PR in this repo has ever had. */
  mergeBase(repo: string, head: string): string | null {
    if (this.repos.get(repo)?.headOid === head) return head;
    for (const pr of this.prs.values()) {
      if (pr.repo.fullName !== repo) continue;
      const base = pr.bases.get(head);
      if (base) return base;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Derived PR state (what GitHub computes)

  rollup(pr: FakePr, oid = this.head(pr)): CheckState {
    const contexts = pr.checks.get(oid);
    if (!contexts || contexts.length === 0) return "none";
    if (contexts.some((c) => c.state === "failure")) return "failure";
    if (contexts.some((c) => c.state === "pending")) return "pending";
    return "success";
  }

  /** Each reviewer's latest approval or change request; comments don't change an opinion. */
  latestOpinions(pr: FakePr): FakeReview[] {
    const latest = new Map<string, FakeReview>();
    for (const review of pr.reviews) {
      if (review.state === "APPROVED" || review.state === "CHANGES_REQUESTED")
        latest.set(review.author, review);
      else if (review.state === "DISMISSED" && latest.get(review.author)?.id === review.id)
        latest.delete(review.author);
    }
    return [...latest.values()];
  }

  reviewDecision(pr: FakePr): ReviewDecision {
    if (pr.repo.requiredApprovals === 0) return null;
    const opinions = this.latestOpinions(pr);
    if (opinions.some((r) => r.state === "CHANGES_REQUESTED")) return "changes_requested";
    const approvals = opinions.filter((r) => r.state === "APPROVED").length;
    return approvals >= pr.repo.requiredApprovals ? "approved" : "review_required";
  }

  mergeStateStatus(pr: FakePr): string {
    if (pr.state !== "OPEN") return "UNKNOWN";
    if (pr.mergeable === "conflicting") return "DIRTY";
    if (pr.mergeable === "unknown") return "UNKNOWN";
    if (pr.isDraft) return "DRAFT";
    const decision = this.reviewDecision(pr);
    const rollup = this.rollup(pr);
    if (decision === "review_required" || decision === "changes_requested") return "BLOCKED";
    if (rollup === "pending") return "BLOCKED";
    if (rollup === "failure") return "UNSTABLE";
    return "CLEAN";
  }

  involves(pr: FakePr, login: string): boolean {
    return (
      pr.author === login ||
      pr.mentions.has(login) ||
      pr.comments.some((c) => c.author === login) ||
      pr.reviews.some((r) => r.author === login && r.state !== "PENDING") ||
      pr.threads.some((t) => t.comments.some((c) => c.author === login))
    );
  }

  reviewRequested(pr: FakePr, login: string): boolean {
    return [...pr.requested].some(
      (who) => who === login || (this.teams.get(who)?.has(login) ?? false),
    );
  }

  reviewedBy(pr: FakePr, login: string): boolean {
    return pr.reviews.some((r) => r.author === login && r.state !== "PENDING");
  }

  // -------------------------------------------------------------------------
  // Scenario helpers: things people and bots do

  openPr(input: OpenPrInput): FakePr {
    const repo = this.repos.get(input.repo);
    if (!repo) throw new Error(`no repo ${input.repo}`);
    this.addUser(input.author);
    const at = input.createdAt ?? this.now();
    const number = this.nextNumber.get(repo.fullName) ?? 1;
    this.nextNumber.set(repo.fullName, number + 1);
    const pr: FakePr = {
      id: this.nodeId("PR"),
      number,
      repo,
      title: input.title,
      body: input.body ?? "",
      author: input.author,
      state: "OPEN",
      isDraft: input.isDraft ?? false,
      createdAt: this.iso(at),
      updatedAt: this.iso(at),
      baseRefName: input.baseRefName ?? repo.defaultBranch,
      headRefName: input.headRefName,
      baseRefOid: repo.headOid,
      commits: [],
      files: [],
      mergeable: input.mergeable ?? "mergeable",
      labels: input.labels ?? [],
      assignees: [],
      milestone: null,
      checks: new Map(),
      reviews: [],
      threads: [],
      comments: [],
      events: [],
      requested: new Set(),
      viewed: new Map(),
      mentions: new Set(),
      reactions: new Map(),
      locked: null,
      queuePosition: null,
      autoMerge: null,
      bases: new Map(),
      bumps: input.bumps ?? [],
    };
    this.prs.set(pr.id, pr);
    this.byNumber.set(`${repo.fullName}#${number}`, pr);
    for (const label of pr.labels) {
      if (!repo.labels.has(label.name))
        repo.labels.set(label.name, { color: label.color, description: null });
    }

    const baseTree = this.tree(repo.fullName, pr.baseRefOid);
    for (const change of input.files) {
      if ("after" in change && change.before !== undefined && change.before !== null)
        baseTree.set(change.previousPath ?? change.path, change.before);
    }
    const commits = input.commits ?? [{ message: input.title }];
    for (const [i, commit] of commits.entries()) {
      this.addCommit(pr, commit, at, i === commits.length - 1 ? input.files : []);
    }
    if (input.checks !== undefined) this.setChecks(pr.id, input.checks);
    if (this.users.get(pr.author)?.isBot && repo.automergeOnApproval)
      pr.autoMerge = { enabledAt: pr.createdAt, method: "SQUASH" };
    this.touched(pr, pr.author, [pr.body]);
    pr.updatedAt = pr.createdAt;
    for (const reviewer of input.reviewers ?? []) this.requestReview(pr.id, reviewer, pr.author);
    return pr;
  }

  /** A new commit on top of the head. Returns its oid. */
  pushCommit(
    prId: string,
    input: CommitInput & { files?: FileChange[]; checks?: ChecksInput },
  ): string {
    const pr = this.mustPr(prId);
    const oid = this.addCommit(pr, input, this.now(), input.files ?? []);
    this.afterPush(pr, input.checks);
    return oid;
  }

  /** Commits whole files onto an open PR's branch (createCommitOnBranch), guarded on its head. */
  commitFiles(
    repo: string,
    branch: string,
    input: {
      expectedHeadOid: string;
      message: string;
      files: { path: string; contents: string }[];
    },
    by: string,
  ): string {
    const pr = this.prOnBranch(repo, branch);
    if (!pr || pr.state !== "OPEN")
      throw graphqlError(`Could not resolve to a branch named '${branch}'`);
    if (!this.canWrite(pr.repo, by))
      throw graphqlError(`${by} does not have push access to ${repo}`);
    if (this.head(pr) !== input.expectedHeadOid) {
      throw graphqlError(
        `Expected branch to point to "${input.expectedHeadOid}" but it did not. Pull and try again.`,
      );
    }
    return this.pushCommit(pr.id, {
      message: input.message,
      author: by,
      // GitHub signs commits made through its API.
      signed: true,
      files: input.files.map((file) => ({ path: file.path, after: file.contents })),
    });
  }

  /** A branch's latest commit, if a PR in the repo has it as its head. */
  branchHead(
    repo: string,
    branch: string,
  ): { oid: string; parents: string[]; message: string } | null {
    const pr = this.prOnBranch(repo, branch);
    const head = pr?.commits.at(-1);
    if (!pr || !head) return null;
    const parent = this.parentOf(repo, head.oid);
    return { oid: head.oid, parents: parent ? [parent] : [], message: head.message };
  }

  private prOnBranch(repo: string, branch: string): FakePr | undefined {
    return [...this.prs.values()].find(
      (pr) => pr.repo.fullName === repo && pr.headRefName === branch,
    );
  }

  /** Rewrites the head commit (amend and force-push). Returns the new head. */
  forcePush(
    prId: string,
    input: Partial<CommitInput> & { actor?: string; files?: FileChange[]; checks?: ChecksInput },
  ): string {
    const pr = this.mustPr(prId);
    const before = this.head(pr);
    const replaced = pr.commits.pop();
    const oid = this.addCommit(
      pr,
      { ...input, message: input.message ?? replaced?.message ?? pr.title },
      this.now(),
      input.files ?? [],
    );
    pr.events.push({
      kind: "force-push",
      before,
      after: oid,
      actor: input.actor ?? input.author ?? pr.author,
      at: this.iso(),
    });
    this.afterPush(pr, input.checks);
    return oid;
  }

  /** Reports checks on a commit (the head by default) as one workflow run. */
  setChecks(prId: string, checks: ChecksInput, oid?: string): void {
    const pr = this.mustPr(prId);
    const target = oid ?? this.head(pr);
    if (checks === "none") {
      pr.checks.delete(target);
      return;
    }
    const contexts = typeof checks === "string" ? outcomes(pr.repo.checkNames, checks) : checks;
    const runId = this.nextRunId++;
    const now = this.now();
    pr.checks.set(
      target,
      contexts.map((context) => ({
        ...context,
        id: this.nextJobId++,
        runId,
        startedAt: this.iso(context.state === "pending" ? now : now - this.options.ciDurationMs),
        completedAt: context.state === "pending" ? null : this.iso(now),
      })),
    );
  }

  /** Starts CI on the head: pending now, `outcome` once it finishes (unless the head moved). */
  runChecks(prId: string, outcome: "success" | "failure", durationMs = this.options.ciDurationMs) {
    const pr = this.mustPr(prId);
    const oid = this.head(pr);
    this.setChecks(
      prId,
      pr.repo.checkNames.map((name) => ({ name, state: "pending" })),
    );
    const runs = pr.checks.get(oid) ?? [];
    const final = outcomes(
      runs.map((r) => r.name),
      outcome,
    );
    this.schedule(durationMs, () => {
      if (this.head(pr) !== oid || pr.state !== "OPEN") return;
      for (const [i, run] of runs.entries()) this.finish(run, final[i]?.state ?? outcome);
    });
  }

  /** Check runs reported on a commit, whichever PR it is (or was) the head of. */
  checksAt(repo: string, oid: string): FakeCheckRun[] {
    for (const pr of this.prs.values()) {
      const runs = pr.repo.fullName === repo ? pr.checks.get(oid) : undefined;
      if (runs) return runs;
    }
    return [];
  }

  /** Finds the PR and commit a check run (by its job id, or its workflow run id) belongs to. */
  checkRun(repo: string, match: (run: FakeCheckRun) => boolean) {
    for (const pr of this.prs.values()) {
      if (pr.repo.fullName !== repo) continue;
      for (const [oid, runs] of pr.checks) {
        const run = runs.find(match);
        if (run) return { pr, oid, runs, run };
      }
    }
    return null;
  }

  /**
   * Re-runs a workflow run's failed jobs, all its jobs, or one job: each goes pending as a new
   * attempt, then finishes as `rerunOutcome` says.
   */
  rerun(
    repo: string,
    by: string,
    target: { runId: number; only: "failed" | "all" } | { jobId: number },
  ): void {
    const found = this.checkRun(repo, (run) =>
      "jobId" in target ? run.id === target.jobId : run.runId === target.runId,
    );
    if (!found || this.permission(found.pr.repo, by) === null)
      throw new GitHubError("404 Not Found", "not-found", 404);
    if (!this.canWrite(found.pr.repo, by))
      throw new GitHubError("403 Must have admin rights to Repository.", "forbidden", 403);
    const jobs =
      "jobId" in target
        ? [found.run]
        : found.runs.filter(
            (run) =>
              run.runId === target.runId && (target.only === "all" || run.state === "failure"),
          );
    if (jobs.length === 0 || jobs.some((job) => job.state === "pending"))
      throw new GitHubError("403 This workflow run cannot be retried", "forbidden", 403);
    this.reruns.push({ repo, runId: found.run.runId, by, at: this.iso() });
    for (const run of jobs) {
      // A re-run is a new attempt: new jobs, same workflow run.
      run.id = this.nextJobId++;
      run.state = "pending";
      run.startedAt = this.iso();
      run.completedAt = null;
    }
    this.schedule(this.options.ciDurationMs, () => {
      for (const run of jobs)
        if (run.state === "pending") this.finish(run, this.options.rerunOutcome);
    });
  }

  rerunFailedJobs(repo: string, runId: number, by: string): void {
    this.rerun(repo, by, { runId, only: "failed" });
  }

  /** Cancelling stops the run's unfinished jobs, which then report as failed. */
  cancelRun(repo: string, runId: number, by: string): void {
    const found = this.checkRun(repo, (run) => run.runId === runId);
    if (!found || !this.canWrite(found.pr.repo, by))
      throw new GitHubError("404 Not Found", "not-found", 404);
    const running = found.runs.filter((run) => run.runId === runId && run.state === "pending");
    if (running.length === 0)
      throw new GitHubError("409 Cannot cancel a workflow run that is completed.", "conflict", 409);
    for (const run of running) this.finish(run, "failure");
  }

  merge(prId: string, actor: string): void {
    const pr = this.mustPr(prId);
    if (pr.state !== "OPEN") throw new Error(`${pr.repo.fullName}#${pr.number} is not open`);
    pr.state = "MERGED";
    pr.autoMerge = null;
    pr.requested.clear();
    pr.updatedAt = this.iso();
    pr.events.push({ kind: "event", text: "merged this", actor, at: pr.updatedAt });
    pr.repo.headOid = this.oid();
    this.notify(pr, actor, this.subscribers(pr, "state_change"));
    this.rebaseSiblings(pr);
  }

  /** The async merge API: checks the request now, merges a moment later if the head holds. */
  requestMerge(
    prId: string,
    by: string,
    input: { sha: string; method: MergeMethod; action?: "direct_merge" | "merge_queue" },
  ): { status: "pending" | "enqueued"; message: string; uuid: string } {
    const pr = this.mustPr(prId);
    if (!this.canWrite(pr.repo, by))
      throw new GitHubError("403 Resource not accessible by integration", "forbidden", 403);
    if (pr.state !== "OPEN")
      throw new GitHubError("405 Pull Request is not open", "validation", 405);
    if (this.head(pr) !== input.sha)
      throw new GitHubError("409 Head branch was modified. Review and try again.", "conflict", 409);
    if (!pr.repo.mergeMethods.includes(input.method)) {
      const name = input.method.toLowerCase();
      throw new GitHubError(
        `405 ${name} merges are not allowed on this repository.`,
        "validation",
        405,
      );
    }
    // An admin merging directly goes past the rules (not past conflicts); a queue takes it in turn.
    const bypass = input.action === "direct_merge" && this.permission(pr.repo, by) === "ADMIN";
    const blocked = this.mergeBlocker(pr);
    if (blocked && !(bypass && pr.mergeable !== "conflicting"))
      throw new GitHubError(`405 ${blocked}`, "validation", 405);

    const r = this.random;
    if (pr.repo.mergeQueue && input.action !== "direct_merge") {
      this.enqueue(prId, by, input.sha, false);
      return {
        status: "enqueued",
        message: "Added to the merge queue",
        uuid: `${r.hex(8)}-queued`,
      };
    }
    const uuid = `${r.hex(8)}-${r.hex(4)}-4${r.hex(3)}-a${r.hex(3)}-${r.hex(12)}`;
    const request = { prId, status: "pending" as const, message: "Merge request accepted" };
    this.mergeRequests.set(uuid, request);
    this.schedule(this.options.mergeDelayMs, () => {
      const landed = pr.state === "OPEN" && this.head(pr) === input.sha;
      if (landed) {
        // Merging a stacked PR merges every PR below it first, all together.
        const stack = this.stackOf(pr);
        const below = stack ? stack.prIds.slice(0, stack.prIds.indexOf(pr.id)) : [];
        for (const id of below) if (this.prs.get(id)?.state === "OPEN") this.merge(id, by);
        this.merge(pr.id, by);
      }
      this.mergeRequests.set(uuid, {
        prId,
        status: landed ? "merged" : "failed",
        message: landed ? "Pull Request successfully merged" : "Head branch was modified",
      });
    });
    return { ...request, uuid };
  }

  enqueue(prId: string, by: string, headOid: string, jump: boolean): void {
    const pr = this.mustPr(prId);
    if (!pr.repo.mergeQueue) throw graphqlError("Merge queue is not enabled for this branch");
    if (!this.canWrite(pr.repo, by)) throw graphqlError(`${by} cannot add to the merge queue`);
    if (this.head(pr) !== headOid) throw graphqlError("Head ref has changed");
    const queue = [...this.prs.values()].filter(
      (p) => p.repo === pr.repo && p.queuePosition !== null,
    );
    if (jump) for (const other of queue) other.queuePosition = (other.queuePosition ?? 0) + 1;
    pr.queuePosition = jump ? 1 : queue.length + 1;
    pr.events.push({
      kind: "event",
      text: "added this to the merge queue",
      actor: by,
      at: this.iso(),
    });
  }

  dequeue(prId: string, by: string): void {
    const pr = this.mustPr(prId);
    if (pr.queuePosition === null) throw graphqlError("Pull request is not in the merge queue");
    const removed = pr.queuePosition;
    pr.queuePosition = null;
    for (const other of this.prs.values())
      if (other.repo === pr.repo && (other.queuePosition ?? 0) > removed)
        other.queuePosition = (other.queuePosition ?? 1) - 1;
    pr.events.push({
      kind: "event",
      text: "removed this from the merge queue",
      actor: by,
      at: this.iso(),
    });
  }

  deleteBranch(repo: string, branch: string, by: string): void {
    const found = this.repos.get(repo);
    if (!found || !this.canWrite(found, by))
      throw new GitHubError("404 Not Found", "not-found", 404);
    if (found.deletedBranches.has(branch))
      throw new GitHubError("422 Reference does not exist", "validation", 422);
    found.deletedBranches.add(branch);
  }

  restoreBranch(repo: string, branch: string, by: string): void {
    const found = this.repos.get(repo);
    if (!found || !this.canWrite(found, by))
      throw new GitHubError("404 Not Found", "not-found", 404);
    if (!found.deletedBranches.delete(branch))
      throw new GitHubError("422 Reference already exists", "validation", 422);
  }

  /** Opens a PR that takes a merged one back out, as GitHub's "Revert" does. */
  revert(prId: string, by: string, title?: string, body?: string): FakePr {
    const pr = this.mustPr(prId);
    if (pr.state !== "MERGED") throw graphqlError("Only merged pull requests can be reverted");
    if (!this.canWrite(pr.repo, by)) throw graphqlError(`${by} cannot revert this pull request`);
    return this.openPr({
      repo: pr.repo.fullName,
      author: by,
      title: title ?? `Revert "${pr.title}"`,
      body: body ?? `Reverts ${pr.repo.fullName}#${pr.number}`,
      headRefName: `revert-${pr.number}-${pr.headRefName}`,
      files: pr.files.map((f) => ({ path: f.path, patch: f.patch ?? "" })),
    });
  }

  setAutoMerge(prId: string, by: string, method: MergeMethod | null, headOid: string): void {
    const pr = this.mustPr(prId);
    if (!this.canWrite(pr.repo, by))
      throw graphqlError(`${by} does not have permission to change auto-merge`);
    if (method === null) {
      pr.autoMerge = null;
      return;
    }
    if (!pr.repo.autoMergeAllowed)
      throw graphqlError("Auto merge is not allowed for this repository");
    if (pr.state !== "OPEN") throw graphqlError("Pull request is not open");
    if (this.head(pr) !== headOid)
      throw graphqlError("The expected head OID did not match the head of the pull request");
    // GitHub only arms auto-merge on PRs that can't merge right now.
    if (this.mergeStateStatus(pr) === "CLEAN")
      throw graphqlError("Pull request is in clean status");
    pr.autoMerge = { enabledAt: this.iso(), method };
    this.schedule(this.options.automergeDelayMs, () => this.automerge(pr, headOid));
  }

  /** "Update branch": bring the base in by a merge commit, or rebase onto it. */
  updateBranch(prId: string, by: string, rebase: boolean, headOid: string): void {
    const pr = this.mustPr(prId);
    if (!this.canWrite(pr.repo, by) && pr.author !== by)
      throw graphqlError(`${by} does not have permission to update this branch`);
    if (pr.state !== "OPEN") throw graphqlError("Pull request is not open");
    if (this.head(pr) !== headOid)
      throw graphqlError("The expected head OID did not match the head of the pull request");
    if (pr.baseRefOid === pr.repo.headOid)
      throw graphqlError("There are no new commits on the base branch.");
    if (pr.mergeable === "conflicting")
      throw graphqlError("Cannot update this branch: it conflicts with the base branch");
    const before = this.head(pr);
    pr.baseRefOid = pr.repo.headOid;
    if (rebase) {
      const tree = this.trees.get(`${pr.repo.fullName}@${before}`);
      pr.commits = pr.commits.map((commit) => {
        const oid = this.oid();
        pr.bases.set(oid, pr.baseRefOid);
        return { ...commit, oid, committedDate: this.iso() };
      });
      const after = this.head(pr);
      if (tree) this.trees.set(`${pr.repo.fullName}@${after}`, new Map(tree));
      pr.events.push({ kind: "force-push", before, after, actor: by, at: this.iso() });
      this.afterPush(pr, undefined);
    } else {
      this.pushCommit(pr.id, {
        author: by,
        message: `Merge branch '${pr.baseRefName}' into ${pr.headRefName}`,
      });
    }
  }

  /** Why the merge API would refuse this PR right now, or null if it would merge. */
  mergeBlocker(pr: FakePr): string | null {
    switch (this.mergeStateStatus(pr)) {
      case "DIRTY":
        return "Pull Request has merge conflicts.";
      case "DRAFT":
        return "Pull Request is still a draft.";
      case "UNKNOWN":
        return "Pull Request mergeability is still being computed.";
      case "BLOCKED": {
        const decision = this.reviewDecision(pr);
        if (decision === "changes_requested") return "Changes have been requested.";
        if (decision === "review_required")
          return `At least ${pr.repo.requiredApprovals} approving review is required by reviewers with write access.`;
        return "Required status checks are still pending.";
      }
      default:
        return null;
    }
  }

  close(prId: string, actor: string): void {
    const pr = this.mustPr(prId);
    if (pr.state !== "OPEN") return;
    pr.state = "CLOSED";
    pr.autoMerge = null;
    pr.updatedAt = this.iso();
    pr.events.push({ kind: "event", text: "closed this", actor, at: pr.updatedAt });
    this.notify(pr, actor, this.subscribers(pr, "state_change"));
  }

  reopen(prId: string, actor: string): void {
    const pr = this.mustPr(prId);
    if (pr.state === "MERGED") throw graphqlError("Could not reopen a merged pull request");
    if (pr.state === "OPEN") return;
    pr.state = "OPEN";
    pr.updatedAt = this.iso();
    pr.events.push({ kind: "event", text: "reopened this", actor, at: pr.updatedAt });
  }

  setDraft(prId: string, actor: string, draft: boolean): void {
    const pr = this.mustPr(prId);
    if (!this.canWrite(pr.repo, actor) && pr.author !== actor)
      throw graphqlError(`${actor} does not have permission to update this pull request`);
    if (pr.isDraft === draft) return;
    pr.isDraft = draft;
    pr.updatedAt = this.iso();
    const text = draft
      ? "marked this pull request as draft"
      : "marked this pull request as ready for review";
    pr.events.push({ kind: "event", text, actor, at: pr.updatedAt });
  }

  /** Labels by name, as the REST issue endpoints take them; unknown names join the catalogue. */
  editLabels(prId: string, actor: string, add: string[], remove: string[]): void {
    const pr = this.mustPr(prId);
    this.mustTriage(pr, actor);
    for (const name of add) {
      if (pr.labels.some((l) => l.name === name)) continue;
      const known = pr.repo.labels.get(name) ?? { color: "ededed", description: null };
      pr.repo.labels.set(name, known);
      pr.labels.push({ name, color: known.color });
      pr.events.push({ kind: "event", text: `added the ${name} label`, actor, at: this.iso() });
    }
    for (const name of remove) {
      if (!pr.labels.some((l) => l.name === name))
        throw new GitHubError("404 Label does not exist", "not-found", 404);
      pr.labels = pr.labels.filter((l) => l.name !== name);
      pr.events.push({ kind: "event", text: `removed the ${name} label`, actor, at: this.iso() });
    }
    pr.updatedAt = this.iso();
  }

  /** Like GitHub, logins that can't be assigned are skipped rather than refused. */
  editAssignees(prId: string, actor: string, add: string[], remove: string[]): void {
    const pr = this.mustPr(prId);
    this.mustTriage(pr, actor);
    const assignable = add.filter((login) => this.canWrite(pr.repo, login));
    const at = this.iso();
    for (const login of remove.filter((a) => pr.assignees.includes(a))) {
      const text = login === actor ? "removed their assignment" : `unassigned ${login}`;
      pr.events.push({ kind: "event", text, actor, at });
    }
    for (const login of assignable.filter((a) => !pr.assignees.includes(a))) {
      const text = login === actor ? "self-assigned this" : `assigned ${login}`;
      pr.events.push({ kind: "event", text, actor, at });
    }
    pr.assignees = [...pr.assignees.filter((a) => !remove.includes(a)), ...assignable]
      .filter((login, i, all) => all.indexOf(login) === i)
      .slice(0, 10);
    pr.updatedAt = at;
  }

  removeReviewRequests(prId: string, actor: string, reviewers: string[]): void {
    const pr = this.mustPr(prId);
    this.mustTriage(pr, actor);
    for (const reviewer of reviewers) {
      if (!pr.requested.delete(reviewer)) continue;
      const name = reviewer.split("/").at(-1) ?? reviewer;
      pr.events.push({
        kind: "event",
        text: `removed the review request for ${name}`,
        actor,
        at: this.iso(),
      });
    }
    pr.updatedAt = this.iso();
  }

  requestReviews(prId: string, actor: string, reviewers: string[]): void {
    const pr = this.mustPr(prId);
    this.mustTriage(pr, actor);
    if (reviewers.includes(pr.author))
      throw new GitHubError(
        "422 Review cannot be requested from pull request author.",
        "validation",
        422,
      );
    for (const reviewer of reviewers) {
      // Bots are asked by login ("bot:copilot-pull-request-reviewer").
      const login = reviewer.startsWith("bot:") ? reviewer.slice(4) : reviewer;
      if (reviewer.startsWith("bot:") && !this.users.has(login))
        this.addUser(login, { isBot: true });
      this.requestReview(prId, login, actor);
    }
  }

  setMilestone(prId: string, actor: string, milestone: number | null): void {
    const pr = this.mustPr(prId);
    this.mustTriage(pr, actor);
    if (milestone !== null && !pr.repo.milestones.some((m) => m.number === milestone))
      throw new GitHubError("422 Validation Failed", "validation", 422);
    const title = (number: number | null) =>
      pr.repo.milestones.find((m) => m.number === number)?.title;
    const text =
      milestone === null
        ? `removed this from ${title(pr.milestone) ?? "its milestone"}`
        : `added this to ${title(milestone)}`;
    if (milestone !== pr.milestone) pr.events.push({ kind: "event", text, actor, at: this.iso() });
    pr.milestone = milestone;
    pr.updatedAt = this.iso();
  }

  // -------------------------------------------------------------------------
  // Writing: reactions, edits, deletes, hiding, and the conversation around them

  /** A comment, review or PR description by node id, with the PR it's on. */
  writing(id: string): FoundWriting | null {
    for (const pr of this.prs.values()) {
      if (pr.id === id) return { pr, subject: "pull-request", target: pr };
      const comment = pr.comments.find((c) => c.id === id);
      if (comment) return { pr, subject: "issue-comment", target: comment };
      const review = pr.reviews.find((r) => r.id === id);
      if (review) return { pr, subject: "review", target: review };
      for (const thread of pr.threads) {
        const inThread = thread.comments.find((c) => c.id === id);
        if (inThread) return { pr, subject: "review-comment", target: inThread };
      }
    }
    return null;
  }

  /** Its author, or anyone who can write to the repo (GitHub lets maintainers edit comments). */
  canEditWriting(pr: FakePr, author: string, login: string): boolean {
    return author === login || this.canWrite(pr.repo, login);
  }

  react(subjectId: string, login: string, content: ReactionContent, on: boolean): void {
    const found = this.mustWriting(subjectId, login);
    if (found.pr.locked && !this.canWrite(found.pr.repo, login))
      throw graphqlError("Unable to react: the conversation is locked");
    const reactions = found.target.reactions;
    const who = reactions.get(content) ?? new Set<string>();
    if (on) who.add(login);
    else who.delete(login);
    reactions.set(content, who);
  }

  editWriting(subjectId: string, login: string, body: string): void {
    const found = this.mustWriting(subjectId, login);
    if (!this.canEditWriting(found.pr, found.target.author, login))
      throw graphqlError(`${login} does not have permission to update this`);
    if (found.subject !== "pull-request") {
      const { target } = found;
      // GitHub starts the history with the original once something is first edited.
      if (target.history.length === 0)
        target.history.push({
          editedAt: target.editedAt ?? this.iso(),
          editor: target.author,
          body: target.body,
        });
      target.history.unshift({ editedAt: this.iso(), editor: login, body });
      target.editedAt = this.iso();
    }
    found.target.body = body;
    found.pr.updatedAt = this.iso();
  }

  deleteComment(subjectId: string, login: string): void {
    const found = this.mustWriting(subjectId, login);
    if (found.subject !== "issue-comment" && found.subject !== "review-comment")
      throw graphqlError("Only comments can be deleted");
    if (!this.canEditWriting(found.pr, found.target.author, login))
      throw graphqlError(`${login} does not have permission to delete this comment`);
    const { pr } = found;
    pr.comments = pr.comments.filter((c) => c.id !== subjectId);
    for (const thread of pr.threads)
      thread.comments = thread.comments.filter((c) => c.id !== subjectId);
    pr.threads = pr.threads.filter((t) => t.comments.length > 0);
    pr.updatedAt = this.iso();
  }

  minimize(subjectId: string, login: string, reason: MinimizeReason | null): void {
    const found = this.mustWriting(subjectId, login);
    if (found.subject !== "issue-comment" && found.subject !== "review-comment")
      throw graphqlError("Only comments can be hidden");
    if (!this.canWrite(found.pr.repo, login))
      throw graphqlError(`${login} does not have permission to minimize this comment`);
    found.target.minimized = reason === null ? null : reason.toLowerCase().replaceAll("_", "-");
  }

  dismissReview(reviewId: string, login: string, message: string): void {
    const found = this.mustWriting(reviewId, login);
    if (found.subject !== "review" || !this.canWrite(found.pr.repo, login))
      throw graphqlError(`${login} does not have permission to dismiss this review`);
    const review = found.target;
    if (review.state !== "APPROVED" && review.state !== "CHANGES_REQUESTED")
      throw graphqlError("Can not dismiss a commented pull request review");
    review.state = "DISMISSED";
    const { pr } = found;
    pr.updatedAt = this.iso();
    pr.events.push({
      kind: "event",
      text: `dismissed ${review.author}'s review: ${message}`,
      actor: login,
      at: pr.updatedAt,
    });
  }

  setLocked(prId: string, login: string, reason: string | null): void {
    const pr = this.mustPr(prId);
    if (!this.canWrite(pr.repo, login))
      throw new GitHubError("403 Must have write access to lock", "forbidden", 403);
    pr.locked = reason;
    pr.updatedAt = this.iso();
    pr.events.push({
      kind: "event",
      text: reason ? `locked this as ${reason}` : "unlocked this conversation",
      actor: login,
      at: pr.updatedAt,
    });
  }

  editPr(
    prId: string,
    login: string,
    change: { title?: string; body?: string; base?: string },
  ): void {
    const pr = this.mustPr(prId);
    if (!this.canEditWriting(pr, pr.author, login))
      throw graphqlError(`${login} does not have permission to update this pull request`);
    const at = this.iso();
    if (change.title !== undefined && change.title !== pr.title) {
      pr.events.push({ kind: "event", text: `renamed this from "${pr.title}"`, actor: login, at });
      pr.title = change.title;
    }
    if (change.body !== undefined) pr.body = change.body;
    if (change.base !== undefined && change.base !== pr.baseRefName) {
      if (pr.state !== "OPEN")
        throw graphqlError("Cannot change the base of a closed pull request");
      pr.events.push({
        kind: "event",
        text: `changed the base branch from ${pr.baseRefName} to ${change.base}`,
        actor: login,
        at,
      });
      pr.baseRefName = change.base;
    }
    pr.updatedAt = at;
  }

  private mustWriting(id: string, login: string) {
    const found = this.writing(id);
    if (!found || this.permission(found.pr.repo, login) === null)
      throw graphqlError(`Could not resolve to a node with the global id of '${id}'`);
    return found;
  }

  private mustTriage(pr: FakePr, actor: string): void {
    const permission = this.permission(pr.repo, actor);
    if (permission === null || permission === "READ")
      throw new GitHubError("403 Resource not accessible by integration", "forbidden", 403);
  }

  comment(prId: string, author: string, body: string): FakeComment {
    const pr = this.mustPr(prId);
    if (this.permission(pr.repo, author) === null)
      throw graphqlError(`Could not resolve to a node with the global id of '${prId}'`);
    const comment = { id: this.nodeId("IC"), author, body, createdAt: this.iso(), ...unwritten() };
    pr.comments.push(comment);
    this.touched(pr, author, [body]);
    this.botCommand(pr, body);
    return comment;
  }

  /** Whether a reviewer (a login, or "org/slug") owns any of the PR's files under CODEOWNERS. */
  ownsAny(pr: FakePr, reviewer: string): boolean {
    if (!pr.repo.codeOwners) return false;
    const ownersOf = codeOwnersMatcher(parseCodeOwners(pr.repo.codeOwners));
    const name = `@${reviewer}`.toLowerCase();
    return pr.files.some((f) => ownersOf(f.path).some((owner) => owner.toLowerCase() === name));
  }

  requestReview(prId: string, reviewer: string, by?: string): void {
    const pr = this.mustPr(prId);
    pr.requested.add(reviewer);
    pr.updatedAt = this.iso();
    pr.events.push({
      kind: "event",
      text: `requested review from ${reviewer.split("/").at(-1) ?? reviewer}`,
      actor: by ?? pr.author,
      at: pr.updatedAt,
    });
    const people = this.teams.get(reviewer) ?? [reviewer];
    this.notify(
      pr,
      by ?? pr.author,
      new Map([...people].map((login) => [login, "review_requested"])),
    );
  }

  /** Submits (or, with "PENDING", starts) a review, with GitHub's validation. */
  review(prId: string, author: string, input: ReviewInput): FakeReview {
    const pr = this.mustPr(prId);
    const commitOid = input.commitOid ?? this.head(pr);
    this.validateReview(pr, author, input, commitOid);
    const review = this.addReview(pr, author, REVIEW_STATES[input.event], commitOid, input.body);
    for (const draft of input.threads ?? []) this.addThread(pr, review, draft);
    if (review.state !== "PENDING") this.submitted(pr, review);
    return review;
  }

  /** Adds a thread to your pending review, as `addPullRequestReviewThread` does. */
  addReviewThread(reviewId: string, author: string, draft: DraftThreadInput): void {
    const found = this.writing(reviewId);
    if (
      found?.subject !== "review" ||
      found.target.author !== author ||
      found.target.state !== "PENDING"
    )
      throw graphqlError(`Could not resolve to a node with the global id of '${reviewId}'`);
    this.validateThread(found.pr, draft);
    this.addThread(found.pr, found.target, draft);
  }

  /** Submits your pending review, as `submitPullRequestReview` does. */
  submitPendingReview(
    reviewId: string,
    author: string,
    event: ReviewEvent,
    body: string,
  ): FakeReview {
    const found = this.writing(reviewId);
    if (
      found?.subject !== "review" ||
      found.target.author !== author ||
      found.target.state !== "PENDING"
    )
      throw graphqlError(`Could not resolve to a node with the global id of '${reviewId}'`);
    const { pr, target: review } = found;
    if (event !== "COMMENT" && pr.author === author)
      throw graphqlError(
        event === "APPROVE"
          ? "Can not approve your own pull request"
          : "Can not request changes on your own pull request",
      );
    const threads = pr.threads.filter((t) => t.comments.some((c) => c.reviewId === review.id));
    if (event === "COMMENT" && !body.trim() && threads.length === 0)
      throw graphqlError("Review body can't be blank");
    review.state = REVIEW_STATES[event];
    review.body = body;
    review.submittedAt = this.iso();
    this.submitted(pr, review);
    return review;
  }

  /** A review just went out: the request is answered, people hear, and armed PRs can merge. */
  private submitted(pr: FakePr, review: FakeReview): void {
    pr.requested.delete(review.author);
    const threads = pr.threads.flatMap((t) => t.comments.filter((c) => c.reviewId === review.id));
    this.touched(pr, review.author, [review.body, ...threads.map((c) => c.body)]);
    const isBotPr = this.users.get(pr.author)?.isBot ?? false;
    const armed = pr.autoMerge !== null || (isBotPr && pr.repo.automergeOnApproval);
    if (review.state === "APPROVED" && armed)
      this.schedule(this.options.automergeDelayMs, () => this.automerge(pr, review.commitOid));
  }

  reply(threadId: string, author: string, body: string): FakeComment {
    const found = this.threadById(threadId);
    if (!found || this.permission(found.pr.repo, author) === null)
      throw graphqlError(`Could not resolve to a node with the global id of '${threadId}'`);
    const { pr, thread } = found;
    // GitHub files every reply under an empty "commented" review.
    const review = this.addReview(pr, author, "COMMENTED", this.head(pr), "");
    const comment = {
      id: this.nodeId("PRRC"),
      author,
      body,
      createdAt: this.iso(),
      reviewId: review.id,
      commitOid: review.commitOid,
      ...unwritten(),
    };
    thread.comments.push(comment);
    this.touched(pr, author, [body]);
    return comment;
  }

  setResolved(threadId: string, by: string, resolved: boolean): void {
    const found = this.threadById(threadId);
    if (!found)
      throw graphqlError(`Could not resolve to a node with the global id of '${threadId}'`);
    if (!this.canResolve(found.pr, by))
      throw graphqlError(`${by} does not have permission to resolve this thread`);
    found.thread.resolved = resolved;
    found.thread.resolvedBy = resolved ? by : null;
  }

  canResolve(pr: FakePr, login: string): boolean {
    return pr.author === login || this.canWrite(pr.repo, login);
  }

  setViewed(prId: string, login: string, path: string, viewed: boolean): void {
    const pr = this.mustPr(prId);
    const file = pr.files.find((f) => f.path === path);
    if (!file) throw graphqlError(`Could not find a file with path '${path}' in this pull request`);
    const marks = pr.viewed.get(login) ?? new Map<string, number>();
    if (viewed) marks.set(path, file.revision);
    else marks.delete(path);
    pr.viewed.set(login, marks);
  }

  viewedState(pr: FakePr, login: string, file: FakeFile): "VIEWED" | "UNVIEWED" | "DISMISSED" {
    const revision = pr.viewed.get(login)?.get(file.path);
    if (revision === undefined) return "UNVIEWED";
    return revision === file.revision ? "VIEWED" : "DISMISSED";
  }

  // -------------------------------------------------------------------------
  // Notifications

  /** Threads in the inbox, read or not, and a version that moves whenever the inbox does. */
  notifications(login: string): { version: number; threads: FakeNotification[] } {
    const threads = [...(this.notes.get(login)?.values() ?? [])].toSorted((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    return { version: this.noteVersions.get(login) ?? 0, threads };
  }

  /** Stacks PRs bottom to top, each on the one below's branch, as GitHub's stacks API does. */
  stack(repo: string, numbers: number[]): number {
    const prs = numbers.map((n) => this.prByNumber(repo, n));
    prs.forEach((pr, i) => {
      const below = prs[i - 1];
      if (!pr || (below && pr.baseRefName !== below.headRefName))
        throw new GitHubError("422 These pull requests can't form a stack", "validation", 422);
    });
    const owner = this.repos.get(repo);
    if (!owner) throw new Error(`no repo ${repo}`);
    const number = [...this.stacks.values()].filter((s) => s.repo === owner).length + 1;
    this.stacks.set(`${repo}#${number}`, {
      number,
      repo: owner,
      prIds: prs.flatMap((pr) => (pr ? [pr.id] : [])),
    });
    return number;
  }

  stackOf(pr: FakePr): { number: number; repo: FakeRepo; prIds: string[] } | undefined {
    return [...this.stacks.values()].find((s) => s.prIds.includes(pr.id));
  }

  /** Archiving closes a PR and marks it; unarchiving takes the mark off and leaves it closed. */
  setArchived(prId: string, archived: boolean, by: string): void {
    const pr = this.mustPr(prId);
    if (!this.canWrite(pr.repo, by)) throw graphqlError(`${by} can't archive this pull request`);
    if (archived && pr.state === "OPEN") this.close(prId, by);
    pr.archived = archived;
  }

  /** Puts a PR on one of its repo's projects, or takes its item off. */
  setProject(prId: string, projectId: string, itemId: string | null, by: string): void {
    const pr = this.mustPr(prId);
    if (!this.canWrite(pr.repo, by)) throw graphqlError(`${by} can't change this PR's projects`);
    if (!pr.repo.projects.some((p) => p.id === projectId))
      throw graphqlError(`Could not resolve to a node with the global id of '${projectId}'`);
    const items = pr.projectItems ?? new Map<string, { itemId: string; status: string | null }>();
    if (itemId) items.delete(projectId);
    else if (!items.has(projectId))
      items.set(projectId, { itemId: this.nodeId("PVTI"), status: "Todo" });
    pr.projectItems = items;
  }

  /** Takes the unmerged PRs out of a stack; one with none left is gone. */
  unstack(repo: string, number: number): void {
    const stack = this.stacks.get(`${repo}#${number}`);
    if (!stack) throw new GitHubError("404 Not Found", "not-found", 404);
    stack.prIds = stack.prIds.filter((id) => this.prs.get(id)?.state === "MERGED");
    if (stack.prIds.length === 0) this.stacks.delete(`${repo}#${number}`);
  }

  subscribe(prId: string, login: string, state: Subscription): void {
    const pr = this.mustPr(prId);
    const states = this.subscriptions.get(pr.id) ?? new Map<string, Subscription>();
    states.set(login, state);
    this.subscriptions.set(pr.id, states);
  }

  markRead(login: string, threadId: string): void {
    for (const note of this.notes.get(login)?.values() ?? []) {
      if (note.threadId !== threadId || !note.unread) continue;
      note.unread = false;
      this.noteVersions.set(login, (this.noteVersions.get(login) ?? 0) + 1);
    }
  }

  markDone(login: string, threadId: string): void {
    const notes = this.notes.get(login);
    for (const [prId, note] of notes ?? []) {
      if (note.threadId !== threadId) continue;
      notes?.delete(prId);
      this.noteVersions.set(login, (this.noteVersions.get(login) ?? 0) + 1);
    }
  }

  // -------------------------------------------------------------------------
  // Faults

  takeFault(account: string, method: FaultMethod): Fault | null {
    const index = this.faults.findIndex(
      (f) => f.method === method && (f.account === undefined || f.account === account),
    );
    const fault = this.faults[index];
    if (!fault) return null;
    const left = (fault.times ?? 1) - 1;
    if (left <= 0) this.faults.splice(index, 1);
    else this.faults[index] = { ...fault, times: left };
    return fault;
  }

  // -------------------------------------------------------------------------

  /** Per-file diffs between two commits' trees, for commit-range views. */
  compare(repo: string, base: string, head: string): DiffFile[] {
    const before = this.trees.get(`${repo}@${base}`) ?? new Map<string, string>();
    const after = this.trees.get(`${repo}@${head}`) ?? new Map<string, string>();
    const paths = [...new Set([...before.keys(), ...after.keys()])].toSorted();
    return paths.flatMap((path): DiffFile[] => {
      const old = before.get(path);
      const now = after.get(path);
      if (old === now) return [];
      const { patch, additions, deletions } = unifiedDiff(old ?? "", now ?? "");
      const status = old === undefined ? "added" : now === undefined ? "removed" : "modified";
      return [{ path, previousPath: null, status, additions, deletions, patch }];
    });
  }

  /** The commit before this one in its PR, or the PR's base for the first. */
  parentOf(repo: string, oid: string): string | null {
    for (const pr of this.prs.values()) {
      if (pr.repo.fullName !== repo) continue;
      const index = pr.commits.findIndex((c) => c.oid === oid);
      if (index === -1) continue;
      return index === 0
        ? (pr.bases.get(oid) ?? pr.baseRefOid)
        : (pr.commits[index - 1]?.oid ?? null);
    }
    return null;
  }

  private mustPr(id: string): FakePr {
    const pr = this.prs.get(id);
    if (!pr) throw graphqlError(`Could not resolve to a node with the global id of '${id}'`);
    return pr;
  }

  private tree(repo: string, oid: string): Map<string, string> {
    const key = `${repo}@${oid}`;
    const existing = this.trees.get(key);
    if (existing) return existing;
    const tree = new Map<string, string>();
    this.trees.set(key, tree);
    return tree;
  }

  private addCommit(pr: FakePr, input: CommitInput, at: number, files: FileChange[]): string {
    const login = input.author ?? pr.author;
    const user = this.addUser(login);
    const oid = this.oid();
    const previous = this.head(pr);
    pr.commits.push({
      oid,
      message: input.message,
      committedDate: this.iso(input.at ?? at),
      authorLogin: user.isBot ? null : login,
      authorName: user.isBot ? `${login}[bot]` : user.name,
      authorEmail: user.isBot
        ? `${user.databaseId}+${login}[bot]@users.noreply.github.com`
        : `${user.databaseId}+${login}@users.noreply.github.com`,
      signatureValid: input.signed === undefined ? (user.isBot ? true : null) : input.signed,
    });
    pr.bases.set(oid, pr.baseRefOid);
    const prior = this.trees.get(`${pr.repo.fullName}@${previous}`);
    if (prior) this.trees.set(`${pr.repo.fullName}@${oid}`, new Map(prior));
    this.applyFiles(pr, oid, files);
    return oid;
  }

  private applyFiles(pr: FakePr, oid: string, changes: FileChange[]): void {
    if (changes.length === 0) return;
    const base = this.tree(pr.repo.fullName, pr.baseRefOid);
    const head = this.tree(pr.repo.fullName, oid);
    for (const change of changes) {
      const existing = pr.files.find((f) => f.path === change.path);
      const before = head.get(change.path);
      const file = "patch" in change ? patchFile(change) : textFile(change, base, head);
      const after = head.get(change.path);
      file.revision = (existing?.revision ?? 0) + 1;
      pr.files = existing
        ? pr.files.map((f) => (f === existing ? file : f))
        : [...pr.files, file].toSorted((a, b) => a.path.localeCompare(b.path));
      // Threads on the new code follow their lines through the push, as GitHub's do, and go
      // outdated when the push changed those lines. Without both texts, every thread goes.
      if (existing) {
        for (const thread of pr.threads) {
          if (thread.path !== change.path || thread.side !== "RIGHT" || thread.line === null)
            continue;
          const shift = (line: number) =>
            before !== undefined && after !== undefined ? movedLine(before, after, line) : null;
          const line = shift(thread.line);
          const startLine = thread.startLine === null ? null : shift(thread.startLine);
          const moved = line !== null && (thread.startLine === null || startLine !== null);
          thread.line = moved ? line : null;
          thread.startLine = moved ? startLine : thread.startLine;
        }
      }
    }
  }

  private afterPush(pr: FakePr, checks: ChecksInput | undefined): void {
    pr.updatedAt = this.iso();
    if (pr.repo.dismissStaleReviews) {
      for (const review of pr.reviews) if (review.state === "APPROVED") review.state = "DISMISSED";
    }
    if (checks !== undefined) this.setChecks(pr.id, checks);
    else if (pr.repo.checkNames.length > 0) this.runChecks(pr.id, "success");
  }

  private finish(run: FakeCheckRun, state: CheckContext["state"]): void {
    run.state = state;
    run.completedAt = this.iso();
  }

  private validateReview(pr: FakePr, author: string, input: ReviewInput, commitOid: string) {
    if (this.permission(pr.repo, author) === null)
      throw graphqlError(`Could not resolve to a node with the global id of '${pr.id}'`);
    if (input.event === "APPROVE" || input.event === "REQUEST_CHANGES") {
      if (pr.state !== "OPEN") throw graphqlError(`Pull request is ${pr.state.toLowerCase()}`);
      if (pr.author === author) {
        throw graphqlError(
          input.event === "APPROVE"
            ? "Can not approve your own pull request"
            : "Can not request changes on your own pull request",
        );
      }
    }
    if (input.event === "REQUEST_CHANGES" && !input.body?.trim())
      throw graphqlError("Review body is required when requesting changes");
    if (input.event === "COMMENT" && !input.body?.trim() && !input.threads?.length)
      throw graphqlError("Review body can't be blank");
    if (!pr.bases.has(commitOid))
      throw graphqlError(`Commit ${commitOid} is not part of this pull request`);
    if (pr.reviews.some((r) => r.author === author && r.state === "PENDING"))
      throw graphqlError("User can only have one pending review per pull request");
    for (const draft of input.threads ?? []) this.validateThread(pr, draft);
  }

  /** GitHub only takes comments on lines that are part of the diff, or on a changed file. */
  private validateThread(pr: FakePr, draft: DraftThreadInput): void {
    if (draft.subject === "file") {
      if (!pr.files.some((f) => f.path === draft.path))
        throw graphqlError(`Path could not be resolved: ${draft.path}`);
      return;
    }
    const patch = pr.files.find((f) => f.path === draft.path)?.patch ?? null;
    const end = patch && diffHunkAt(patch, draft.side, draft.line);
    const start =
      draft.startLine === undefined ||
      (patch && diffHunkAt(patch, draft.startSide ?? draft.side, draft.startLine));
    if (!end || !start)
      throw graphqlError(`Line could not be resolved: ${draft.path}:${draft.line}`);
  }

  private addThread(pr: FakePr, review: FakeReview, draft: DraftThreadInput): void {
    const patch = pr.files.find((f) => f.path === draft.path)?.patch ?? "";
    const onLine = draft.subject === "line";
    const thread: FakeThread = {
      id: this.nodeId("PRRT"),
      subject: draft.subject,
      path: draft.path,
      side: onLine ? draft.side : "RIGHT",
      line: onLine ? draft.line : null,
      startLine: onLine ? (draft.startLine ?? null) : null,
      originalLine: onLine ? draft.line : 0,
      resolved: false,
      resolvedBy: null,
      diffHunk: onLine ? (diffHunkAt(patch, draft.side, draft.line) ?? "") : "",
      comments: [
        {
          id: this.nodeId("PRRC"),
          author: review.author,
          body: draft.body,
          createdAt: review.submittedAt ?? this.iso(),
          reviewId: review.id,
          commitOid: review.commitOid,
          ...unwritten(),
        },
      ],
    };
    pr.threads.push(thread);
    this.threadPrs.set(thread.id, pr);
  }

  private automerge(pr: FakePr, approvedOid: string): void {
    if (pr.state !== "OPEN" || this.head(pr) !== approvedOid || pr.mergeable === "conflicting")
      return;
    const decision = this.reviewDecision(pr);
    if (decision === "review_required" || decision === "changes_requested") return;
    const rollup = this.rollup(pr);
    if (rollup === "failure") return;
    // Like GitHub's auto-merge: keep waiting while required checks run.
    if (rollup === "pending") {
      this.schedule(this.options.automergeDelayMs, () => this.automerge(pr, approvedOid));
      return;
    }
    this.merge(pr.id, "github-actions");
  }

  /** After a merge, the bot rebases its other PRs that touch the same files. */
  private rebaseSiblings(merged: FakePr): void {
    const paths = new Set(merged.files.map((f) => f.path));
    for (const pr of this.prs.values()) {
      if (pr === merged || pr.repo !== merged.repo || pr.state !== "OPEN") continue;
      if (pr.author !== "dependabot" || !pr.files.some((f) => paths.has(f.path))) continue;
      this.schedule(this.options.botDelayMs, () => this.botRebase(pr, false));
    }
  }

  private botCommand(pr: FakePr, body: string): void {
    const command = /^@dependabot (rebase|recreate)\b/m.exec(body)?.[1];
    if (pr.author !== "dependabot" || !command) return;
    this.schedule(this.options.botDelayMs, () => this.botRebase(pr, command === "recreate"));
  }

  private botRebase(pr: FakePr, recreate: boolean): void {
    if (pr.state !== "OPEN") return;
    const edited = pr.commits.some((c) => c.authorName !== `${pr.author}[bot]`);
    if (edited && !recreate) {
      this.comment(
        pr.id,
        pr.author,
        "Looks like this PR has been edited by someone other than Dependabot. That means Dependabot can't rebase it - sorry!\n\nIf you're happy for Dependabot to recreate it from scratch, overwriting any edits, you can request `@dependabot recreate`.",
      );
      return;
    }
    const before = this.head(pr);
    const message = pr.commits.find((c) => c.authorName === `${pr.author}[bot]`)?.message;
    pr.commits = [];
    pr.baseRefOid = pr.repo.headOid;
    pr.mergeable = "mergeable";
    const after = this.addCommit(pr, { message: message ?? pr.title }, this.now(), []);
    pr.events.push({ kind: "force-push", before, after, actor: pr.author, at: this.iso() });
    this.afterPush(pr, undefined);
  }

  private addReview(
    pr: FakePr,
    author: string,
    state: ReviewState,
    commitOid: string,
    body = "",
  ): FakeReview {
    const review: FakeReview = {
      id: this.nodeId("PRR"),
      author,
      state,
      commitOid,
      body,
      submittedAt: state === "PENDING" ? null : this.iso(),
      ...unwritten(),
    };
    pr.reviews.push(review);
    return review;
  }

  /** Someone said something on a PR: it moves, mentions register, and subscribers hear of it. */
  private touched(pr: FakePr, actor: string, texts: string[]): void {
    pr.updatedAt = this.iso();
    for (const text of texts) {
      for (const match of text.matchAll(/(?:^|\s)@([a-zA-Z0-9-]+)(?![\w/-])/g)) {
        const login = match[1];
        if (login && this.users.has(login) && !this.users.get(login)?.isBot) pr.mentions.add(login);
      }
    }
    this.notify(pr, actor, this.subscribers(pr, "comment"));
  }

  private watchersOf(pr: FakePr): Map<string, string> {
    return new Map([...pr.repo.watchers].map((login) => [login, "subscribed"]));
  }

  /** Everyone subscribed to a PR, with the reason GitHub gives them. */
  private subscribers(pr: FakePr, reason: string): Map<string, string> {
    const out = this.watchersOf(pr);
    // A review request subscribes the reviewer (each member, for a team).
    for (const who of pr.requested) {
      for (const login of this.teams.get(who) ?? [who]) out.set(login, "review_requested");
    }
    const participants = [
      ...pr.comments.map((c) => c.author),
      ...pr.reviews.map((r) => r.author),
      ...pr.threads.flatMap((t) => t.comments.map((c) => c.author)),
    ];
    for (const login of participants) out.set(login, reason);
    for (const login of pr.mentions) out.set(login, "mention");
    out.set(pr.author, "author");
    return out;
  }

  private notify(pr: FakePr, actor: string, recipients: Map<string, string>): void {
    for (const [login, reason] of recipients) {
      const user = this.users.get(login);
      if (login === actor || !user || user.isBot || this.permission(pr.repo, login) === null)
        continue;
      // Muted means nothing about this PR reaches them.
      if (this.subscriptions.get(pr.id)?.get(login) === "IGNORED") continue;
      const key = `${login}|${pr.id}`;
      let threadId = this.noteIds.get(key);
      if (!threadId) {
        threadId = String(this.nextNoteId++);
        this.noteIds.set(key, threadId);
      }
      const notes = this.notes.get(login) ?? new Map<string, FakeNotification>();
      notes.set(pr.id, { threadId, prId: pr.id, reason, updatedAt: this.iso(), unread: true });
      this.notes.set(login, notes);
      this.noteVersions.set(login, (this.noteVersions.get(login) ?? 0) + 1);
    }
  }
}

/** Job states for a rollup: one job fails (or a few still run) and the rest went green. */
function outcomes(names: string[], state: CheckState): CheckContext[] {
  const odd = Math.min(1, names.length - 1);
  return names.map((name, i) => {
    if (state === "failure") return { name, state: i === odd ? "failure" : "success" };
    if (state === "pending") return { name, state: i >= odd ? "pending" : "success" };
    return { name, state: "success" };
  });
}

const REVIEW_STATES: Record<ReviewInput["event"], ReviewState> = {
  APPROVE: "APPROVED",
  REQUEST_CHANGES: "CHANGES_REQUESTED",
  COMMENT: "COMMENTED",
  PENDING: "PENDING",
};

/** GraphQL failures arrive as a 200 with an `errors` array, which the client maps to this. */
export function graphqlError(message: string): GitHubError {
  return new GitHubError(message, "graphql", 200);
}

export function faultError(fault: Fault): GitHubError {
  switch (fault.kind) {
    case "secondary-limit":
      return new GitHubError(
        "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
        "secondary-limit",
        403,
        fault.retryAfterMs ?? 60_000,
      );
    case "server":
      return new GitHubError("502 Bad Gateway", "server", 502);
    case "conflict":
      return new GitHubError(
        "409 Head branch was modified. Review and try again.",
        "conflict",
        409,
      );
    case "network":
    case "drop-response":
      return new GitHubError("network error: TypeError: fetch failed", "network", null);
    default:
      return new GitHubError(`unknown fault ${String(fault.kind)}`, "server", 500);
  }
}

function patchFile(change: { path: string; patch: string; status?: DiffFile["status"] }): FakeFile {
  const counted = countPatch(change.patch);
  return {
    path: change.path,
    previousPath: null,
    status: change.status ?? "modified",
    patch: change.patch,
    additions: counted.additions,
    deletions: counted.deletions,
    revision: 0,
  };
}

function textFile(
  change: { path: string; after: string | null; previousPath?: string },
  base: Map<string, string>,
  head: Map<string, string>,
): FakeFile {
  const before = base.get(change.previousPath ?? change.path) ?? null;
  if (change.previousPath) head.delete(change.previousPath);
  if (change.after === null) head.delete(change.path);
  else head.set(change.path, change.after);
  const diff = unifiedDiff(before ?? "", change.after ?? "");
  const status: DiffFile["status"] = change.previousPath
    ? "renamed"
    : before === null
      ? "added"
      : change.after === null
        ? "removed"
        : "modified";
  return {
    path: change.path,
    previousPath: change.previousPath ?? null,
    status,
    patch: diff.patch,
    additions: diff.additions,
    deletions: diff.deletions,
    revision: 0,
  };
}

function unwritten(): Writing {
  return { editedAt: null, history: [], minimized: null, reactions: new Map() };
}
