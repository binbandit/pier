import type { GitHubPort, ReviewEvent } from "@/github/port";
import type { PrDetail } from "@/github/pr-detail";
import type { CommandPayload, NewCommand, Outbox } from "@/outbox/outbox";
import type { Planner } from "@/outbox/planner";
import type { SyncEngine } from "@/sync/engine";
import type {
  CheckLog,
  CheckRunView,
  DiffRange,
  PrDiff,
  PrView,
  Side,
  Thread,
  ViewedState,
} from "@pier/core/wire";

import type { Details } from "./details";
import type { Drafts } from "./drafts";
import type { Model, PrRecord } from "./model";

// Everything the PR canvas reads and writes: the view of one PR (doc + detail + your drafts +
// writes still in flight), its diff, and the review actions. Writes all go through the outbox.

/** A submitted review waits this long before sending, so `z` can still take it back. */
const REVIEW_HOLD_MS = 5_000;

export type InterdiffSource = {
  interdiff(
    repo: string,
    account: string,
    versions: { oldBase: string; oldHead: string; newBase: string; newHead: string },
    options?: { ignoreWhitespace?: boolean },
  ): Promise<{ files: PrDiff["files"]; fallback: string | null }>;
  diff(
    repo: string,
    account: string,
    from: string,
    to: string,
    options?: { ignoreWhitespace?: boolean },
  ): Promise<PrDiff["files"]>;
};

export type ReviewDeps = {
  model: Model;
  ports: Map<string, GitHubPort>;
  outbox: Outbox;
  drafts: Drafts;
  details: Details;
  sync: SyncEngine;
  planner: Planner;
  /** The git store, once it's available; without it, diffs come from GitHub's patches. */
  git: () => InterdiffSource | null;
};

export class ReviewService {
  constructor(private readonly deps: ReviewDeps) {
    // Once GitHub accepts something we sent, our cached threads and drafts are out of date.
    deps.outbox.onAcked((command) => {
      deps.details.invalidate(command.prId, command.account);
      if (command.kind === "review" && command.payload.draftIds?.length) {
        deps.drafts.clear(command.prId, command.account, command.payload.draftIds);
      }
    });
  }

  find(repo: string, number: number): PrRecord | undefined {
    for (const record of this.deps.model.all()) {
      if (record.doc.repo === repo && record.doc.number === number) return record;
    }
    return undefined;
  }

  async view(repo: string, number: number): Promise<PrView | null> {
    const record = this.find(repo, number);
    if (!record) return null;
    const { doc } = record;
    const account = record.reader;
    const port = this.deps.ports.get(account);
    this.deps.sync.nudge([doc.id]);

    const [detail] = await Promise.all([
      this.detail(record),
      record.files === null && doc.filesTotal <= 3000 && port
        ? port
            .files(doc.repo, doc.number)
            .then((files) => this.deps.model.setFiles(doc.id, doc.headRefOid, files))
        : Promise.resolve(),
    ]);

    const pending = this.deps.outbox.pendingFor(doc.id);
    const review = record.viewers.get(account)?.latestReview;

    return {
      id: doc.id,
      repo: doc.repo,
      number: doc.number,
      title: doc.title,
      url: doc.url,
      body: doc.body,
      bodyHTML: detail?.bodyHTML ?? null,
      author: doc.author,
      state: doc.state,
      isDraft: doc.isDraft,
      baseRefName: doc.baseRefName,
      headRefName: doc.headRefName,
      headRefOid: doc.headRefOid,
      additions: doc.additions,
      deletions: doc.deletions,
      changedFiles: doc.changedFiles,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      checks: doc.checks,
      reviewDecision: doc.reviewDecision,
      mergeable: doc.mergeable,
      labels: doc.labels,
      reviewers: [
        ...doc.reviewRequests.map((r) => ({ login: r.login, kind: r.kind, state: "requested" })),
        ...doc.latestReviews.flatMap((r) =>
          r.author ? [{ login: r.author, kind: "user" as const, state: r.state }] : [],
        ),
      ],
      account,
      approvedByYou: review?.state === "APPROVED" && review.commitOid === doc.headRefOid,
      lastReviewedOid: detail?.viewerLatestReview?.commitOid ?? null,
      pending: this.deps.outbox.pending(doc.id),
      files: this.deps.model.get(doc.id)?.files ?? null,
      threads: (detail?.threads ?? []).map((thread): Thread => {
        const write = pending.find((p) => p.payload.threadId === thread.id);
        return {
          ...thread,
          resolved:
            write?.kind === "resolve"
              ? true
              : write?.kind === "unresolve"
                ? false
                : thread.resolved,
          pending: write
            ? { commandId: write.commandId, kind: write.kind, state: write.state, sendAt: "" }
            : null,
        };
      }),
      drafts: this.deps.drafts.list(doc.id, account),
      timeline: detail?.timeline ?? [],
      viewed: viewedState(detail, pending),
      pendingReviewId: detail?.pendingReview?.id ?? null,
      detailLoaded: detail !== null,
    };
  }

