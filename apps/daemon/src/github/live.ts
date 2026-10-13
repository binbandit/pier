import type { components } from "@octokit/openapi-types";

import type {
  Annotation,
  CheckLog,
  CheckRunView,
  ChecksView,
  CommentSubject,
  DeploymentView,
  DiffFile,
  Label,
  LockReason,
  MergeMethod,
  Milestone,
  MinimizeReason,
  Person,
  ReactionContent,
  Revision,
  Subscription,
  SuggestedReviewer,
  WorkflowRunView,
} from "@pier/core/wire";

import type { GitHubTransport, RestResponse } from "./client";
import { GitHubError } from "./client";
import { byStep, parseJobLog } from "./job-log";
import {
  AddReactionMutation,
  AddReviewThreadMutation,
  ApproveMutation,
  ClosePrMutation,
  CodeOwnersQuery,
  CommitOnBranchMutation,
  CommentMutation,
  ConvertToDraftMutation,
  DeleteIssueCommentMutation,
  DeleteReviewCommentMutation,
  DequeueMutation,
  DismissReviewMutation,
  CommentsByQuery,
  DisableAutoMergeMutation,
  EnableAutoMergeMutation,
  EnqueueMutation,
  HistoryQuery,
  HydrateQuery,
  MarkReadyMutation,
  MarkViewedMutation,
  MinimizeMutation,
  PendingReviewQuery,
  PrIdQuery,
  MergeInfoQuery,
  PrDetailQuery,
  RemoveReactionMutation,
  ReopenPrMutation,
  RequestReviewsMutation,
  RevertMutation,
  ReplyMutation,
  ResolveThreadMutation,
  ReviewsByAuthorQuery,
  SearchPullsQuery,
  StartReviewMutation,
  SubmitPendingReviewMutation,
  SubmitReviewMutation,
  SuggestedReviewersQuery,
  SweepQuery,
  UnmarkViewedMutation,
  UnminimizeMutation,
  UnresolveThreadMutation,
  UpdateBranchMutation,
  UpdateIssueCommentMutation,
  UpdatePrMutation,
  UpdateReviewCommentMutation,
  UpdateReviewMutation,
  ViewerQuery,
  UpdateSubscriptionMutation,
} from "./ops";
import type {
  BranchHead,
  CommitFilesInput,
  DraftThreadInput,
  GitHubPort,
  MergeInfo,
  MergeResult,
  MetadataField,
  NotificationPoll,
  NotificationThread,
  PrRef,
  ReviewSummary,
  SearchHit,
  SubmitReviewInput,
} from "./port";
import { isDetailNode, toPrDetail } from "./pr-detail";
import { isHydrated, isSwept, toPrDoc, toVolatile } from "./pr-doc";

type RestThread = components["schemas"]["thread"];
type RestFile = components["schemas"]["diff-entry"];

const SEARCH_CAP = 1000;
const HYDRATE_BATCH = 25;
// 100 per query is allowed, but mergeability is computed on read and big batches hit GitHub's
// 10-second limit (502). 50 keeps each sweep well under it for the same point cost.
const SWEEP_BATCH = 50;

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

export class LiveGitHub implements GitHubPort {
  constructor(private readonly client: GitHubTransport) {}

  get login() {
    return this.client.login;
  }

  rates() {
    return this.client.rates();
  }

  async viewer() {
    const data = await this.client.graphql(ViewerQuery, {}, "interactive");
    return { login: data.viewer.login, avatarUrl: data.viewer.avatarUrl };
  }

  async prId(repo: string, number: number): Promise<string | null> {
    const [owner = "", name = ""] = repo.split("/");
    try {
      const data = await this.client.graphql(PrIdQuery, { owner, name, number }, "interactive");
      return data.repository?.pullRequest?.id ?? null;
    } catch (error) {
      // "Could not resolve to a Repository/PullRequest": not there, or not visible to this account.
      if (error instanceof GitHubError && error.kind === "graphql") return null;
      throw error;
    }
  }

  async search(query: string): Promise<SearchHit[]> {
    const first = await this.searchPage(query, null);
    if (first.total <= SEARCH_CAP) return this.collect(query, first);
    // Past the cap, halve the creation-date range until every slice fits.
    return this.searchByDate(query, new Date("2008-01-01"), new Date());
  }

  async searchFirst(query: string, limit: number): Promise<SearchHit[]> {
    return (await this.searchPage(query, null)).hits.slice(0, limit);
  }

  async sweep(ids: string[]): Promise<ReturnType<typeof toVolatile>[]> {
    const out = [];
    for (const batch of chunks(ids, SWEEP_BATCH)) {
      out.push(
        ...(await splitOnTimeout(batch, async (part) => {
          const data = await this.client.graphql(SweepQuery, { ids: part });
          return data.nodes.filter(isSwept).map(toVolatile);
        })),
      );
    }
    return out;
  }

  async hydrate(ids: string[]) {
    const out = [];
    for (const batch of chunks(ids, HYDRATE_BATCH)) {
      out.push(
        ...(await splitOnTimeout(batch, async (part) => {
          const data = await this.client.graphql(HydrateQuery, { ids: part });
          return data.nodes.filter(isHydrated).map(toPrDoc);
        })),
      );
    }
    return out;
  }

