import type { DraftThreadInput, GitHubPort, MetadataField, ReviewEvent } from "@/github/port";
import type { PrDetail } from "@/github/pr-detail";
import type { CommandPayload, NewCommand, Outbox } from "@/outbox/outbox";
import type { Planner } from "@/outbox/planner";
import type { SyncEngine } from "@/sync/engine";
import type {
  Annotation,
  CheckLog,
  ChecksView,
  CommentSubject,
  DiffView,
  Label,
  LockReason,
  MergeMethod,
  Milestone,
  MinimizeReason,
  Person,
  PrDiff,
  PrView,
  ReactionContent,
  Revision,
  Runway,
  SuggestedReviewer,
  Side,
  Thread,
  ViewedState,
} from "@pier/core/wire";

import { overlayConversation } from "./conversation";
import type { Details } from "./details";
import type { Drafts } from "./drafts";
import { overlayMetadata, type RepoKnown } from "./metadata";
import type { Model, PrRecord } from "./model";
import { buildRunway } from "./runway";

// Everything the PR canvas reads and writes: the view of one PR (doc + detail + your drafts +
// writes still in flight), its diff, and the review actions. Writes all go through the outbox.

/** A submitted review waits this long before sending, so `z` can still take it back. */
const REVIEW_HOLD_MS = 5_000;
/** Merges hold the same way: once one goes through it can only be reverted. */
const MERGE_HOLD_MS = 5_000;
/** Closing too: it notifies everyone on the PR. So does deleting a comment, which can't come back. */
const CLOSE_HOLD_MS = 5_000;

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
  conflicts(
    repo: string,
    account: string,
    commits: { mergeBase: string; base: string; head: string },
  ): Promise<string[]>;
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
  /** Per repo, what its pickers last returned. */
  private readonly known = new Map<string, RepoKnown>();
  /** PRs looked up by number and not found, with when. */
  private readonly misses = new Map<string, number>();

  constructor(private readonly deps: ReviewDeps) {
    // Once GitHub accepts something we sent, our cached threads and drafts are out of date.
    deps.outbox.onAcked((command) => {
      deps.details.invalidate(command.prId, command.account);
      if (command.kind === "review" && command.payload.draftIds?.length) {
        deps.drafts.clear(command.prId, command.account, command.payload.draftIds);
      }
    });
  }

  /**
   * Starts tracking a PR none of your searches found (a pasted link, a revert pier just opened),
   * through the first account that can see it. Misses are remembered for a minute.
   */
  private async track(repo: string, number: number): Promise<PrRecord | undefined> {
    const key = `${repo}#${number}`;
    if ((this.misses.get(key) ?? 0) > Date.now() - 60_000) return undefined;
    for (const [login, port] of this.deps.ports) {
      const id = await port.prId(repo, number).catch(() => null);
      if (!id) continue;
      const [read] = await port.hydrate([id]);
      if (!read) continue;
      this.deps.model.upsert(read.doc, read.viewer, login);
      this.deps.model.addScope(id, login, "opened");
      return this.deps.model.get(id);
    }
    this.misses.set(key, Date.now());
    return undefined;
  }

  private knownFor(repo: string): RepoKnown {
    return this.known.get(repo) ?? { labels: [], people: [], milestones: [] };
  }

  /** Repo-level reads go through whichever account reads that repo's PRs. */
  private portForRepo(repo: string): GitHubPort | undefined {
    for (const record of this.deps.model.all()) {
      if (record.doc.repo === repo) return this.deps.ports.get(record.reader);
    }
    return undefined;
  }

  find(repo: string, number: number): PrRecord | undefined {
    for (const record of this.deps.model.all()) {
      if (record.doc.repo === repo && record.doc.number === number) return record;
    }
    return undefined;
  }

  async view(repo: string, number: number): Promise<PrView | null> {
    const record = this.find(repo, number) ?? (await this.track(repo, number));
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
    // Writes GitHub accepted stay laid over the doc until a read after them, and for half a
    // minute regardless: GitHub's reads can trail its writes, so the first re-read may not show
    // them yet. These edits are idempotent sets, so overlapping GitHub's own copy is harmless.
    const settling = new Date(Date.now() - 30_000).toISOString();
    const meta = overlayMetadata(
      doc,
      [
        ...this.deps.outbox.ackedSince(
          doc.id,
          settling < record.fetchedAt ? settling : record.fetchedAt,
        ),
        ...pending,
      ],
      this.knownFor(doc.repo),
    );

    const canWrite = ["ADMIN", "MAINTAIN", "WRITE"].includes(doc.viewerPermission ?? "");
    const view: PrView = {
      id: doc.id,
      repo: doc.repo,
      number: doc.number,
      title: doc.title,
      url: doc.url,
      body: doc.body,
      bodyHTML: detail?.bodyHTML ?? null,
      reactions: detail?.reactions ?? [],
      canEdit: detail?.canEdit ?? false,
      locked: detail?.locked ?? null,
      author: doc.author,
      state: doc.state,
      isDraft: meta.isDraft,
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
      labels: meta.labels,
      // Someone asked again after reviewing shows as requested, not with their old verdict.
      reviewers: [
        ...meta.requested.map((key) => ({
          login: key.startsWith("bot:") ? key.slice(4) : key,
          kind: key.startsWith("bot:")
            ? ("bot" as const)
            : key.includes("/")
              ? ("team" as const)
              : ("user" as const),
          state: "requested",
        })),
        ...doc.latestReviews.flatMap((r) =>
          r.author && !meta.requested.includes(r.author)
            ? [{ login: r.author, kind: "user" as const, state: r.state }]
            : [],
        ),
      ],
      assignees: meta.assignees,
      milestone: meta.milestone,
      linkedIssues: detail?.linkedIssues ?? [],
      requiredChecks: detail?.requiredChecks ?? [],
      commits: detail?.commits ?? [],
      // A deleted branch can come back once the PR is closed or merged, from its last head.
      headBranch: {
        exists: detail?.headBranch.exists ?? true,
        canDelete: detail?.headBranch.canDelete ?? false,
        canRestore:
          detail !== null &&
          !detail.headBranch.exists &&
          !detail.headBranch.crossRepo &&
          canWrite &&
          doc.state !== "OPEN",
      },
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
      // Someone else's approval or change request can be dismissed by anyone who can write.
      timeline: (detail?.timeline ?? []).map((entry) =>
        entry.kind === "review"
          ? {
              ...entry,
              canDismiss:
                canWrite &&
                entry.author?.login !== account &&
                (entry.state === "APPROVED" || entry.state === "CHANGES_REQUESTED"),
            }
          : entry,
      ),
      viewed: viewedState(detail, pending),
      pendingReview: detail?.pendingReview ?? null,
      detailLoaded: detail !== null,
    };
    return overlayConversation(view, pending);
  }

  async diff(
    repo: string,
    number: number,
    view: DiffView,
    ignoreWhitespace: boolean,
  ): Promise<PrDiff | null> {
    const record = this.find(repo, number);
    if (!record) return null;
    const { doc } = record;
    const { range } = view;
    const all = (fallback: string | null): PrDiff => ({
      range: "all",
      files: this.deps.model.get(doc.id)?.files ?? [],
      fallback,
      fromOid: null,
      toOid: doc.headRefOid,
    });

    const git = this.deps.git();
    if (view.range === "commits") {
      const port = this.deps.ports.get(record.reader);
      // A run of commits did what lies between the first one's parent and the last one.
      const parent = await port?.commitParent(doc.repo, view.from);
      if (!port || !parent) return all("GitHub couldn't find the commit before these ones");
      return {
        range,
        files: git
          ? await git.diff(doc.repo, record.reader, parent, view.to, { ignoreWhitespace })
          : await port.compareFiles(doc.repo, parent, view.to),
        fallback: null,
        fromOid: parent,
        toOid: view.to,
      };
    }
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
    line: number | null;
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
    // A comment on a whole file can't land on the wrong line, so only line comments go stale.
    const stale = drafts.filter((d) => d.line !== null && d.headOid !== doc.headRefOid);
    if (stale.length > 0) {
      throw new Error(
        `${stale.length} of your comments were written before the latest push. Check they still point at the right lines, then save them again.`,
      );
    }

    // A review you started on github.com is continued, not duplicated (see submitReview).
    return this.enqueue(
      record,
      "review",
      {
        event,
        body,
        draftIds: drafts.map((d) => d.id),
        threads: drafts.map((d): DraftThreadInput =>
          d.line === null
            ? { subject: "file", path: d.path, body: d.body }
            : {
                subject: "line",
                path: d.path,
                line: d.line,
                side: d.side,
                ...(d.startLine !== null && d.startLine !== d.line
                  ? { startLine: d.startLine, startSide: d.side }
                  : {}),
                body: d.body,
              },
        ),
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

  async checks(repo: string, number: number): Promise<ChecksView> {
    const record = this.find(repo, number);
    const port = record && this.deps.ports.get(record.reader);
    if (!record || !port) return { runs: [], workflows: [], deployments: [] };
    return port.checks(repo, record.doc.headRefOid);
  }

  /** What the head's checks left on the code, for showing on the lines they point at. */
  async annotations(repo: string, number: number): Promise<Annotation[]> {
    const record = this.find(repo, number);
    const port = record && this.deps.ports.get(record.reader);
    if (!record || !port) return [];
    const { runs } = await port.checks(repo, record.doc.headRefOid);
    const annotated = runs.filter((run) => run.kind === "check" && run.annotations > 0);
    return annotated.length > 0 ? port.annotations(repo, annotated.slice(0, 20)) : [];
  }

  /** Re-runs, cancels and approvals on a PR's workflow runs. */
  runAction(
    prId: string,
    action: "rerun-all" | "rerun-job" | "cancel-run" | "approve-run" | "approve-deployment",
    target: { runId?: number; jobId?: number; environmentIds?: number[]; debug?: boolean },
  ): string[] {
    const record = this.require(prId);
    this.deps.sync.nudge([prId]);
    return this.enqueue(record, action, target, 0);
  }

  async checkLog(repo: string, jobId: number): Promise<CheckLog | null> {
    return (await this.portForRepo(repo)?.jobLog(repo, jobId)) ?? null;
  }

  async runway(repo: string, number: number): Promise<Runway | null> {
    const record = this.find(repo, number);
    const port = record && this.deps.ports.get(record.reader);
    if (!record || !port) return null;
    const info = await port.mergeInfo(record.doc.id);
    if (!info) return null;
    return buildRunway(record.doc, info, await this.conflictingFiles(record, info.mergeable));
  }

  /** Which files conflict, worked out locally, so a conflict says where it is. */
  private async conflictingFiles(record: PrRecord, mergeable: string): Promise<string[]> {
    const git = this.deps.git();
    const port = this.deps.ports.get(record.reader);
    if (mergeable !== "CONFLICTING" || !git || !port) return [];
    const { doc } = record;
    try {
      const mergeBase = await port.mergeBase(doc.repo, doc.baseRefOid, doc.headRefOid);
      if (!mergeBase) return [];
      return await git.conflicts(doc.repo, record.reader, {
        mergeBase,
        base: doc.baseRefOid,
        head: doc.headRefOid,
      });
    } catch (error) {
      console.warn(`conflicts for ${doc.repo}#${doc.number}: ${String(error)}`);
      return [];
    }
  }

  /** Merges after a short undo window, for the head commit on screen. */
  merge(
    prId: string,
    method: MergeMethod,
    headline: string | undefined,
    body: string | undefined,
    bypass = false,
  ): string[] {
    return this.enqueue(
      this.require(prId),
      "merge",
      {
        method,
        ...(headline ? { headline } : {}),
        ...(body !== undefined ? { body } : {}),
        ...(bypass ? { bypass } : {}),
      },
      MERGE_HOLD_MS,
    );
  }

  /** Adds to (or jumps) the merge queue, or takes it back out. */
  queue(prId: string, action: "add" | "jump" | "remove"): string[] {
    const record = this.require(prId);
    return action === "remove"
      ? this.enqueue(record, "dequeue", {}, 0)
      : this.enqueue(record, "enqueue", { jump: action === "jump" }, 0);
  }

  /** Deletes the head branch, or brings it back at the PR's last head. */
  branch(prId: string, action: "delete" | "restore"): string[] {
    const record = this.require(prId);
    const branch = record.doc.headRefName;
    return this.enqueue(
      record,
      action === "delete" ? "delete-branch" : "restore-branch",
      { branch },
      0,
    );
  }

  /** Opens a PR that reverts this merged one; its number comes back as the command's result. */
  revert(prId: string, title: string | undefined, body: string | undefined): string[] {
    return this.enqueue(
      this.require(prId),
      "revert",
      { ...(title ? { title } : {}), ...(body !== undefined ? { body } : {}) },
      0,
    );
  }

  setAutoMerge(prId: string, enabled: boolean, method: MergeMethod | undefined): string[] {
    return this.enqueue(
      this.require(prId),
      "auto-merge",
      { enabled, ...(method ? { method } : {}) },
      0,
    );
  }

  updateBranch(prId: string, rebase: boolean): string[] {
    return this.enqueue(this.require(prId), "update-branch", { rebase }, 0);
  }

  editMetadata(prId: string, field: MetadataField, add: string[], remove: string[]): string[] {
    return this.enqueue(this.require(prId), field, { add, remove }, 0);
  }

  setMilestone(prId: string, milestone: number | null): string[] {
    return this.enqueue(this.require(prId), "milestone", { milestone }, 0);
  }

  setDraft(prId: string, draft: boolean): string[] {
    return this.enqueue(this.require(prId), "draft", { draft }, 0);
  }

  /** Closing waits out an undo window like merging; reopening goes straight away. */
  setOpen(prId: string, open: boolean): string[] {
    const record = this.require(prId);
    return open
      ? this.enqueue(record, "reopen", {}, 0)
      : this.enqueue(record, "close", {}, CLOSE_HOLD_MS);
  }

  react(prId: string, subjectId: string, content: ReactionContent, on: boolean): string[] {
    return this.enqueue(this.require(prId), "react", { subjectId, content, on }, 0);
  }

  editWriting(prId: string, subject: CommentSubject, subjectId: string, body: string): string[] {
    return this.enqueue(this.require(prId), "edit-comment", { subject, subjectId, body }, 0);
  }

  deleteComment(
    prId: string,
    subject: "issue-comment" | "review-comment",
    subjectId: string,
  ): string[] {
    return this.enqueue(
      this.require(prId),
      "delete-comment",
      { subject, subjectId },
      CLOSE_HOLD_MS,
    );
  }

  minimize(prId: string, subjectId: string, reason: MinimizeReason | null): string[] {
    return this.enqueue(this.require(prId), "minimize", { subjectId, reason }, 0);
  }

  editPr(prId: string, change: { title?: string; base?: string }): string[] {
    return this.enqueue(this.require(prId), "edit-pr", change, 0);
  }

  dismissReview(prId: string, reviewId: string, message: string): string[] {
    return this.enqueue(
      this.require(prId),
      "dismiss-review",
      { subjectId: reviewId, body: message },
      0,
    );
  }

  setLocked(prId: string, reason: LockReason | null): string[] {
    return this.enqueue(this.require(prId), "lock", { lockReason: reason }, 0);
  }

  async suggestedReviewers(prId: string): Promise<SuggestedReviewer[]> {
    const port = this.deps.ports.get(this.require(prId).reader);
    return port ? port.suggestedReviewers(prId) : [];
  }

  async history(prId: string, subjectId: string): Promise<Revision[]> {
    const port = this.deps.ports.get(this.require(prId).reader);
    return port ? port.history(subjectId) : [];
  }

  async branches(repo: string): Promise<string[]> {
    return (await this.portForRepo(repo)?.branches(repo)) ?? [];
  }

  async repoLabels(repo: string): Promise<Label[]> {
    const labels = (await this.portForRepo(repo)?.repoLabels(repo)) ?? [];
    this.known.set(repo, { ...this.knownFor(repo), labels });
    return labels;
  }

  async assignable(repo: string): Promise<Person[]> {
    const people = (await this.portForRepo(repo)?.assignable(repo)) ?? [];
    this.known.set(repo, { ...this.knownFor(repo), people });
    return people;
  }

  async milestones(repo: string): Promise<Milestone[]> {
    const milestones = (await this.portForRepo(repo)?.milestones(repo)) ?? [];
    this.known.set(repo, { ...this.knownFor(repo), milestones });
    return milestones;
  }

  /** Re-runs the failed jobs of every failing Actions run on these PRs' heads. */
  async rerunFailed(
    prIds: string[],
    debug = false,
  ): Promise<{ commandIds: string[]; runs: number }> {
    const commandIds: string[] = [];
    let runs = 0;
    for (const prId of prIds) {
      const record = this.deps.model.get(prId);
      const port = record && this.deps.ports.get(record.reader);
      if (!record || !port) continue;
      const { runs: checks } = await port.checks(record.doc.repo, record.doc.headRefOid);
      const failing = checks.filter((run) => run.state === "failure" && run.runId !== null);
      for (const runId of new Set(failing.map((run) => run.runId ?? 0))) {
        commandIds.push(...this.enqueue(record, "rerun-failed", { runId, debug }, 0));
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