  async diff(
    repo: string,
    number: number,
    range: DiffRange,
    ignoreWhitespace: boolean,
  ): Promise<PrDiff | null> {
    const record = this.find(repo, number);
    if (!record) return null;
    const { doc } = record;
    const all = (fallback: string | null): PrDiff => ({
      range: "all",
      files: this.deps.model.get(doc.id)?.files ?? [],
      fallback,
      fromOid: null,
      toOid: doc.headRefOid,
    });

    const git = this.deps.git();
    if (range === "all" && !ignoreWhitespace) return all(null);
    if (!git)
      return all(
        range === "since-review"
          ? "Changes since your last review need the local git store, which isn't ready yet"
          : null,
      );

    const port = this.deps.ports.get(record.reader);
    if (!port) return all(null);
    const newBase = await port.mergeBase(doc.repo, doc.baseRefName, doc.headRefOid);
    if (!newBase) return all("GitHub couldn't find this PR's merge base");

    if (range === "all") {
      return {
        range,
        files: await git.diff(doc.repo, record.reader, newBase, doc.headRefOid, {
          ignoreWhitespace,
        }),
        fallback: null,
        fromOid: newBase,
        toOid: doc.headRefOid,
      };
    }

    const detail = await this.detail(record);
    const oldHead = detail?.viewerLatestReview?.commitOid ?? null;
    if (!oldHead) return all("You haven't reviewed this PR yet, so here is everything");
    if (oldHead === doc.headRefOid)
      return { range, files: [], fallback: null, fromOid: oldHead, toOid: doc.headRefOid };
    const oldBase = (await port.mergeBase(doc.repo, doc.baseRefName, oldHead)) ?? newBase;
    const result = await git.interdiff(
      doc.repo,
      record.reader,
      { oldBase, oldHead, newBase, newHead: doc.headRefOid },
      { ignoreWhitespace },
    );
    return {
      range,
      files: result.files,
      fallback: result.fallback,
      fromOid: oldHead,
      toOid: doc.headRefOid,
    };
  }

  saveDraft(input: {
    id?: string | undefined;
    prId: string;
    path: string;
    side: Side;
    line: number;
    startLine: number | null;
    body: string;
  }): string {
    const record = this.require(input.prId);
    return this.deps.drafts.save({
      ...input,
      account: record.reader,
      headOid: record.doc.headRefOid,
    });
  }

  deleteDraft(id: string): void {
    this.deps.drafts.delete(id);
  }

  /** Sends the review with every draft on this PR in one write, after a short undo window. */
  async submit(prId: string, event: ReviewEvent, body: string): Promise<string[]> {
    const record = this.require(prId);
    const { doc } = record;
    const drafts = this.deps.drafts.list(prId, record.reader);

    if (event !== "COMMENT" && doc.author?.login === record.reader) {
      throw new Error("You can't approve or request changes on your own PR");
    }
    if (event === "APPROVE") {
      const skip = this.deps.planner.guard(record, "approve");
      if (skip) throw new Error(skip);
    }
    if (event === "REQUEST_CHANGES" && !body.trim() && drafts.length === 0) {
      throw new Error("Say what needs to change, in the review or as inline comments");
    }
    const stale = drafts.filter((d) => d.headOid !== doc.headRefOid);
    if (stale.length > 0) {
      throw new Error(
        `${stale.length} of your comments were written before the latest push. Check they still point at the right lines, then save them again.`,
      );
    }
    const detail = await this.detail(record);
    if (detail?.pendingReview) {
      throw new Error(
        "You have a review in progress on github.com. Finish or discard it there first (Shift+O).",
      );
    }

    return this.enqueue(
      record,
      "review",
      {
        event,
        body,
        draftIds: drafts.map((d) => d.id),
        threads: drafts.map((d) => ({
          path: d.path,
          line: d.line,
          side: d.side,
          ...(d.startLine !== null && d.startLine !== d.line
            ? { startLine: d.startLine, startSide: d.side }
            : {}),
          body: d.body,
        })),
      },
      REVIEW_HOLD_MS,
    );
  }