  async commitParent(repo: string, oid: string): Promise<string | null> {
    const response = await this.client.rest<components["schemas"]["commit"]>({
      path: `/repos/${repo}/commits/${oid}`,
      cache: true,
      priority: "interactive",
    });
    return response.data.parents[0]?.sha ?? null;
  }

  async compareFiles(repo: string, base: string, head: string): Promise<DiffFile[]> {
    const response = await this.client.rest<components["schemas"]["commit-comparison"]>({
      path: `/repos/${repo}/compare/${base}...${head}`,
      cache: true,
      priority: "interactive",
    });
    return (response.data.files ?? []).map(toDiffFile);
  }

  async files(repo: string, number: number): Promise<DiffFile[]> {
    const files: DiffFile[] = [];
    // GitHub caps this listing at 3,000 files; anything beyond is reached through the git store.
    for (let page = 1; page <= 30; page++) {
      const response = await this.client.rest<RestFile[]>({
        path: `/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
        cache: true,
      });
      files.push(...response.data.map(toDiffFile));
      if (response.data.length < 100) break;
    }
    return files;
  }

  async notifications(fresh = false): Promise<NotificationPoll> {
    // Read threads count too: they stay in GitHub's inbox until marked done.
    const first = await this.client.rest<RestThread[]>({
      path: "/notifications?all=true&per_page=50",
      cache: true,
      unconditional: fresh,
    });
    const pollIntervalSec = Number(first.headers.get("x-poll-interval") ?? 60);
    if (first.notModified) return { changed: false, pollIntervalSec };

    const threads = first.data.map(toThread);
    let next = nextLink(first.headers.get("link"));
    // Only the first page is revalidated; later pages are read only when the first one changed.
    for (let page = 0; next && page < 10; page++) {
      const response = await this.client.rest<RestThread[]>({ path: next });
      threads.push(...response.data.map(toThread));
      next = nextLink(response.headers.get("link"));
    }
    return { changed: true, pollIntervalSec, threads };
  }

  async markNotificationRead(threadId: string): Promise<void> {
    await this.client.rest({
      method: "PATCH",
      path: `/notifications/threads/${threadId}`,
      priority: "interactive",
    });
  }

  async setSubscription(prId: string, state: Subscription, threadId: string | null): Promise<void> {
    // A PR GitHub has notified you about can be changed through that thread with the `repo`
    // scope. Otherwise only GraphQL can do it, and that needs the `notifications` scope.
    if (threadId) {
      const path = `/notifications/threads/${threadId}/subscription`;
      if (state === "UNSUBSCRIBED") await this.write("DELETE", path);
      else await this.write("PUT", path, { ignored: state === "IGNORED" });
      return;
    }
    try {
      await this.client.graphql(UpdateSubscriptionMutation, { id: prId, state }, "interactive");
    } catch (error) {
      if (error instanceof GitHubError && error.message.includes("'notifications'")) {
        throw new GitHubError(
          `GitHub hasn't notified ${this.login} about this PR, and changing that needs the notifications scope: gh auth refresh -h github.com -u ${this.login} -s notifications`,
          "forbidden",
          error.status,
        );
      }
      throw error;
    }
  }

  async markNotificationDone(threadId: string): Promise<void> {
    await this.client.rest({
      method: "DELETE",
      path: `/notifications/threads/${threadId}`,
      priority: "interactive",
    });
  }

  async approve(prId: string, commitOid: string, body?: string): Promise<ReviewSummary> {
    const data = await this.client.graphql(
      ApproveMutation,
      { prId, commit: commitOid, body: body ?? null },
      "interactive",
    );
    const review = data.addPullRequestReview?.pullRequestReview;
    if (!review) throw new GitHubError("approval returned no review", "graphql", null);
    return {
      id: review.id,
      state: review.state,
      commitOid: review.commit?.oid ?? null,
      submittedAt: review.submittedAt ?? null,
    };
  }

  async comment(subjectId: string, body: string) {
    const data = await this.client.graphql(CommentMutation, { subjectId, body }, "interactive");
    const node = data.addComment?.commentEdge?.node;
    if (!node) throw new GitHubError("comment returned no node", "graphql", null);
    return { id: node.id };
  }

  async reviewsBy(prId: string, author: string): Promise<ReviewSummary[]> {
    const data = await this.client.graphql(ReviewsByAuthorQuery, { prId, author }, "interactive");
    const node = data.node;
    if (!node || !("reviews" in node)) return [];
    return (node.reviews?.nodes ?? []).flatMap((review) =>
      review
        ? [
            {
              id: review.id,
              state: review.state,
              commitOid: review.commit?.oid ?? null,
              submittedAt: review.submittedAt ?? null,
            },
          ]
        : [],
    );
  }

  async detail(prId: string) {
    const data = await this.client.graphql(PrDetailQuery, { id: prId }, "interactive");
    return isDetailNode(data.node) ? toPrDetail(data.node) : null;
  }

  async mergeBase(repo: string, base: string, head: string): Promise<string | null> {
    try {
      const response = await this.client.rest<components["schemas"]["commit-comparison"]>({
        // per_page=1 keeps the response small; only the merge base is needed.
        path: `/repos/${repo}/compare/${encodeURIComponent(base)}...${head}?per_page=1`,
        cache: true,
        priority: "interactive",
      });
      return response.data.merge_base_commit.sha;
    } catch (error) {
      if (error instanceof GitHubError && error.kind === "not-found") return null;
      throw error;
    }
  }

