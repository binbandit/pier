import type { components } from "@octokit/openapi-types";

import type {
  CheckLog,
  CheckRunView,
  DiffFile,
  Label,
  MergeMethod,
  Milestone,
  Person,
} from "@pier/core/wire";

import type { GitHubTransport, RestResponse } from "./client";
import { GitHubError } from "./client";
import {
  ApproveMutation,
  ClosePrMutation,
  CommentMutation,
  ConvertToDraftMutation,
  CommentsByQuery,
  DisableAutoMergeMutation,
  EnableAutoMergeMutation,
  HydrateQuery,
  MarkReadyMutation,
  MarkViewedMutation,
  MergeInfoQuery,
  PrDetailQuery,
  ReopenPrMutation,
  ReplyMutation,
  ResolveThreadMutation,
  ReviewsByAuthorQuery,
  SearchPullsQuery,
  SubmitReviewMutation,
  SweepQuery,
  UnmarkViewedMutation,
  UnresolveThreadMutation,
  UpdateBranchMutation,
  ViewerQuery,
} from "./ops";
import type {
  GitHubPort,
  MergeInfo,
  MergeResult,
  MetadataField,
  NotificationPoll,
  NotificationThread,
  ReviewSummary,
  SearchHit,
  SubmitReviewInput,
} from "./port";
import { isDetailNode, toPrDetail } from "./pr-detail";
import { isHydrated, isSwept, toPrDoc, toVolatile } from "./pr-doc";

type RestThread = components["schemas"]["thread"];
type RestFile = components["schemas"]["diff-entry"];

const SEARCH_CAP = 1000;
/** Lines of a failing job's log worth showing; the cause is almost always near the end. */
const LOG_TAIL = 150;
const HYDRATE_BATCH = 25;
// 100 per query is allowed, but mergeability is computed on read and big batches hit GitHub's
// 10-second limit (502). 50 keeps each sweep well under it for the same point cost.
const SWEEP_BATCH = 50;

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

  async search(query: string): Promise<SearchHit[]> {
    const first = await this.searchPage(query, null);
    if (first.total <= SEARCH_CAP) return this.collect(query, first);
    // Past the cap, halve the creation-date range until every slice fits.
    return this.searchByDate(query, new Date("2008-01-01"), new Date());
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

  async files(repo: string, number: number): Promise<DiffFile[]> {
    const files: DiffFile[] = [];
    // GitHub caps this listing at 3,000 files; anything beyond is reached through the git store.
    for (let page = 1; page <= 30; page++) {
      const response = await this.client.rest<RestFile[]>({
        path: `/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
        cache: true,
      });
      files.push(
        ...response.data.map((file) => ({
          path: file.filename,
          previousPath: file.previous_filename ?? null,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch ?? null,
        })),
      );
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

  async fileText(repo: string, oid: string, path: string): Promise<string | null> {
    try {
      const response = await this.client.rest<components["schemas"]["content-file"]>({
        path: `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${oid}`,
        cache: true,
        priority: "interactive",
      });
      if (Array.isArray(response.data) || response.data.type !== "file") return null;
      return Buffer.from(response.data.content, "base64").toString("utf8");
    } catch (error) {
      if (error instanceof GitHubError && error.kind === "not-found") return null;
      throw error;
    }
  }

  async submitReview(input: SubmitReviewInput): Promise<ReviewSummary> {
    const data = await this.client.graphql(
      SubmitReviewMutation,
      {
        prId: input.prId,
        commit: input.commitOid,
        event: input.event,
        body: input.body || null,
        threads: input.threads.map((t) => ({
          path: t.path,
          line: t.line,
          side: t.side,
          startLine: t.startLine ?? null,
          startSide: t.startSide ?? null,
          body: t.body,
        })),
      },
      "interactive",
    );
    const review = data.addPullRequestReview?.pullRequestReview;
    if (!review) throw new GitHubError("review returned nothing", "graphql", null);
    return {
      id: review.id,
      state: review.state,
      commitOid: review.commit?.oid ?? null,
      submittedAt: review.submittedAt ?? null,
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

  async checkRuns(repo: string, oid: string): Promise<CheckRunView[]> {
    const response = await this.client.rest<{ check_runs: components["schemas"]["check-run"][] }>({
      path: `/repos/${repo}/commits/${oid}/check-runs?per_page=100&filter=latest`,
      cache: true,
      priority: "interactive",
    });
    return response.data.check_runs.map((run) => {
      // Actions checks link to their job: /owner/repo/actions/runs/<run>/job/<job>.
      const ids = /\/actions\/runs\/(\d+)\/job\/(\d+)/.exec(run.details_url ?? run.html_url ?? "");
      return {
        id: Number(run.id),
        name: run.name,
        state: checkRunState(run.status, run.conclusion),
        jobId: ids?.[2] ? Number(ids[2]) : null,
        runId: ids?.[1] ? Number(ids[1]) : null,
        url: run.html_url ?? run.details_url ?? "",
        startedAt: run.started_at ?? null,
        completedAt: run.completed_at ?? null,
      };
    });
  }

  async jobLog(repo: string, jobId: number): Promise<CheckLog | null> {
    // GitHub answers with a redirect to a short-lived storage URL, which must be fetched without
    // our token (it would be sent to a third-party host otherwise).
    const target = await this.client.location(`/repos/${repo}/actions/jobs/${jobId}/logs`);
    if (!target) return null;
    const response = await fetch(target, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return null;
    const all = (await response.text())
      .split("\n")
      .map((line) => line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, ""));
    const lines = all.slice(-LOG_TAIL);
    const errors = lines.flatMap((line, i) => (line.includes("##[error]") ? [i] : []));
    return {
      lines: lines.map((line) =>
        line.replace("##[error]", "").replace(/^##\[(group|endgroup|warning|notice)\]/, ""),
      ),
      errors,
      url: `https://github.com/${repo}/actions/runs/${jobId}`,
    };
  }

  async rerunFailedJobs(repo: string, runId: number): Promise<void> {
    await this.client.rest({
      method: "POST",
      path: `/repos/${repo}/actions/runs/${runId}/rerun-failed-jobs`,
      priority: "interactive",
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
    };
  }

  async merge(
    repo: string,
    number: number,
    input: { sha: string; method: MergeMethod; title?: string; message?: string },
  ): Promise<MergeResult> {
    const response = await this.client.rest<AsyncMerge>({
      method: "PUT",
      path: `/repos/${repo}/pulls/${number}/merge-async`,
      body: {
        sha: input.sha,
        merge_method: input.method.toLowerCase(),
        ...(input.title ? { commit_title: input.title } : {}),
        ...(input.message !== undefined ? { commit_message: input.message } : {}),
      },
      priority: "interactive",
    });
    return toMergeResult(response.data);
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
    repo: string,
    number: number,
    field: MetadataField,
    { add, remove }: { add: string[]; remove: string[] },
  ): Promise<void> {
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
    const path =
      field === "assignees"
        ? `/repos/${repo}/issues/${number}/assignees`
        : `/repos/${repo}/pulls/${number}/requested_reviewers`;
    // Teams come through as "org/slug" and are requested by slug.
    const body = (logins: string[]) =>
      field === "assignees"
        ? { assignees: logins }
        : {
            reviewers: logins.filter((login) => !login.includes("/")),
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
    method: "POST" | "PATCH" | "DELETE",
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
