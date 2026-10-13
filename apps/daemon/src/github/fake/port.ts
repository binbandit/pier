import { GitHubError, type RateWindow } from "@/github/client";
import type {
  GitHubPort,
  MergeInfo,
  MergeResult,
  NotificationPoll,
  ReviewEvent,
  ReviewSummary,
  SearchHit,
  SubmitReviewInput,
} from "@/github/port";
import type { PrDetail } from "@/github/pr-detail";
import type { PrDoc, PrViewer, VolatileState } from "@/github/pr-doc";
import type {
  CheckLog,
  CheckRunView,
  DiffFile,
  Mergeable,
  MergeMethod,
  ReviewDecision,
  TimelineEntry,
} from "@pier/core/wire";

import { jobLogLines } from "./samples";
import { compileQuery } from "./search";
import {
  type FakePr,
  type FakeReview,
  type FakeWorld,
  type FaultMethod,
  faultError,
  graphqlError,
} from "./world";

// One account's view of the fake world, behind the same port the live client implements.
// Reads see only what this account can see, writes go through the world's GitHub rules, and
// every call counts against a rolling hourly window and can be failed by an injected fault.

type Resource = "graphql" | "core";

const HOUR_MS = 3_600_000;

const CHANGE_TYPES: Record<DiffFile["status"], string> = {
  added: "ADDED",
  removed: "DELETED",
  modified: "MODIFIED",
  renamed: "RENAMED",
  copied: "COPIED",
  changed: "CHANGED",
  unchanged: "CHANGED",
};

export class FakeGitHub implements GitHubPort {
  private readonly calls: Record<Resource, number[]> = { graphql: [], core: [] };
  /** The inbox version last handed out; the next poll is a free 304 until it moves. */
  private seenNotifications: number | null = null;

  constructor(
    private readonly world: FakeWorld,
    readonly login: string,
  ) {}

  rates() {
    return { graphql: this.window("graphql"), core: this.window("core") };
  }

  viewer() {
    return this.call("viewer", "graphql", () => ({
      login: this.login,
      avatarUrl: this.world.avatarUrl(this.login),
    }));
  }

  search(query: string): Promise<SearchHit[]> {
    return this.call(
      "search",
      "graphql",
      () => {
        const matches = compileQuery(query, this.login, this.world);
        return [...this.world.prs.values()]
          .filter((pr) => this.canSee(pr) && matches(pr))
          .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((pr) => ({
            id: pr.id,
            updatedAt: pr.updatedAt,
            headRefOid: this.world.head(pr),
            state: pr.state,
          }));
      },
      (hits) => pages(hits.length, 100),
    );
  }

  sweep(ids: string[]): Promise<VolatileState[]> {
    return this.call(
      "sweep",
      "graphql",
      () => this.visible(ids).map((pr) => this.volatile(pr)),
      () => pages(ids.length, 50),
    );
  }

  hydrate(ids: string[]): Promise<{ doc: PrDoc; viewer: PrViewer }[]> {
    return this.call(
      "hydrate",
      "graphql",
      () => this.visible(ids).map((pr) => ({ doc: this.doc(pr), viewer: this.viewerOf(pr) })),
      () => pages(ids.length, 25),
    );
  }

  files(repo: string, number: number): Promise<DiffFile[]> {
    return this.call(
      "files",
      "core",
      () =>
        this.restPr(repo, number).files.map((file) => ({
          path: file.path,
          previousPath: file.previousPath,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch,
        })),
      (files) => pages(files.length, 100),
    );
  }