  async commitFiles(input: CommitFilesInput): Promise<{ oid: string }> {
    const data = await this.client.graphql(
      CommitOnBranchMutation,
      {
        input: {
          branch: { repositoryNameWithOwner: input.repo, branchName: input.branch },
          expectedHeadOid: input.expectedHeadOid,
          message: { headline: input.headline, body: input.body },
          fileChanges: {
            additions: input.files.map((file) => ({
              path: file.path,
              contents: Buffer.from(file.contents, "utf8").toString("base64"),
            })),
          },
        },
      },
      "interactive",
    );
    const oid = data.createCommitOnBranch?.commit?.oid;
    if (!oid) throw new GitHubError("GitHub didn't say which commit it made", "graphql", null);
    return { oid };
  }

  async branchHead(repo: string, branch: string): Promise<BranchHead | null> {
    try {
      const response = await this.client.rest<components["schemas"]["commit"]>({
        path: `/repos/${repo}/commits/${encodeURIComponent(branch)}`,
        priority: "interactive",
      });
      const { sha, parents, commit } = response.data;
      return { oid: sha, parents: parents.map((p) => p.sha), message: commit.message };
    } catch (error) {
      if (error instanceof GitHubError && error.kind === "not-found") return null;
      throw error;
    }
  }

  async rawDiff(repo: string, number: number, format: "diff" | "patch"): Promise<string> {
    const response = await this.client.rest<string>({
      path: `/repos/${repo}/pulls/${number}`,
      accept: `application/vnd.github.${format}`,
      text: true,
      priority: "interactive",
    });
    return response.data;
  }

  async codeOwners(repo: string, ref: string): Promise<string | null> {
    const [owner = "", name = ""] = repo.split("/");
    const data = await this.client.graphql(CodeOwnersQuery, {
      owner,
      name,
      github: `${ref}:.github/CODEOWNERS`,
      root: `${ref}:CODEOWNERS`,
      docs: `${ref}:docs/CODEOWNERS`,
    });
    const places = [data.repository?.github, data.repository?.root, data.repository?.docs];
    for (const place of places) {
      if (place && "text" in place && typeof place.text === "string") return place.text;
    }
    return null;
  }

  async teams(): Promise<string[]> {
    const teams = await this.paged<components["schemas"]["team-full"]>("/user/teams");
    return teams.map((t) => `${t.organization.login}/${t.slug}`);
  }

  async fileBytes(repo: string, oid: string, path: string): Promise<Uint8Array | null> {
    try {
      const response = await this.client.rest<components["schemas"]["content-file"]>({
        path: `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${oid}`,
        cache: true,
        priority: "interactive",
      });
      if (Array.isArray(response.data) || response.data.type !== "file") return null;
      if (response.data.encoding !== "base64") return null;
      return Buffer.from(response.data.content, "base64");
    } catch (error) {
      if (error instanceof GitHubError && error.kind === "not-found") return null;
      throw error;
    }
  }

  async fileText(repo: string, oid: string, path: string): Promise<string | null> {
    try {
      const response = await this.client.rest<components["schemas"]["content-file"]>({
        path: `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${oid}`,
        cache: true,
        priority: "interactive",
      });
      // Over 1 MB the contents API leaves the content out ("encoding": "none").
      if (
        Array.isArray(response.data) ||
        response.data.type !== "file" ||
        response.data.encoding !== "base64"
      )
        return null;
      // Only text that is UTF-8 throughout: anything else would come back altered if written.
      try {
        return STRICT_UTF8.decode(Buffer.from(response.data.content, "base64"));
      } catch {
        return null;
      }
    } catch (error) {
      if (error instanceof GitHubError && error.kind === "not-found") return null;
      throw error;
    }
  }

  async submitReview(input: SubmitReviewInput): Promise<ReviewSummary> {
    const pending = await this.pendingReview(input.prId);
    const onLines = input.threads.flatMap((t) => (t.subject === "line" ? [toDraftThread(t)] : []));
    const onFiles = input.threads.filter((t) => t.subject === "file");

    // The common case: one write that creates and submits the review with its threads.
    if (!pending && onFiles.length === 0) {
      const data = await this.client.graphql(
        SubmitReviewMutation,
        {
          prId: input.prId,
          commit: input.commitOid,
          event: input.event,
          body: input.body || null,
          threads: onLines,
        },
        "interactive",
      );
      return toSummary(data.addPullRequestReview?.pullRequestReview);
    }

    // A review already in progress (say, started on github.com) is continued rather than
    // duplicated: what isn't on it yet is added, then it's submitted. File comments only exist
    // as threads added to a pending review, so they take this path too.
    const reviewId =
      pending?.id ??
      (
        await this.client.graphql(
          StartReviewMutation,
          { prId: input.prId, commit: input.commitOid, threads: onLines },
          "interactive",
        )
      ).addPullRequestReview?.pullRequestReview?.id;
    if (!reviewId) throw new GitHubError("starting the review returned nothing", "graphql", null);
    const already = (t: DraftThreadInput) =>
      pending?.comments.some((c) => c.path === t.path && c.body.trim() === t.body.trim()) ?? false;
    for (const thread of pending ? input.threads : onFiles) {
      if (already(thread)) continue;
      await this.client.graphql(
        AddReviewThreadMutation,
        thread.subject === "file"
          ? { reviewId, path: thread.path, body: thread.body, subject: "FILE" }
          : { reviewId, subject: "LINE", ...toDraftThread(thread) },
        "interactive",
      );
    }
    const data = await this.client.graphql(
      SubmitPendingReviewMutation,
      { reviewId, event: input.event, body: input.body || null },
      "interactive",
    );
    return toSummary(data.submitPullRequestReview?.pullRequestReview);
  }