  reply(prId: string, threadId: string, body: string): string[] {
    return this.enqueue(this.require(prId), "reply", { threadId, body }, 0);
  }

  resolve(prId: string, threadId: string, resolved: boolean): string[] {
    return this.enqueue(this.require(prId), resolved ? "resolve" : "unresolve", { threadId }, 0);
  }

  setViewed(prId: string, path: string, viewed: boolean): string[] {
    return this.enqueue(this.require(prId), viewed ? "viewed" : "unviewed", { path }, 0);
  }

  comment(prId: string, body: string): string[] {
    return this.enqueue(this.require(prId), "comment", { body }, 0);
  }

  async checks(repo: string, number: number): Promise<CheckRunView[]> {
    const record = this.find(repo, number);
    const port = record && this.deps.ports.get(record.reader);
    if (!record || !port) return [];
    return port.checkRuns(repo, record.doc.headRefOid);
  }

  async checkLog(repo: string, jobId: number): Promise<CheckLog | null> {
    const record = [...this.deps.model.all()].find((r) => r.doc.repo === repo);
    const port = record && this.deps.ports.get(record.reader);
    return port ? port.jobLog(repo, jobId) : null;
  }

  /** Re-runs the failed jobs of every failing Actions run on these PRs' heads. */
  async rerunFailed(prIds: string[]): Promise<{ commandIds: string[]; runs: number }> {
    const commandIds: string[] = [];
    let runs = 0;
    for (const prId of prIds) {
      const record = this.deps.model.get(prId);
      const port = record && this.deps.ports.get(record.reader);
      if (!record || !port) continue;
      const failing = (await port.checkRuns(record.doc.repo, record.doc.headRefOid)).filter(
        (run) => run.state === "failure" && run.runId !== null,
      );
      for (const runId of new Set(failing.map((run) => run.runId ?? 0))) {
        commandIds.push(...this.enqueue(record, "rerun-failed", { runId }, 0));
        runs++;
      }
      this.deps.sync.nudge([prId]);
    }
    return { commandIds, runs };
  }

  // -------------------------------------------------------------------------

  private require(prId: string): PrRecord {
    const record = this.deps.model.get(prId);
    if (!record) throw new Error("pier isn't tracking that PR");
    return record;
  }

  private enqueue(
    record: PrRecord,
    kind: NewCommand["kind"],
    payload: CommandPayload,
    holdMs: number,
  ): string[] {
    const { doc } = record;
    return this.deps.outbox.enqueue(
      [
        {
          planId: null,
          account: record.reader,
          kind,
          prId: doc.id,
          repo: doc.repo,
          number: doc.number,
          title: doc.title,
          expectedHead: doc.headRefOid,
          payload,
          priority: 0,
        },
      ],
      holdMs,
    );
  }

  /** Detail for the reading account, refetched when the PR's activity has moved on. */
  private async detail(record: PrRecord): Promise<PrDetail | null> {
    const { doc } = record;
    const account = record.reader;
    if (this.deps.details.isFresh(doc.id, account, doc.updatedAt)) {
      return this.deps.details.get(doc.id, account)?.detail ?? null;
    }
    const port = this.deps.ports.get(account);
    if (!port) return this.deps.details.get(doc.id, account)?.detail ?? null;
    try {
      const detail = await port.detail(doc.id);
      if (detail) this.deps.details.set(doc.id, account, detail, doc.updatedAt);
      return detail;
    } catch (error) {
      // Serve what we had; the status line already reports sync trouble.
      console.warn(`detail for ${doc.repo}#${doc.number}: ${String(error)}`);
      return this.deps.details.get(doc.id, account)?.detail ?? null;
    }
  }
}

function viewedState(
  detail: PrDetail | null,
  pending: ReturnType<Outbox["pendingFor"]>,
): Record<string, ViewedState> {
  const viewed: Record<string, ViewedState> = {};
  for (const [path, state] of Object.entries(detail?.viewed ?? {})) {
    viewed[path] = state === "VIEWED" ? "viewed" : state === "DISMISSED" ? "changed" : "unviewed";
  }
  for (const write of pending) {
    if (write.kind === "viewed" && write.payload.path) viewed[write.payload.path] = "viewed";
    if (write.kind === "unviewed" && write.payload.path) viewed[write.payload.path] = "unviewed";
  }
  return viewed;
}
