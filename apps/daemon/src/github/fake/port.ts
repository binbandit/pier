import { GitHubError, type RateWindow } from "@/github/client";
import { byStep, parseJobLog } from "@/github/job-log";
import type {
  BranchHead,
  CommitFilesInput,
  GitHubPort,
  MergeInfo,
  MergeResult,
  MetadataField,
  NotificationPoll,
  PrRef,
  ReviewEvent,
  ReviewSummary,
  SearchHit,
  SubmitReviewInput,
} from "@/github/port";
import type { PrDetail } from "@/github/pr-detail";
import type { PrDoc, PrViewer, VolatileState } from "@/github/pr-doc";
import type {
  Annotation,
  CheckLog,
  CheckRunView,
  ChecksView,
  CommentSubject,
  DiffFile,
  Label,
  LockReason,
  MergeMethod,
  Mergeable,
  Milestone,
  MinimizeReason,
  Person,
  PrProjects,
  PrStack,
  Reaction,
  ReactionContent,
  ReviewDecision,
  Revision,
  Subscription,
  SuggestedReviewer,
  TimelineEntry,
  WorkflowRunView,
} from "@pier/core/wire";

import { jobLogLines } from "./samples";
import { compileQuery } from "./search";
import {
  type FakeComment,
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

  prId(repo: string, number: number): Promise<string | null> {
    return this.call("prId", "graphql", () => {
      const pr = this.world.prByNumber(repo, number);
      return pr && this.canSee(pr) ? pr.id : null;
    });
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

  async searchFirst(query: string, limit: number): Promise<SearchHit[]> {
    return (await this.search(query)).slice(0, limit);
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

  commitParent(repo: string, oid: string): Promise<string | null> {
    return this.call("commitParent", "core", () => this.world.parentOf(repo, oid));
  }

  stackOf(repo: string, number: number): Promise<PrStack | null> {
    return this.call("stackOf", "core", () => {
      const pr = this.world.prByNumber(repo, number);
      return pr && this.canSee(pr) ? this.stackView(pr) : null;
    });
  }

  projects(prId: string): Promise<PrProjects> {
    return this.call("projects", "graphql", () => {
      const pr = this.world.pr(prId);
      if (!pr || !this.canSee(pr)) return { state: "ok" as const, on: [], available: [] };
      const url = (id: string) => `https://github.com/${pr.repo.owner}/projects/${id.slice(-2)}`;
      return {
        state: "ok" as const,
        on: [...(pr.projectItems ?? new Map())].flatMap(([projectId, item]) => {
          const project = pr.repo.projects.find((p) => p.id === projectId);
          return project
            ? [
                {
                  projectId,
                  itemId: item.itemId,
                  title: project.title,
                  status: item.status,
                  url: url(projectId),
                },
              ]
            : [];
        }),
        available: pr.repo.projects.map((p) => ({ id: p.id, title: p.title, url: url(p.id) })),
      };
    });
  }

  setProject(prId: string, projectId: string, itemId: string | null): Promise<void> {
    return this.call("setProject", "graphql", () =>
      this.world.setProject(prId, projectId, itemId, this.login),
    );
  }

  savedReplies(): Promise<{ title: string; body: string }[]> {
    return this.call("savedReplies", "graphql", () => [
      { title: "Thanks", body: "Thanks for this! Merging once checks are green." },
      { title: "Needs a test", body: "Could you add a test that covers this case?" },
    ]);
  }

  setArchived(prId: string, archived: boolean): Promise<void> {
    return this.call("setArchived", "graphql", () =>
      this.world.setArchived(prId, archived, this.login),
    );
  }

  unstack(repo: string, stackNumber: number): Promise<void> {
    return this.call("unstack", "core", () => this.world.unstack(repo, stackNumber));
  }

  commitFiles(input: CommitFilesInput): Promise<{ oid: string }> {
    return this.call("commitFiles", "graphql", () => ({
      oid: this.world.commitFiles(
        input.repo,
        input.branch,
        {
          expectedHeadOid: input.expectedHeadOid,
          message: input.body ? `${input.headline}\n\n${input.body}` : input.headline,
          files: input.files,
        },
        this.login,
      ),
    }));
  }

  branchHead(repo: string, branch: string): Promise<BranchHead | null> {
    return this.call("branchHead", "core", () => this.world.branchHead(repo, branch));
  }

  rawDiff(repo: string, number: number, format: "diff" | "patch"): Promise<string> {
    return this.call("rawDiff", "core", () => {
      const pr = this.world.prByNumber(repo, number);
      if (!pr || !this.canSee(pr)) throw new GitHubError("404 Not Found", "not-found", 404);
      const diff = pr.files
        .map(
          (f) =>
            `diff --git a/${f.path} b/${f.path}\n--- a/${f.path}\n+++ b/${f.path}\n${f.patch ?? ""}\n`,
        )
        .join("");
      if (format === "diff") return diff;
      const head = this.world.head(pr);
      return `From ${head} Mon Sep 17 00:00:00 2001\nFrom: ${pr.author}\nSubject: [PATCH] ${pr.title}\n\n---\n${diff}`;
    });
  }

  codeOwners(repo: string, _ref: string): Promise<string | null> {
    return this.call("codeOwners", "graphql", () =>
      this.canSeeRepo(repo) ? (this.world.repos.get(repo)?.codeOwners ?? null) : null,
    );
  }

  teams(): Promise<string[]> {
    return this.call("teams", "core", () =>
      [...this.world.teams].flatMap(([slug, members]) => (members.has(this.login) ? [slug] : [])),
    );
  }

  compareFiles(repo: string, base: string, head: string): Promise<DiffFile[]> {
    return this.call("compareFiles", "core", () => this.world.compare(repo, base, head));
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

  markNotificationRead(threadId: string): Promise<void> {
    return this.call("markNotificationRead", "core", () =>
      this.world.markRead(this.login, threadId),
    );
  }

  setSubscription(prId: string, state: Subscription, _threadId: string | null): Promise<void> {
    return this.call("setSubscription", "graphql", () =>
      this.world.subscribe(prId, this.login, state),
    );
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

  fileBytes(repo: string, oid: string, path: string): Promise<Uint8Array | null> {
    return this.call("fileBytes", "core", () => {
      const text = this.canSeeRepo(repo) ? this.world.fileText(repo, oid, path) : null;
      return text === null ? null : new TextEncoder().encode(text);
    });
  }

  fileText(repo: string, oid: string, path: string): Promise<string | null> {
    return this.call("fileText", "core", () =>
      this.canSeeRepo(repo) ? this.world.fileText(repo, oid, path) : null,
    );
  }

  /** Like the live client: a pending review (say, from github.com) is continued, not doubled. */
  submitReview(input: SubmitReviewInput): Promise<ReviewSummary> {
    return this.call("submitReview", "graphql", () => {
      const pr = this.visiblePr(input.prId);
      const pending = pr.reviews.find((r) => r.author === this.login && r.state === "PENDING");
      const onFiles = input.threads.filter((t) => t.subject === "file");
      if (!pending && onFiles.length === 0)
        return this.submit(input.prId, input.commitOid, input.event, input.body, input.threads);
      const review =
        pending ??
        this.world.review(pr.id, this.login, {
          event: "PENDING",
          commitOid: input.commitOid,
          threads: input.threads.filter((t) => t.subject === "line"),
        });
      const already = (path: string, body: string) =>
        pr.threads.some(
          (t) =>
            t.path === path &&
            t.comments.some((c) => c.reviewId === review.id && c.body.trim() === body.trim()),
        );
      for (const thread of pending ? input.threads : onFiles) {
        if (!already(thread.path, thread.body))
          this.world.addReviewThread(review.id, this.login, thread);
      }
      return summary(
        this.world.submitPendingReview(review.id, this.login, input.event, input.body),
      );
    });
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

  /** Check runs as GitHub's Actions jobs, grouped into their workflow runs; no statuses or deployments. */
  checks(repo: string, oid: string): Promise<ChecksView> {
    return this.call("checks", "core", () => {
      if (!this.canSeeRepo(repo)) throw new GitHubError("404 Not Found", "not-found", 404);
      const jobs = this.world.checksAt(repo, oid);
      const runs = jobs.map((run): CheckRunView => ({
        id: run.id,
        name: run.name,
        state: run.state,
        kind: "check",
        jobId: run.id,
        runId: run.runId,
        url: jobUrl(repo, run.runId, run.id),
        summary: null,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        // Every failed job points at the code it failed on, as linters and test reporters do.
        annotations: run.state === "failure" ? 1 : 0,
        workflow: null,
        event: null,
      }));
      const workflows = [...Map.groupBy(jobs, (job) => job.runId)].map(
        ([runId, group]): WorkflowRunView => ({
          id: runId,
          workflowId: 1,
          name: "CI",
          event: "pull_request",
          state: group.some((j) => j.state === "failure")
            ? "failure"
            : group.some((j) => j.state === "pending")
              ? "pending"
              : "success",
          needsApproval: false,
          waitingOn: [],
          url: `https://github.com/${repo}/actions/runs/${runId}`,
        }),
      );
      return { runs, workflows, deployments: [] };
    });
  }

  annotations(repo: string, runs: { id: number; name: string }[]): Promise<Annotation[]> {
    return this.call("annotations", "core", () =>
      runs.flatMap((wanted): Annotation[] => {
        const found = this.world.checkRun(repo, (run) => run.id === wanted.id);
        if (!found || found.run.state !== "failure") return [];
        const file = found.pr.files.find((f) => f.additions > 0);
        const line = file ? firstAddedLine(file.patch) : null;
        if (!file || line === null) return [];
        return [
          {
            check: wanted.name,
            path: file.path,
            startLine: line,
            endLine: line,
            level: "failure",
            title: `${wanted.name} failed here`,
            message: "Expected the new behaviour; got the old one.",
          },
        ];
      }),
    );
  }

  jobLog(repo: string, jobId: number): Promise<CheckLog | null> {
    return this.call("jobLog", "core", () => {
      const run = this.canSeeRepo(repo)
        ? this.world.checkRun(repo, (r) => r.id === jobId)?.run
        : null;
      // Logs of a job that is still running aren't served yet.
      if (!run || run.state === "pending") return null;
      const { sections, truncated } = parseJobLog(
        jobLogLines(run.name, run.state === "failure").join("\n"),
      );
      const steps = [
        { name: "Set up job", state: "success" as const },
        ...sections.map((s) => ({ name: s.title, state: run.state })),
      ];
      return {
        steps: byStep(steps, sections),
        truncated,
        url: jobUrl(repo, run.runId, run.id),
      };
    });
  }

  rerunFailedJobs(repo: string, runId: number, _debug: boolean): Promise<void> {
    return this.call("rerunFailedJobs", "core", () =>
      this.world.rerun(repo, this.login, { runId, only: "failed" }),
    );
  }

  rerunRun(repo: string, runId: number, _debug: boolean): Promise<void> {
    return this.call("rerunRun", "core", () =>
      this.world.rerun(repo, this.login, { runId, only: "all" }),
    );
  }

  rerunJob(repo: string, jobId: number, _debug: boolean): Promise<void> {
    return this.call("rerunJob", "core", () => this.world.rerun(repo, this.login, { jobId }));
  }

  cancelRun(repo: string, runId: number): Promise<void> {
    return this.call("cancelRun", "core", () => this.world.cancelRun(repo, runId, this.login));
  }

  /** The fake has no held runs, so there's never one to approve. */
  approveRun(_repo: string, _runId: number): Promise<void> {
    return this.call("approveRun", "core", () => {
      throw new GitHubError("403 This run is not waiting for approval", "forbidden", 403);
    });
  }

  approveDeployment(_repo: string, _runId: number, _environmentIds: number[]): Promise<void> {
    return this.call("approveDeployment", "core", () => {
      throw new GitHubError("422 No pending deployments", "validation", 422);
    });
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

  enqueue(prId: string, headOid: string, jump: boolean): Promise<void> {
    return this.call("enqueue", "graphql", () =>
      this.world.enqueue(this.visiblePr(prId).id, this.login, headOid, jump),
    );
  }

  dequeue(prId: string): Promise<void> {
    return this.call("dequeue", "graphql", () =>
      this.world.dequeue(this.visiblePr(prId).id, this.login),
    );
  }

  deleteBranch(repo: string, branch: string): Promise<void> {
    return this.call("deleteBranch", "core", () =>
      this.world.deleteBranch(repo, branch, this.login),
    );
  }

  restoreBranch(repo: string, branch: string, _sha: string): Promise<void> {
    return this.call("restoreBranch", "core", () =>
      this.world.restoreBranch(repo, branch, this.login),
    );
  }

  revert(prId: string, title?: string, body?: string): Promise<{ number: number; url: string }> {
    return this.call("revert", "graphql", () => {
      const pr = this.world.revert(this.visiblePr(prId).id, this.login, title, body);
      return { number: pr.number, url: `https://github.com/${pr.repo.fullName}/pull/${pr.number}` };
    });
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

  setAutoMerge(
    prId: string,
    method: MergeMethod | null,
    headOid: string,
    message: { headline?: string; body?: string } = {},
  ): Promise<void> {
    return this.call("setAutoMerge", "graphql", () =>
      this.world.setAutoMerge(this.visiblePr(prId).id, this.login, method, headOid, message),
    );
  }

  updateBranch(prId: string, rebase: boolean, headOid: string): Promise<void> {
    return this.call("updateBranch", "graphql", () =>
      this.world.updateBranch(this.visiblePr(prId).id, this.login, rebase, headOid),
    );
  }

  editMetadata(
    ref: PrRef,
    field: MetadataField,
    { add, remove }: { add: string[]; remove: string[] },
  ): Promise<void> {
    return this.call("editMetadata", "core", () => {
      const pr = this.restPr(ref.repo, ref.number);
      if (field === "labels") this.world.editLabels(pr.id, this.login, add, remove);
      else if (field === "assignees") this.world.editAssignees(pr.id, this.login, add, remove);
      else {
        if (add.length > 0) this.world.requestReviews(pr.id, this.login, add);
        if (remove.length > 0) this.world.removeReviewRequests(pr.id, this.login, remove);
      }
    });
  }

  setMilestone(repo: string, number: number, milestone: number | null): Promise<void> {
    return this.call("setMilestone", "core", () =>
      this.world.setMilestone(this.restPr(repo, number).id, this.login, milestone),
    );
  }

  setDraft(prId: string, draft: boolean): Promise<void> {
    return this.call("setDraft", "graphql", () =>
      this.world.setDraft(this.visiblePr(prId).id, this.login, draft),
    );
  }

  setOpen(prId: string, open: boolean): Promise<void> {
    return this.call("setOpen", "graphql", () => {
      const pr = this.visiblePr(prId);
      if (!this.world.canWrite(pr.repo, this.login) && pr.author !== this.login)
        throw graphqlError(`${this.login} does not have permission to update this pull request`);
      if (open) this.world.reopen(pr.id, this.login);
      else this.world.close(pr.id, this.login);
    });
  }

  repoLabels(repo: string): Promise<Label[]> {
    return this.call("repoLabels", "core", () =>
      [...this.restRepo(repo).labels].map(([name, label]) => ({ name, ...label })),
    );
  }

  assignable(repo: string): Promise<Person[]> {
    return this.call("assignable", "core", () => {
      const found = this.restRepo(repo);
      return [...this.world.users.keys()]
        .filter((login) => !this.world.users.get(login)?.isBot && this.world.canWrite(found, login))
        .map((login) => ({ login, avatarUrl: this.world.avatarUrl(login) }));
    });
  }

  milestones(repo: string): Promise<Milestone[]> {
    return this.call("milestones", "core", () => [...this.restRepo(repo).milestones]);
  }

  react(subjectId: string, content: ReactionContent, on: boolean): Promise<void> {
    return this.call("react", "graphql", () =>
      this.world.react(subjectId, this.login, content, on),
    );
  }

  editWriting(subject: CommentSubject, id: string, body: string): Promise<void> {
    return this.call("editWriting", "graphql", () => {
      if (subject === "pull-request") this.world.editPr(id, this.login, { body });
      else this.world.editWriting(id, this.login, body);
    });
  }

  deleteComment(_subject: "issue-comment" | "review-comment", id: string): Promise<void> {
    return this.call("deleteComment", "graphql", () => this.world.deleteComment(id, this.login));
  }

  minimize(id: string, reason: MinimizeReason | null): Promise<void> {
    return this.call("minimize", "graphql", () => this.world.minimize(id, this.login, reason));
  }

  editPr(prId: string, change: { title?: string; body?: string; base?: string }): Promise<void> {
    return this.call("editPr", "graphql", () =>
      this.world.editPr(this.visiblePr(prId).id, this.login, change),
    );
  }

  dismissReview(reviewId: string, message: string): Promise<void> {
    return this.call("dismissReview", "graphql", () =>
      this.world.dismissReview(reviewId, this.login, message),
    );
  }

  setLocked(repo: string, number: number, reason: LockReason | null): Promise<void> {
    return this.call("setLocked", "core", () =>
      this.world.setLocked(this.restPr(repo, number).id, this.login, reason),
    );
  }

  branches(repo: string): Promise<string[]> {
    return this.call("branches", "core", () => {
      const found = this.restRepo(repo);
      const heads = [...this.world.prs.values()]
        .filter((pr) => pr.repo === found && pr.state === "OPEN")
        .map((pr) => pr.headRefName);
      return [...new Set([found.defaultBranch, "release", ...heads])];
    });
  }

  /** People who can write and aren't the author, most recently active first. */
  suggestedReviewers(prId: string): Promise<SuggestedReviewer[]> {
    return this.call("suggestedReviewers", "graphql", () => {
      const pr = this.visiblePr(prId);
      return [...this.world.users.values()]
        .filter((u) => !u.isBot && u.login !== pr.author && this.world.canWrite(pr.repo, u.login))
        .map((u) => ({ login: u.login, avatarUrl: this.world.avatarUrl(u.login), bot: false }));
    });
  }

  history(subjectId: string): Promise<Revision[]> {
    return this.call("history", "graphql", () => {
      const found = this.world.writing(subjectId);
      if (!found || found.subject === "pull-request") return [];
      return found.target.history.map((h) => ({
        editedAt: h.editedAt,
        editor: h.editor,
        body: h.body,
      }));
    });
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

  /** The stack a PR is in, as GitHub's stacks API answers it. */
  private stackView(pr: FakePr): PrStack | null {
    const stack = this.world.stackOf(pr);
    if (!stack) return null;
    const members = stack.prIds.flatMap((id) => this.world.prs.get(id) ?? []);
    return {
      number: stack.number,
      base: members[0]?.baseRefName ?? stack.repo.defaultBranch,
      prs: members.map((member, i) => ({
        number: member.number,
        position: i + 1,
        title: null,
        state: member.state === "OPEN" ? ("open" as const) : ("closed" as const),
        draft: member.isDraft,
        merged: member.state === "MERGED",
      })),
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

  private restRepo(fullName: string) {
    const repo = this.world.repos.get(fullName);
    if (!repo || !this.canSeeRepo(fullName))
      throw new GitHubError("404 Not Found", "not-found", 404);
    return repo;
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
      mergeQueue:
        pr.queuePosition === null ? null : { position: pr.queuePosition, state: "QUEUED" },
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
      mergeQueue:
        pr.queuePosition === null ? null : { position: pr.queuePosition, state: "QUEUED" },
      labels: pr.labels.slice(0, 20),
      assignees: pr.assignees.map((login) => ({ login, avatarUrl: world.avatarUrl(login) })),
      milestone: pr.repo.milestones.find((m) => m.number === pr.milestone) ?? null,
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
        asCodeOwner: world.ownsAny(pr, login),
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
      canEnableAutoMerge:
        open &&
        canWrite &&
        pr.repo.autoMergeAllowed &&
        !pr.isDraft &&
        pr.autoMerge === null &&
        world.mergeStateStatus(pr) !== "CLEAN",
      canDisableAutoMerge: open && canWrite && pr.autoMerge !== null,
      autoMerge: pr.autoMerge
        ? {
            method: pr.autoMerge.method,
            ...(pr.autoMerge.headline !== undefined ? { headline: pr.autoMerge.headline } : {}),
            ...(pr.autoMerge.body !== undefined ? { body: pr.autoMerge.body } : {}),
          }
        : null,
      mergeQueue:
        pr.queuePosition === null ? null : { position: pr.queuePosition, state: "QUEUED" },
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
      canMergeAsAdmin: world.permission(pr.repo, this.login) === "ADMIN",
      mergeQueueEnabled: pr.repo.mergeQueue,
    };
  }

  /** What GitHub says about a comment or review for the account reading it. */
  private writingOf<S extends "issue-comment" | "review-comment" | "review">(
    pr: FakePr,
    subject: S,
    target: FakeComment | FakeReview,
  ) {
    const canEdit = this.world.canEditWriting(pr, target.author, this.login);
    const isComment = subject !== "review";
    return {
      subject,
      body: target.body,
      edited: target.editedAt !== null,
      canEdit,
      canDelete: isComment && canEdit,
      canMinimize: isComment && this.world.canWrite(pr.repo, this.login),
      minimized: target.minimized,
      reactions: reactionsOf(target.reactions, this.login),
      unsent: false,
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
          startSide: thread.line === null || thread.startLine === null ? null : thread.side,
          originalLine: thread.originalLine,
          subject: thread.subject,
          resolved: thread.resolved,
          outdated: thread.subject === "line" && thread.line === null,
          resolvedBy: thread.resolvedBy,
          canResolve: world.canResolve(pr, this.login),
          canReply: true,
          diffHunk: thread.diffHunk,
          comments: comments.slice(0, 50).map((c) => ({
            id: c.id,
            author: world.actor(c.author),
            bodyHTML: html(c.body),
            createdAt: c.createdAt,
            ...this.writingOf(pr, "review-comment", c),
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
        ...this.writingOf(pr, "issue-comment", c),
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
                canDismiss: false,
                ...this.writingOf(pr, "review", r),
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
      reactions: reactionsOf(pr.reactions, this.login),
      canEdit: world.canEditWriting(pr, pr.author, this.login),
      headBranch: {
        exists: !pr.repo.deletedBranches.has(pr.headRefName),
        canDelete:
          pr.state !== "OPEN" &&
          !pr.repo.deletedBranches.has(pr.headRefName) &&
          world.canWrite(pr.repo, this.login),
        crossRepo: false,
      },
      linkedIssues: [],
      requiredChecks: pr.repo.checkNames.filter((name) => name !== "e2e"),
      head: {
        repo: pr.repo.fullName,
        branch: pr.headRefName,
        canEditFiles: pr.state === "OPEN" && world.canWrite(pr.repo, this.login),
      },
      subscription: world.subscriptions.get(pr.id)?.get(this.login) ?? "UNSUBSCRIBED",
      stack: this.stackView(pr),
      userIds: Object.fromEntries(
        pr.threads.flatMap((t) =>
          t.comments.flatMap((c) => {
            const user = world.users.get(c.author);
            return user ? [[user.login, user.databaseId] as const] : [];
          }),
        ),
      ),
      commits: pr.commits.slice(-100).map((c) => ({
        oid: c.oid,
        headline: c.message.split("\n")[0] ?? "",
        body: c.message.split("\n").slice(1).join("\n").trim(),
        author: c.authorLogin ?? c.authorName,
        at: c.committedDate,
        checks: world.rollup(pr, c.oid),
        verified: c.signatureValid,
      })),
      locked: pr.locked,
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
/** Markdown as GitHub renders it, down to drawing a suggestion block as a suggested change. */
function html(markdown: string): string {
  if (!markdown) return "";
  return Bun.markdown
    .html(markdown)
    .replace(
      /<pre><code class="language-suggestion">([\s\S]*?)<\/code><\/pre>/g,
      '<div class="js-suggested-changes-blob"><table><tr><td class="blob-code-addition">$1</td></tr></table></div>',
    );
}

const REACTION_ORDER: ReactionContent[] = [
  "THUMBS_UP",
  "THUMBS_DOWN",
  "LAUGH",
  "HOORAY",
  "CONFUSED",
  "HEART",
  "ROCKET",
  "EYES",
];

function reactionsOf(reactions: Map<ReactionContent, Set<string>>, viewer: string): Reaction[] {
  return REACTION_ORDER.flatMap((content) => {
    const who = reactions.get(content);
    return who && who.size > 0 ? [{ content, count: who.size, mine: who.has(viewer) }] : [];
  });
}

/** The new-side line number of a patch's first added line. */
function firstAddedLine(patch: string | null): number | null {
  let line = 0;
  for (const text of (patch ?? "").split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text);
    if (hunk) line = Number(hunk[1]) - 1;
    else if (text.startsWith("+")) return line + 1;
    else if (!text.startsWith("-")) line++;
  }
  return null;
}