  async notifications(fresh = false): Promise<NotificationPoll> {
    const result = await this.call(
      "notifications",
      "core",
      (): { version: number; poll: NotificationPoll } => {
        const { version, threads } = this.world.notifications(this.login);
        if (!fresh && version === this.seenNotifications)
          return { version, poll: { changed: false, pollIntervalSec: 60 } };
        const changed = threads.flatMap((note) => {
          const pr = this.world.pr(note.prId);
          if (!pr) return [];
          return [
            {
              id: note.threadId,
              reason: note.reason,
              unread: note.unread,
              updatedAt: note.updatedAt,
              repo: pr.repo.fullName,
              number: pr.number,
              type: "PullRequest",
            },
          ];
        });
        return { version, poll: { changed: true, pollIntervalSec: 60, threads: changed } };
      },
      // Conditional requests answered with 304 don't count against the rate limit.
      ({ poll }) => (poll.changed ? pages(poll.threads.length, 50) : 0),
    );
    // Only a response that arrived moves the validator, as with a real ETag cache.
    this.seenNotifications = result.version;
    return result.poll;
  }

  markNotificationDone(threadId: string): Promise<void> {
    return this.call("markNotificationDone", "core", () =>
      this.world.markDone(this.login, threadId),
    );
  }

  approve(prId: string, commitOid: string, body?: string): Promise<ReviewSummary> {
    return this.call("approve", "graphql", () =>
      this.submit(prId, commitOid, "APPROVE", body ?? "", []),
    );
  }

  comment(subjectId: string, body: string): Promise<{ id: string }> {
    return this.call("comment", "graphql", () => ({
      id: this.world.comment(this.visiblePr(subjectId).id, this.login, body).id,
    }));
  }

  reviewsBy(prId: string, author: string): Promise<ReviewSummary[]> {
    return this.call("reviewsBy", "graphql", () => {
      const pr = this.world.pr(prId);
      if (!pr || !this.canSee(pr)) return [];
      return pr.reviews
        .filter((r) => r.author.toLowerCase() === author.toLowerCase() && this.canRead(r))
        .slice(-20)
        .map(summary);
    });
  }

  detail(prId: string): Promise<PrDetail | null> {
    return this.call("detail", "graphql", () => {
      const pr = this.world.pr(prId);
      return pr && this.canSee(pr) ? this.detailOf(pr) : null;
    });
  }

  mergeBase(repo: string, _base: string, head: string): Promise<string | null> {
    return this.call("mergeBase", "core", () =>
      this.canSeeRepo(repo) ? this.world.mergeBase(repo, head) : null,
    );
  }

  fileText(repo: string, oid: string, path: string): Promise<string | null> {
    return this.call("fileText", "core", () =>
      this.canSeeRepo(repo) ? this.world.fileText(repo, oid, path) : null,
    );
  }

  submitReview(input: SubmitReviewInput): Promise<ReviewSummary> {
    return this.call("submitReview", "graphql", () =>
      this.submit(input.prId, input.commitOid, input.event, input.body, input.threads),
    );
  }

  reply(threadId: string, body: string): Promise<{ id: string }> {
    return this.call("reply", "graphql", () => ({
      id: this.world.reply(threadId, this.login, body).id,
    }));
  }

  setResolved(threadId: string, resolved: boolean): Promise<void> {
    return this.call("setResolved", "graphql", () =>
      this.world.setResolved(threadId, this.login, resolved),
    );
  }

  setViewed(prId: string, path: string, viewed: boolean): Promise<void> {
    return this.call("setViewed", "graphql", () =>
      this.world.setViewed(this.visiblePr(prId).id, this.login, path, viewed),
    );
  }

  recentComments(prId: string) {
    return this.call("recentComments", "graphql", () => {
      const pr = this.world.pr(prId);
      if (!pr || !this.canSee(pr)) return [];
      const threadComments = pr.threads
        .slice(-50)
        .flatMap((t) => t.comments.slice(-10).filter((c) => this.canReadComment(pr, c.reviewId)));
      return [...pr.comments.slice(-30), ...threadComments].map((c) => ({
        id: c.id,
        body: c.body,
        author: c.author,
      }));
    });
  }