  /** Your unsubmitted review on the PR, with what's in it, if you have one. */
  private async pendingReview(prId: string) {
    const data = await this.client.graphql(PendingReviewQuery, { prId }, "interactive");
    const review =
      data.node && "reviews" in data.node ? (data.node.reviews?.nodes?.[0] ?? null) : null;
    if (!review) return null;
    return {
      id: review.id,
      comments: (review.comments.nodes ?? []).flatMap((c) => (c ? [c] : [])),
    };
  }

  async reply(threadId: string, body: string) {
    const data = await this.client.graphql(ReplyMutation, { threadId, body }, "interactive");
    const comment = data.addPullRequestReviewThreadReply?.comment;
    if (!comment) throw new GitHubError("reply returned nothing", "graphql", null);
    return { id: comment.id };
  }

  async setResolved(threadId: string, resolved: boolean): Promise<void> {
    if (resolved) await this.client.graphql(ResolveThreadMutation, { threadId }, "interactive");
    else await this.client.graphql(UnresolveThreadMutation, { threadId }, "interactive");
  }

  async setViewed(prId: string, path: string, viewed: boolean): Promise<void> {
    if (viewed) await this.client.graphql(MarkViewedMutation, { prId, path }, "interactive");
    else await this.client.graphql(UnmarkViewedMutation, { prId, path }, "interactive");
  }

  async recentComments(prId: string) {
    const data = await this.client.graphql(CommentsByQuery, { prId }, "interactive");
    const node = data.node;
    if (!node || !("comments" in node)) return [];
    const flat = [
      ...(node.comments.nodes ?? []),
      ...(node.reviewThreads.nodes ?? []).flatMap((t) => t?.comments.nodes ?? []),
    ];
    return flat.flatMap((c) =>
      c ? [{ id: c.id, body: c.body, author: c.author?.login ?? null }] : [],
    );
  }

  async checks(repo: string, oid: string): Promise<ChecksView> {
    type Run = components["schemas"]["check-run"];
    type Workflow = components["schemas"]["workflow-run"];
    const get = <T>(path: string) =>
      this.client.rest<T>({ path, cache: true, priority: "interactive" }).then((r) => r.data);
    const [checkRuns, status, workflows, deployments] = await Promise.all([
      get<{ check_runs: Run[] }>(
        `/repos/${repo}/commits/${oid}/check-runs?per_page=100&filter=latest`,
      ),
      get<components["schemas"]["combined-commit-status"]>(`/repos/${repo}/commits/${oid}/status`),
      get<{ workflow_runs: Workflow[] }>(`/repos/${repo}/actions/runs?head_sha=${oid}&per_page=50`),
      get<components["schemas"]["deployment"][]>(
        `/repos/${repo}/deployments?sha=${oid}&per_page=10`,
      ),
    ]);

    const runs: CheckRunView[] = [
      ...checkRuns.check_runs.map((run): CheckRunView => {
        // Actions checks link to their job: /owner/repo/actions/runs/<run>/job/<job>.
        const ids = /\/actions\/runs\/(\d+)\/job\/(\d+)/.exec(
          run.details_url ?? run.html_url ?? "",
        );
        return {
          id: Number(run.id),
          name: run.name,
          state: checkRunState(run.status, run.conclusion),
          kind: "check",
          jobId: ids?.[2] ? Number(ids[2]) : null,
          runId: ids?.[1] ? Number(ids[1]) : null,
          url: run.html_url ?? run.details_url ?? "",
          summary: run.output.title ?? null,
          startedAt: run.started_at ?? null,
          completedAt: run.completed_at ?? null,
          annotations: run.output.annotations_count,
          workflow: null,
          event: null,
        };
      }),
      ...status.statuses.map((s): CheckRunView => ({
        id: s.id,
        name: s.context,
        state: s.state === "success" ? "success" : s.state === "pending" ? "pending" : "failure",
        kind: "status",
        jobId: null,
        runId: null,
        url: s.target_url ?? "",
        summary: s.description ?? null,
        startedAt: s.created_at,
        completedAt: s.state === "pending" ? null : s.updated_at,
        annotations: 0,
        workflow: null,
        event: null,
      })),
    ];

    const views = await Promise.all(
      workflows.workflow_runs.map(async (run): Promise<WorkflowRunView> => {
        // A run waiting on an environment's reviewers says which, and whether you're one.
        const waiting =
          run.status === "waiting"
            ? await get<components["schemas"]["pending-deployment"][]>(
                `/repos/${repo}/actions/runs/${run.id}/pending_deployments`,
              )
            : [];
        return {
          id: Number(run.id),
          workflowId: run.workflow_id,
          name: run.name ?? run.display_title,
          event: run.event,
          state: checkRunState(run.status ?? "queued", run.conclusion),
          needsApproval: run.status === "action_required" || run.conclusion === "action_required",
          waitingOn: waiting.flatMap((p) =>
            p.environment.id && p.environment.name
              ? [
                  {
                    id: Number(p.environment.id),
                    name: p.environment.name,
                    canApprove: p.current_user_can_approve,
                  },
                ]
              : [],
          ),
          url: run.html_url,
        };
      }),
    );

    const deploymentViews = await Promise.all(
      deployments.slice(0, 5).map(async (d): Promise<DeploymentView> => {
        const [latest] = await get<components["schemas"]["deployment-status"][]>(
          `/repos/${repo}/deployments/${d.id}/statuses?per_page=1`,
        );
        return {
          id: Number(d.id),
          environment: d.environment,
          state: latest?.state ?? "pending",
          url: latest?.environment_url || null,
          at: latest?.created_at ?? d.created_at,
        };
      }),
    );
    return { runs, workflows: views, deployments: deploymentViews };
  }