  checkRuns(repo: string, oid: string): Promise<CheckRunView[]> {
    return this.call("checkRuns", "core", () => {
      if (!this.canSeeRepo(repo)) throw new GitHubError("404 Not Found", "not-found", 404);
      return this.world.checksAt(repo, oid).map((run) => ({
        id: run.id,
        name: run.name,
        state: run.state,
        jobId: run.id,
        runId: run.runId,
        url: jobUrl(repo, run.runId, run.id),
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      }));
    });
  }

  jobLog(repo: string, jobId: number): Promise<CheckLog | null> {
    return this.call("jobLog", "core", () => {
      const run = this.canSeeRepo(repo)
        ? this.world.checkRun(repo, (r) => r.id === jobId)?.run
        : null;
      // Logs of a job that is still running aren't served yet.
      if (!run || run.state === "pending") return null;
      const lines = jobLogLines(run.name, run.state === "failure");
      return {
        lines: lines.map((line) =>
          line.replace("##[error]", "").replace(/^##\[(group|endgroup|warning|notice)\]/, ""),
        ),
        errors: lines.flatMap((line, i) => (line.includes("##[error]") ? [i] : [])),
        url: jobUrl(repo, run.runId, run.id),
      };
    });
  }

  rerunFailedJobs(repo: string, runId: number): Promise<void> {
    return this.call("rerunFailedJobs", "core", () =>
      this.world.rerunFailedJobs(repo, runId, this.login),
    );
  }

  mergeInfo(prId: string): Promise<MergeInfo | null> {
    return this.call("mergeInfo", "graphql", () => {
      const pr = this.world.pr(prId);
      return pr && this.canSee(pr) ? this.mergeInfoOf(pr) : null;
    });
  }

  merge(
    repo: string,
    number: number,
    input: { sha: string; method: MergeMethod; title?: string; message?: string },
  ): Promise<MergeResult> {
    return this.call("merge", "core", () =>
      this.world.requestMerge(this.restPr(repo, number).id, this.login, input),
    );
  }

  mergeStatus(repo: string, number: number, uuid: string): Promise<MergeResult> {
    return this.call("mergeStatus", "core", () => {
      const pr = this.restPr(repo, number);
      const request = this.world.mergeRequests.get(uuid);
      if (!request || request.prId !== pr.id)
        throw new GitHubError("404 Not Found", "not-found", 404);
      return { status: request.status, message: request.message, uuid };
    });
  }

  setAutoMerge(prId: string, method: MergeMethod | null, headOid: string): Promise<void> {
    return this.call("setAutoMerge", "graphql", () =>
      this.world.setAutoMerge(this.visiblePr(prId).id, this.login, method, headOid),
    );
  }

  updateBranch(prId: string, rebase: boolean, headOid: string): Promise<void> {
    return this.call("updateBranch", "graphql", () =>
      this.world.updateBranch(this.visiblePr(prId).id, this.login, rebase, headOid),
    );
  }

  releaseDate(repo: string, tag: string): Promise<string | null> {
    return this.call("releaseDate", "core", () => {
      const releases = this.world.packages.get(`github-actions:${repo}`)?.releases;
      if (!releases) return null;
      const version = tag.replace(/^v/, "");
      const exact = releases.get(version);
      if (exact) return exact.publishedAt;
      // A moving major tag (`v5`) has no release of its own; it points at the newest 5.x.
      if (!/^\d+$/.test(version)) return null;
      const line = [...releases]
        .filter(([v]) => v.split(".")[0] === version)
        .toSorted(([, a], [, b]) => b.publishedAt.localeCompare(a.publishedAt));
      return line[0]?.[1].publishedAt ?? null;
    });
  }

  // -------------------------------------------------------------------------

  /**
   * Every call: simulated latency, due world events, the hourly budget, then any injected fault.
   * `requests` prices the call in API requests once its result is known.
   */
  private async call<T>(
    method: FaultMethod,
    resource: Resource,
    run: () => T,
    requests: (value: T) => number = () => 1,
  ): Promise<T> {
    if (this.world.options.latencyMs > 0) await Bun.sleep(this.world.options.latencyMs);
    this.world.tick();
    const window = this.window(resource);
    if (window && window.remaining <= 0) {
      throw new GitHubError(
        `API rate limit exceeded for user ${this.login}`,
        "rate-limit",
        403,
        Math.max(0, window.resetAt - this.world.now()),
      );
    }
    const fault = this.world.takeFault(this.login, method);
    if (fault && fault.kind !== "drop-response") {
      this.spend(resource, 1);
      throw faultError(fault);
    }
    const value = run();
    this.spend(resource, requests(value));
    // The write landed, but the answer never made it back.
    if (fault) throw faultError(fault);
    return value;
  }

  private spend(resource: Resource, count: number): void {
    const now = this.world.now();
    for (let i = 0; i < count; i++) this.calls[resource].push(now);
  }

  private window(resource: Resource): RateWindow | null {
    const now = this.world.now();
    const calls = this.calls[resource].filter((at) => at > now - HOUR_MS);
    this.calls[resource] = calls;
    const first = calls[0];
    if (first === undefined) return null;
    const limit = this.world.options.rateLimit;
    return {
      limit,
      used: calls.length,
      remaining: Math.max(0, limit - calls.length),
      resetAt: first + HOUR_MS,
    };
  }

  private canSee(pr: FakePr): boolean {
    return this.world.permission(pr.repo, this.login) !== null;
  }

  private canSeeRepo(fullName: string): boolean {
    const repo = this.world.repos.get(fullName);
    return repo !== undefined && this.world.permission(repo, this.login) !== null;
  }

  /** Someone else's pending review is invisible until they submit it. */
  private canRead(review: FakeReview): boolean {
    return review.state !== "PENDING" || review.author === this.login;
  }

  private canReadComment(pr: FakePr, reviewId: string): boolean {
    const review = pr.reviews.find((r) => r.id === reviewId);
    return !review || this.canRead(review);
  }

  private visible(ids: string[]): FakePr[] {
    return ids.flatMap((id) => {
      const pr = this.world.pr(id);
      return pr && this.canSee(pr) ? [pr] : [];
    });
  }

  private visiblePr(id: string): FakePr {
    const pr = this.world.pr(id);
    if (!pr || !this.canSee(pr))
      throw graphqlError(`Could not resolve to a node with the global id of '${id}'`);
    return pr;
  }

  private restPr(repo: string, number: number): FakePr {
    const pr = this.world.prByNumber(repo, number);
    if (!pr || !this.canSee(pr)) throw new GitHubError("404 Not Found", "not-found", 404);
    return pr;
  }

  private submit(
    prId: string,
    commitOid: string,
    event: ReviewEvent,
    body: string,
    threads: SubmitReviewInput["threads"],
  ): ReviewSummary {
    const pr = this.visiblePr(prId);
    return summary(this.world.review(pr.id, this.login, { event, body, commitOid, threads }));
  }

  private volatile(pr: FakePr): VolatileState {
    return {
      id: pr.id,
      state: pr.state,
      isDraft: pr.isDraft,
      updatedAt: pr.updatedAt,
      headRefOid: this.world.head(pr),
      mergeable: pr.mergeable,
      mergeStateStatus: this.world.mergeStateStatus(pr),
      reviewDecision: this.world.reviewDecision(pr),
      autoMerge: pr.autoMerge ? { enabledAt: pr.autoMerge.enabledAt } : null,
      mergeQueue: null,
      rollup: this.world.rollup(pr),
    };
  }

  private doc(pr: FakePr): PrDoc {
    const { world } = this;
    const contexts = pr.checks.get(world.head(pr)) ?? [];
    return {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      url: `https://github.com/${pr.repo.fullName}/pull/${pr.number}`,
      body: pr.body,
      state: pr.state,
      isDraft: pr.isDraft,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      repo: pr.repo.fullName,
      repoId: pr.repo.id,
      isPrivate: pr.repo.isPrivate,
      viewerPermission: world.permission(pr.repo, this.login),
      baseRefName: pr.baseRefName,
      headRefName: pr.headRefName,
      baseRefOid: pr.baseRefOid,
      headRefOid: world.head(pr),
      additions: pr.files.reduce((sum, f) => sum + f.additions, 0),
      deletions: pr.files.reduce((sum, f) => sum + f.deletions, 0),
      changedFiles: pr.files.length,
      mergeable: pr.mergeable,
      mergeStateStatus: world.mergeStateStatus(pr),
      reviewDecision: world.reviewDecision(pr),
      author: world.actor(pr.author),
      autoMerge: pr.autoMerge,
      mergeQueue: null,
      labels: pr.labels.slice(0, 20),
      files: pr.files.slice(0, 100).map((f) => ({
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        changeType: CHANGE_TYPES[f.status],
      })),
      filesTotal: pr.files.length,
      commits: pr.commits.slice(-10),
      commitsTotal: pr.commits.length,
      checks: {
        state: world.rollup(pr),
        total: contexts.length,
        failing: contexts.filter((c) => c.state === "failure").length,
        pending: contexts.filter((c) => c.state === "pending").length,
        contexts,
      },
      reviewRequests: [...pr.requested].slice(0, 20).map((login) => ({
        kind: world.teams.has(login) ? "team" : world.users.get(login)?.isBot ? "bot" : "user",
        login,
        asCodeOwner: false,
      })),
      latestReviews: world.latestOpinions(pr).map((r) => ({
        state: r.state,
        author: r.author,
        commitOid: r.commitOid,
      })),
    };
  }

  private viewerOf(pr: FakePr): PrViewer {
    const latest = this.latestReview(pr);
    return {
      latestReview: latest
        ? { state: latest.state, submittedAt: latest.submittedAt, commitOid: latest.commitOid }
        : null,
    };
  }

  private latestReview(pr: FakePr): FakeReview | null {
    return pr.reviews.findLast((r) => r.author === this.login && r.state !== "PENDING") ?? null;
  }

  private mergeInfoOf(pr: FakePr): MergeInfo {
    const { world } = this;
    const open = pr.state === "OPEN";
    const canWrite = world.canWrite(pr.repo, this.login);
    const methods = pr.repo.mergeMethods;
    const decision = world.reviewDecision(pr);
    return {
      isDraft: pr.isDraft,
      mergeable: MERGEABLE[pr.mergeable],
      mergeStateStatus: world.mergeStateStatus(pr),
      reviewDecision: decision ? DECISIONS[decision] : null,
      // Only offered while the base has moved on since the branch was cut.
      canUpdateBranch:
        open && (canWrite || pr.author === this.login) && pr.baseRefOid !== pr.repo.headOid,
      canEnableAutoMerge: open && canWrite && pr.repo.autoMergeAllowed,
      autoMerge: pr.autoMerge ? { method: pr.autoMerge.method } : null,
      mergeQueue: null,
      messages: {
        MERGE: {
          headline: `Merge pull request #${pr.number} from ${pr.repo.owner}/${pr.headRefName}`,
          body: pr.title,
        },
        SQUASH: {
          headline: `${pr.title} (#${pr.number})`,
          body: pr.commits.map((c) => `* ${c.message.split("\n")[0] ?? ""}`).join("\n\n"),
        },
      },
      methods,
      defaultMethod: methods[0] ?? "MERGE",
      autoMergeAllowed: pr.repo.autoMergeAllowed,
    };
  }

  private detailOf(pr: FakePr): PrDetail {
    const { world } = this;
    const latest = this.latestReview(pr);
    const pending = pr.reviews.find((r) => r.author === this.login && r.state === "PENDING");

    const threads = pr.threads.slice(0, 100).flatMap((thread) => {
      // Comments in an unsubmitted review show only under that review, never in the thread.
      const comments = thread.comments.filter(
        (c) => pr.reviews.find((r) => r.id === c.reviewId)?.state !== "PENDING",
      );
      if (comments.length === 0) return [];
      return [
        {
          id: thread.id,
          path: thread.path,
          side: thread.side,
          line: thread.line,
          startLine: thread.line === null ? null : thread.startLine,
          originalLine: thread.originalLine,
          subject: "line" as const,
          resolved: thread.resolved,
          outdated: thread.line === null,
          resolvedBy: thread.resolvedBy,
          canResolve: world.canResolve(pr, this.login),
          canReply: true,
          diffHunk: thread.diffHunk,
          comments: comments.slice(0, 50).map((c) => ({
            id: c.id,
            author: world.actor(c.author),
            body: c.body,
            bodyHTML: html(c.body),
            createdAt: c.createdAt,
            edited: false,
          })),
        },
      ];
    });

    const timeline: TimelineEntry[] = [
      ...pr.comments.slice(-100).map((c): TimelineEntry => ({
        kind: "comment",
        id: c.id,
        author: world.actor(c.author),
        bodyHTML: html(c.body),
        at: c.createdAt,
      })),
      ...pr.reviews.slice(-50).flatMap((r): TimelineEntry[] =>
        // Thread replies come wrapped in empty "commented" reviews; they show in their thread.
        r.submittedAt && r.state !== "PENDING" && (r.state !== "COMMENTED" || r.body.trim())
          ? [
              {
                kind: "review",
                id: r.id,
                author: world.actor(r.author),
                state: r.state,
                bodyHTML: html(r.body),
                at: r.submittedAt,
                commitOid: r.commitOid,
              },
            ]
          : [],
      ),
      ...pr.commits.slice(-100).map((c): TimelineEntry => ({
        kind: "commit",
        oid: c.oid,
        headline: c.message.split("\n")[0] ?? "",
        author: c.authorLogin ?? c.authorName,
        at: c.committedDate,
      })),
      ...pr.events.slice(-100),
    ].toSorted((a, b) => a.at.localeCompare(b.at));

    const viewed: PrDetail["viewed"] = {};
    for (const file of pr.files.slice(0, 100))
      viewed[file.path] = world.viewedState(pr, this.login, file);

    return {
      prId: pr.id,
      headRefOid: world.head(pr),
      bodyHTML: html(pr.body),
      viewerLatestReview: latest
        ? { state: latest.state, commitOid: latest.commitOid, submittedAt: latest.submittedAt }
        : null,
      pendingReview: pending
        ? {
            id: pending.id,
            commitOid: pending.commitOid,
            comments: pr.threads.flatMap((t) =>
              t.comments
                .filter((c) => c.reviewId === pending.id)
                .map((c) => ({
                  id: c.id,
                  body: c.body,
                  path: t.path,
                  line: t.line,
                  startLine: t.startLine,
                })),
            ),
          }
        : null,
      threads,
      timeline,
      viewed,
    };
  }
}

/** MergeInfo carries GitHub's enum spellings, as the live client passes them through. */
const MERGEABLE: Record<Mergeable, string> = {
  mergeable: "MERGEABLE",
  conflicting: "CONFLICTING",
  unknown: "UNKNOWN",
};

const DECISIONS: Record<NonNullable<ReviewDecision>, string> = {
  approved: "APPROVED",
  changes_requested: "CHANGES_REQUESTED",
  review_required: "REVIEW_REQUIRED",
};

function jobUrl(repo: string, runId: number, jobId: number): string {
  return `https://github.com/${repo}/actions/runs/${runId}/job/${jobId}`;
}

function summary(review: FakeReview): ReviewSummary {
  return {
    id: review.id,
    state: review.state,
    commitOid: review.commitOid,
    submittedAt: review.submittedAt,
  };
}

/** How many API requests a paged read of `count` items takes (at least one). */
function pages(count: number, size: number): number {
  return Math.max(1, Math.ceil(count / size));
}

/** GitHub renders markdown server-side; Bun's renderer is close enough for a fake. */
function html(markdown: string): string {
  return markdown ? Bun.markdown.html(markdown) : "";
}