  async annotations(repo: string, runs: { id: number; name: string }[]): Promise<Annotation[]> {
    const lists = await Promise.all(
      runs.map(async (run) => {
        const items = await this.paged<components["schemas"]["check-annotation"]>(
          `/repos/${repo}/check-runs/${run.id}/annotations`,
        );
        return items.map((a): Annotation => ({
          check: run.name,
          path: a.path,
          startLine: a.start_line,
          endLine: a.end_line,
          level:
            a.annotation_level === "failure" || a.annotation_level === "warning"
              ? a.annotation_level
              : "notice",
          title: a.title ?? null,
          message: a.message ?? "",
        }));
      }),
    );
    return lists.flat();
  }

  async jobLog(repo: string, jobId: number): Promise<CheckLog | null> {
    const [job, target] = await Promise.all([
      this.client
        .rest<components["schemas"]["job"]>({
          path: `/repos/${repo}/actions/jobs/${jobId}`,
          priority: "interactive",
        })
        .then((r) => r.data),
      // GitHub answers with a redirect to a short-lived storage URL, which must be fetched
      // without our token (it would be sent to a third-party host otherwise).
      this.client.location(`/repos/${repo}/actions/jobs/${jobId}/logs`),
    ]);
    if (!target) return null;
    const response = await fetch(target, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return null;
    const { sections, truncated } = parseJobLog(await response.text());
    const steps = (job.steps ?? []).map((step) => ({
      name: step.name,
      state: checkRunState(step.status, step.conclusion),
    }));
    return {
      steps: byStep(steps, sections),
      truncated,
      url: job.html_url ?? `https://github.com/${repo}/actions/runs/${job.run_id}`,
    };
  }

  async rerunFailedJobs(repo: string, runId: number, debug: boolean): Promise<void> {
    await this.write("POST", `/repos/${repo}/actions/runs/${runId}/rerun-failed-jobs`, {
      enable_debug_logging: debug,
    });
  }

  async rerunRun(repo: string, runId: number, debug: boolean): Promise<void> {
    await this.write("POST", `/repos/${repo}/actions/runs/${runId}/rerun`, {
      enable_debug_logging: debug,
    });
  }

  async rerunJob(repo: string, jobId: number, debug: boolean): Promise<void> {
    await this.write("POST", `/repos/${repo}/actions/jobs/${jobId}/rerun`, {
      enable_debug_logging: debug,
    });
  }

  async cancelRun(repo: string, runId: number): Promise<void> {
    await this.write("POST", `/repos/${repo}/actions/runs/${runId}/cancel`);
  }

  async approveRun(repo: string, runId: number): Promise<void> {
    await this.write("POST", `/repos/${repo}/actions/runs/${runId}/approve`);
  }

  async approveDeployment(repo: string, runId: number, environmentIds: number[]): Promise<void> {
    await this.write("POST", `/repos/${repo}/actions/runs/${runId}/pending_deployments`, {
      environment_ids: environmentIds,
      state: "approved",
      comment: "Approved from pier",
    });
  }

  async mergeInfo(prId: string): Promise<MergeInfo | null> {
    const data = await this.client.graphql(MergeInfoQuery, { id: prId }, "interactive");
    const node = data.node;
    if (!node || !("mergeStateStatus" in node)) return null;
    const repo = node.repository;
    const methods: MergeMethod[] = [
      ...(repo.squashMergeAllowed ? (["SQUASH"] as const) : []),
      ...(repo.mergeCommitAllowed ? (["MERGE"] as const) : []),
      ...(repo.rebaseMergeAllowed ? (["REBASE"] as const) : []),
    ];
    return {
      isDraft: node.isDraft,
      mergeable: node.mergeable,
      mergeStateStatus: node.mergeStateStatus,
      reviewDecision: node.reviewDecision ?? null,
      canUpdateBranch: node.viewerCanUpdateBranch,
      canEnableAutoMerge: node.viewerCanEnableAutoMerge,
      autoMerge: node.autoMergeRequest ? { method: node.autoMergeRequest.mergeMethod } : null,
      mergeQueue: node.mergeQueueEntry,
      messages: {
        MERGE: { headline: node.mergeHeadline, body: node.mergeBody },
        SQUASH: { headline: node.squashHeadline, body: node.squashBody },
      },
      methods,
      defaultMethod: methods.includes(repo.viewerDefaultMergeMethod)
        ? repo.viewerDefaultMergeMethod
        : (methods[0] ?? "MERGE"),
      autoMergeAllowed: repo.autoMergeAllowed,
      canMergeAsAdmin: node.viewerCanMergeAsAdmin,
      mergeQueueEnabled: node.isMergeQueueEnabled,
    };
  }

  async merge(
    repo: string,
    number: number,
    input: {
      sha: string;
      method: MergeMethod;
      title?: string;
      message?: string;
      action?: "direct_merge" | "merge_queue";
    },
  ): Promise<MergeResult> {
    const response = await this.client.rest<AsyncMerge>({
      method: "PUT",
      path: `/repos/${repo}/pulls/${number}/merge-async`,
      body: {
        sha: input.sha,
        merge_method: input.method.toLowerCase(),
        ...(input.title ? { commit_title: input.title } : {}),
        ...(input.message !== undefined ? { commit_message: input.message } : {}),
        ...(input.action ? { merge_action: input.action } : {}),
      },
      priority: "interactive",
    });
    return toMergeResult(response.data);
  }

  async enqueue(prId: string, headOid: string, jump: boolean): Promise<void> {
    await this.client.graphql(EnqueueMutation, { prId, head: headOid, jump }, "interactive");
  }

  async dequeue(prId: string): Promise<void> {
    await this.client.graphql(DequeueMutation, { prId }, "interactive");
  }

  async deleteBranch(repo: string, branch: string): Promise<void> {
    await this.write("DELETE", `/repos/${repo}/git/refs/heads/${branch}`);
  }

  async restoreBranch(repo: string, branch: string, sha: string): Promise<void> {
    await this.write("POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha });
  }

  async revert(
    prId: string,
    title?: string,
    body?: string,
  ): Promise<{ number: number; url: string }> {
    const data = await this.client.graphql(
      RevertMutation,
      { prId, title: title ?? null, body: body ?? null },
      "interactive",
    );
    const pr = data.revertPullRequest?.revertPullRequest;
    if (!pr) throw new GitHubError("GitHub didn't open the revert PR", "graphql", null);
    return { number: pr.number, url: pr.url };
  }

  async mergeStatus(repo: string, number: number, uuid: string): Promise<MergeResult> {
    const response = await this.client.rest<AsyncMerge>({
      path: `/repos/${repo}/pulls/${number}/merge-async/${uuid}`,
      priority: "interactive",
    });
    return toMergeResult(response.data);
  }

  async setAutoMerge(prId: string, method: MergeMethod | null, headOid: string): Promise<void> {
    if (method)
      await this.client.graphql(
        EnableAutoMergeMutation,
        { prId, method, head: headOid },
        "interactive",
      );
    else await this.client.graphql(DisableAutoMergeMutation, { prId }, "interactive");
  }

  async updateBranch(prId: string, rebase: boolean, headOid: string): Promise<void> {
    await this.client.graphql(
      UpdateBranchMutation,
      { prId, method: rebase ? "REBASE" : "MERGE", head: headOid },
      "interactive",
    );
  }

  async editMetadata(
    { id: prId, repo, number }: PrRef,
    field: MetadataField,
    change: { add: string[]; remove: string[] },
  ): Promise<void> {
    let { add } = change;
    const { remove } = change;
    if (field === "labels") {
      if (add.length > 0)
        await this.write("POST", `/repos/${repo}/issues/${number}/labels`, { labels: add });
      for (const name of remove) {
        // Already gone is what we wanted.
        await this.write(
          "DELETE",
          `/repos/${repo}/issues/${number}/labels/${encodeURIComponent(name)}`,
        ).catch((error: unknown) => {
          if (!(error instanceof GitHubError && error.kind === "not-found")) throw error;
        });
      }
      return;
    }
    if (field === "reviewers" && add.length > 0) {
      // By login, so people, teams and bots (Copilot) are asked in one write.
      await this.client.graphql(
        RequestReviewsMutation,
        {
          prId,
          users: add.filter((login) => !login.includes("/") && !login.startsWith("bot:")),
          teams: add.flatMap((login) => (login.includes("/") ? (login.split("/")[1] ?? []) : [])),
          bots: add.flatMap((login) => (login.startsWith("bot:") ? login.slice(4) : [])),
        },
        "interactive",
      );
      add = [];
    }
    const path =
      field === "assignees"
        ? `/repos/${repo}/issues/${number}/assignees`
        : `/repos/${repo}/pulls/${number}/requested_reviewers`;
    // Teams come through as "org/slug" and are requested by slug.
    const body = (logins: string[]) =>
      field === "assignees"
        ? { assignees: logins }
        : {
            reviewers: logins.flatMap((login) =>
              login.includes("/")
                ? []
                : login.startsWith("bot:")
                  ? `${login.slice(4)}[bot]`
                  : login,
            ),
            team_reviewers: logins.flatMap((login) => login.split("/")[1] ?? []),
          };
    if (add.length > 0) await this.write("POST", path, body(add));
    if (remove.length > 0) await this.write("DELETE", path, body(remove));
  }

  async setMilestone(repo: string, number: number, milestone: number | null): Promise<void> {
    await this.write("PATCH", `/repos/${repo}/issues/${number}`, { milestone });
  }

  async setDraft(prId: string, draft: boolean): Promise<void> {
    if (draft) await this.client.graphql(ConvertToDraftMutation, { prId }, "interactive");
    else await this.client.graphql(MarkReadyMutation, { prId }, "interactive");
  }

  async setOpen(prId: string, open: boolean): Promise<void> {
    if (open) await this.client.graphql(ReopenPrMutation, { prId }, "interactive");
    else await this.client.graphql(ClosePrMutation, { prId }, "interactive");
  }

  async repoLabels(repo: string): Promise<Label[]> {
    const labels = await this.paged<components["schemas"]["label"]>(`/repos/${repo}/labels`);
    return labels.map((l) => ({
      name: l.name,
      color: l.color,
      description: l.description ?? null,
    }));
  }

  async assignable(repo: string): Promise<Person[]> {
    const users = await this.paged<components["schemas"]["simple-user"]>(
      `/repos/${repo}/assignees`,
    );
    return users.map((u) => ({ login: u.login, avatarUrl: u.avatar_url }));
  }

  async milestones(repo: string): Promise<Milestone[]> {
    const milestones = await this.paged<components["schemas"]["milestone"]>(
      `/repos/${repo}/milestones?state=open&sort=due_on`,
    );
    return milestones.map((m) => ({ number: m.number, title: m.title, dueOn: m.due_on ?? null }));
  }

  async react(subjectId: string, content: ReactionContent, on: boolean): Promise<void> {
    if (on) await this.client.graphql(AddReactionMutation, { subjectId, content }, "interactive");
    else await this.client.graphql(RemoveReactionMutation, { subjectId, content }, "interactive");
  }

  async editWriting(subject: CommentSubject, id: string, body: string): Promise<void> {
    if (subject === "pull-request") await this.editPr(id, { body });
    else if (subject === "issue-comment")
      await this.client.graphql(UpdateIssueCommentMutation, { id, body }, "interactive");
    else if (subject === "review-comment")
      await this.client.graphql(UpdateReviewCommentMutation, { id, body }, "interactive");
    else await this.client.graphql(UpdateReviewMutation, { id, body }, "interactive");
  }

  async deleteComment(subject: "issue-comment" | "review-comment", id: string): Promise<void> {
    if (subject === "issue-comment")
      await this.client.graphql(DeleteIssueCommentMutation, { id }, "interactive");
    else await this.client.graphql(DeleteReviewCommentMutation, { id }, "interactive");
  }

  async minimize(id: string, reason: MinimizeReason | null): Promise<void> {
    if (reason)
      await this.client.graphql(MinimizeMutation, { id, classifier: reason }, "interactive");
    else await this.client.graphql(UnminimizeMutation, { id }, "interactive");
  }

  async editPr(
    prId: string,
    change: { title?: string; body?: string; base?: string },
  ): Promise<void> {
    await this.client.graphql(UpdatePrMutation, { prId, ...change }, "interactive");
  }

  async dismissReview(reviewId: string, message: string): Promise<void> {
    await this.client.graphql(DismissReviewMutation, { id: reviewId, message }, "interactive");
  }

  async setLocked(repo: string, number: number, reason: LockReason | null): Promise<void> {
    const path = `/repos/${repo}/issues/${number}/lock`;
    if (reason) await this.write("PUT", path, { lock_reason: reason });
    else await this.write("DELETE", path);
  }

  async branches(repo: string): Promise<string[]> {
    const branches = await this.paged<components["schemas"]["short-branch"]>(
      `/repos/${repo}/branches`,
    );
    return branches.map((b) => b.name);
  }

  async suggestedReviewers(prId: string): Promise<SuggestedReviewer[]> {
    const data = await this.client.graphql(SuggestedReviewersQuery, { prId }, "interactive");
    const actors =
      data.node && "suggestedReviewerActors" in data.node
        ? data.node.suggestedReviewerActors
        : null;
    return (actors?.nodes ?? []).flatMap((node) => {
      const reviewer = node?.reviewer;
      if (!reviewer || !("login" in reviewer)) return [];
      return [
        {
          login: reviewer.login,
          avatarUrl: reviewer.avatarUrl,
          bot: reviewer.__typename === "Bot",
        },
      ];
    });
  }

  async history(subjectId: string): Promise<Revision[]> {
    const data = await this.client.graphql(HistoryQuery, { id: subjectId }, "interactive");
    const edits = data.node && "userContentEdits" in data.node ? data.node.userContentEdits : null;
    return (edits?.nodes ?? []).flatMap((edit) =>
      edit
        ? [{ editedAt: edit.editedAt, editor: edit.editor?.login ?? null, body: edit.diff ?? "" }]
        : [],
    );
  }

  async releaseDate(repo: string, tag: string): Promise<string | null> {
    try {
      const response = await this.client.rest<components["schemas"]["release"]>({
        path: `/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
        cache: true,
      });
      return response.data.published_at ?? null;
    } catch (error) {
      if (!(error instanceof GitHubError && error.kind === "not-found")) throw error;
    }
    // Actions are often pinned to a moving major tag (`@v7`) that has no release of its own;
    // what it points at today is the newest release in that major line.
    const major = /^v?(\d+)$/.exec(tag)?.[1];
    if (!major) return null;
    const releases = await this.client.rest<components["schemas"]["release"][]>({
      path: `/repos/${repo}/releases?per_page=30`,
      cache: true,
    });
    const newest = releases.data.find(
      (r) => !r.draft && !r.prerelease && new RegExp(`^v?${major}(\\.|$)`).test(r.tag_name),
    );
    return newest?.published_at ?? null;
  }

  // -------------------------------------------------------------------------

  private async write(
    method: "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<void> {
    await this.client.rest({
      method,
      path,
      ...(body === undefined ? {} : { body }),
      priority: "interactive",
    });
  }

  /** Every page of a REST list (pickers want all of it), revalidated with ETags. */
  private async paged<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    let next: string | null = `${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    for (let page = 0; next && page < 10; page++) {
      const response: RestResponse<T[]> = await this.client.rest<T[]>({
        path: next,
        cache: true,
        priority: "interactive",
      });
      items.push(...response.data);
      next = nextLink(response.headers.get("link"));
    }
    return items;
  }

  private async searchPage(query: string, after: string | null) {
    const data = await this.client.graphql(SearchPullsQuery, { query, after });
    const hits = (data.search.nodes ?? []).filter(isPullHit);
    return {
      total: data.search.issueCount,
      hits,
      next: data.search.pageInfo.hasNextPage ? (data.search.pageInfo.endCursor ?? null) : null,
    };
  }

  private async collect(query: string, first: Awaited<ReturnType<LiveGitHub["searchPage"]>>) {
    const hits: SearchHit[] = [...first.hits];
    let next = first.next;
    while (next) {
      const page = await this.searchPage(query, next);
      hits.push(...page.hits);
      next = page.next;
    }
    return hits;
  }

  private async searchByDate(query: string, from: Date, to: Date): Promise<SearchHit[]> {
    const sliced = `${query} created:${day(from)}..${day(to)}`;
    const first = await this.searchPage(sliced, null);
    const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
    if (first.total <= SEARCH_CAP || spanDays < 1) return this.collect(sliced, first);
    const middle = new Date((from.getTime() + to.getTime()) / 2);
    const before = await this.searchByDate(query, from, middle);
    const after = await this.searchByDate(query, new Date(middle.getTime() + 86_400_000), to);
    return [...before, ...after];
  }
}

// Search results are a union of every searchable type; only PRs carry an `id` here.
function isPullHit(node: unknown): node is SearchHit {
  return typeof node === "object" && node !== null && "id" in node;
}

function toThread(thread: RestThread): NotificationThread {
  const number = /\/(?:pulls|issues)\/(\d+)$/.exec(thread.subject.url ?? "")?.[1];
  return {
    id: thread.id,
    reason: thread.reason,
    unread: thread.unread,
    updatedAt: thread.updated_at,
    repo: thread.repository.full_name,
    number: number ? Number(number) : null,
    type: thread.subject.type,
  };
}

function nextLink(link: string | null): string | null {
  const url = link
    ?.split(",")
    .find((part) => part.includes('rel="next"'))
    ?.match(/<([^>]+)>/)?.[1];
  return url ? url.replace("https://api.github.com", "") : null;
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * GitHub kills GraphQL requests that take over ten seconds (502/504), which a batch of PRs with
 * large release notes can. Halve the batch and try again, down to single PRs, before giving up.
 */
async function splitOnTimeout<I, O>(items: I[], run: (part: I[]) => Promise<O[]>): Promise<O[]> {
  try {
    return await run(items);
  } catch (error) {
    const timedOut =
      error instanceof GitHubError && (error.kind === "server" || error.kind === "network");
    if (!timedOut || items.length <= 1) throw error;
    const middle = Math.ceil(items.length / 2);
    return [
      ...(await splitOnTimeout(items.slice(0, middle), run)),
      ...(await splitOnTimeout(items.slice(middle), run)),
    ];
  }
}

/** The async merge API's answer: `{ status, details: { message, uuid? } }`. */
type AsyncMerge = { status: string; details?: { message?: string; uuid?: string } };

function toMergeResult(data: AsyncMerge): MergeResult {
  const known = ["merged", "enqueued", "pending", "failed"] as const;
  const status = known.find((s) => s === data.status) ?? "failed";
  return {
    status,
    message: data.details?.message ?? data.status,
    uuid: data.details?.uuid ?? null,
  };
}

function checkRunState(status: string, conclusion: string | null): CheckRunView["state"] {
  if (status !== "completed") return "pending";
  if (conclusion === "success") return "success";
  if (conclusion === "neutral") return "neutral";
  if (conclusion === "skipped" || conclusion === "stale") return "skipped";
  return "failure";
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function toDraftThread(thread: Extract<DraftThreadInput, { subject: "line" }>) {
  return {
    path: thread.path,
    line: thread.line,
    side: thread.side,
    startLine: thread.startLine ?? null,
    startSide: thread.startSide ?? null,
    body: thread.body,
  };
}

function toSummary(
  review:
    | { id: string; state: string; submittedAt?: string | null; commit?: { oid: string } | null }
    | null
    | undefined,
): ReviewSummary {
  if (!review) throw new GitHubError("review returned nothing", "graphql", null);
  return {
    id: review.id,
    state: review.state,
    commitOid: review.commit?.oid ?? null,
    submittedAt: review.submittedAt ?? null,
  };
}

function toDiffFile(file: RestFile): DiffFile {
  return {
    path: file.filename,
    previousPath: file.previous_filename ?? null,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch ?? null,
  };
}
