import type { Database } from "bun:sqlite";

import { GitHubError } from "@/github/client";
import type { DraftThreadInput, GitHubPort, ReviewEvent } from "@/github/port";
import type {
  CommandKind,
  CommentSubject,
  LockReason,
  LogEntry,
  MergeMethod,
  MinimizeReason,
  OutboxState,
  PendingWrite,
  ReactionContent,
  Subscription,
} from "@pier/core/wire";

// Every write to GitHub is a persisted command. Its lifecycle:
//
//   waiting ──(the PR before it in the same repo merged)──▶ queued
//   held ──(undo window passes)──▶ queued ──▶ claimed ──▶ acked
//     │                              │           │
//     └──────── cancelled ◀──────────┘           ├──▶ failed   (GitHub said no)
//                                                └──▶ unknown  (crash or timeout mid-send)
//
// `claimed` is written to disk before the request goes out, so a crash can never cause a
// silent double-send: on restart, claimed commands become `unknown` and are resolved by reading
// GitHub (did the approval land?) rather than by retrying blindly.

export type CommandPayload = {
  body?: string;
  event?: ReviewEvent;
  threads?: DraftThreadInput[];
  /** Drafts this review carries; cleared once GitHub accepts it. */
  draftIds?: string[];
  threadId?: string;
  path?: string;
  /** The bumps an approval decided on, so a waiting one can check a rebase didn't change them. */
  bumpKeys?: string[];
  /** The Actions run (or job) to re-run, cancel or approve. */
  runId?: number;
  jobId?: number;
  /** Environments whose deployment is being approved. */
  environmentIds?: number[];
  /** Re-run with debug logging on. */
  debug?: boolean;
  /** Merge straight past the rules, as an admin who confirmed it. */
  bypass?: boolean;
  /** Jump to the front of the merge queue. */
  jump?: boolean;
  /** The head branch to delete or restore. */
  branch?: string;
  method?: MergeMethod;
  /** Merge commit title; `body` is its message. */
  headline?: string;
  /** Auto-merge on (true) or off (false). */
  enabled?: boolean;
  /** Update the branch by rebasing instead of merging the base in. */
  rebase?: boolean;
  /** Label names, or logins for assignees and reviewers. */
  add?: string[];
  remove?: string[];
  /** The milestone number, or null to clear it. */
  milestone?: number | null;
  /** To draft (true) or ready for review (false). */
  draft?: boolean;
  /** The comment, review or PR a reaction, edit, delete, hide or dismissal is about. */
  subjectId?: string;
  subject?: CommentSubject;
  content?: ReactionContent;
  /** Add the reaction (true) or take it back (false). */
  on?: boolean;
  /** Why to hide a comment; null shows it again. */
  reason?: MinimizeReason | null;
  title?: string;
  base?: string;
  lockReason?: LockReason | null;
  /** Whole new contents of the files suggestions change, the threads they came from, and the
   * repo the head branch lives in (a fork's, for a PR from one). */
  files?: { path: string; contents: string }[];
  subscription?: Subscription;
  threadIds?: string[];
  headRepo?: string;
};

/** Kinds that create content on GitHub and so count against its 500-per-hour limit. */
const CONTENT_KINDS = new Set<CommandKind>([
  "approve",
  "suggestions",
  "review",
  "reply",
  "comment",
  "bot-command",
  "react",
]);

export type Command = {
  id: string;
  planId: string | null;
  account: string;
  kind: CommandKind;
  prId: string;
  repo: string;
  number: number;
  title: string;
  expectedHead: string;
  payload: CommandPayload;
  state: OutboxState;
  /** 0 = something Brayden did to one PR, 1 = part of a bulk sweep. */
  priority: 0 | 1;
  /** Held back until this PR (same repo) merges, so automation merges one at a time. */
  afterPr: string | null;
  sendAt: string;
  claimedAt: string | null;
  attempts: number;
  detail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewCommand = Pick<
  Command,
  | "planId"
  | "account"
  | "kind"
  | "prId"
  | "repo"
  | "number"
  | "title"
  | "expectedHead"
  | "payload"
  | "priority"
> & { afterPr?: string | null };

/** Pacing per account. GitHub allows 80 content-creating writes/min and 500/hr, shared with the web UI. */
export const LIMITS = {
  minGapMs: 1_000,
  perMinute: 60,
  bulkPerHour: 350,
  totalPerHour: 450,
} as const;

export type Preflight = (
  command: Command,
) => { ok: true } | { ok: false; state: "failed" | "cancelled"; detail: string };

/** What to do with a waiting command now: keep waiting, send it (maybe at a new head), or stop. */
export type Release = (
  command: Command,
  predecessor: OutboxState | null,
) =>
  | { action: "wait" }
  | { action: "queue"; expectedHead: string; detail: string | null }
  | { action: "stop"; state: "failed" | "cancelled"; detail: string };

type Row = {
  id: string;
  plan_id: string | null;
  account: string;
  kind: CommandKind;
  pr_id: string;
  repo: string;
  number: number;
  title: string;
  expected_head: string;
  payload: string;
  state: OutboxState;
  priority: 0 | 1;
  after_pr: string | null;
  send_at: string;
  claimed_at: string | null;
  attempts: number;
  detail: string | null;
  created_at: string;
  updated_at: string;
};

export class Outbox {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = new Set<string>();
  private pausedUntil = new Map<string, number>();
  private listeners = new Set<(prIds: string[]) => void>();
  private ackListeners = new Set<(command: Command) => void>();
  version = 0;

  constructor(
    private readonly db: Database,
    private readonly ports: () => Map<string, GitHubPort>,
    private readonly preflight: Preflight,
    private readonly release: Release = () => ({ action: "wait" }),
  ) {}

  onChange(listener: (prIds: string[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called after GitHub accepts a write (including ones confirmed by a probe). */
  onAcked(listener: (command: Command) => void): () => void {
    this.ackListeners.add(listener);
    return () => this.ackListeners.delete(listener);
  }

  enqueue(commands: NewCommand[], holdMs: number): string[] {
    const now = Date.now();
    const ids: string[] = [];
    this.db.transaction(() => {
      for (const command of commands) {
        const id = crypto.randomUUID();
        ids.push(id);
        this.db
          .query(
            `INSERT INTO outbox (id, plan_id, account, kind, pr_id, repo, number, title, expected_head, payload,
               state, priority, after_pr, send_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            command.planId,
            command.account,
            command.kind,
            command.prId,
            command.repo,
            command.number,
            command.title,
            command.expectedHead,
            JSON.stringify(command.payload),
            command.afterPr ? "waiting" : holdMs > 0 ? "held" : "queued",
            command.priority,
            command.afterPr ?? null,
            new Date(now + holdMs).toISOString(),
            new Date(now).toISOString(),
            new Date(now).toISOString(),
          );
      }
    })();
    this.changed(commands.map((c) => c.prId));
    return ids;
  }

  /** Undo: anything not yet sent can be cancelled. Returns how many were. */
  cancel(ids: string[]): number {
    const affected: string[] = [];
    this.db.transaction(() => {
      for (const id of ids) {
        const row = this.db
          .query<{ pr_id: string }, [string, string]>(
            `UPDATE outbox SET state = 'cancelled', detail = 'Cancelled', updated_at = ?
             WHERE id = ? AND state IN ('waiting', 'held', 'queued') RETURNING pr_id`,
          )
          .get(new Date().toISOString(), id);
        if (row) affected.push(row.pr_id);
      }
    })();
    if (affected.length > 0) this.changed(affected);
    return affected.length;
  }

  /** The newest unresolved write for a PR, shown as a pending marker on its row. */
  pending(prId: string): PendingWrite | null {
    const row = this.db
      .query<Pick<Row, "id" | "kind" | "state" | "send_at">, [string]>(
        `SELECT id, kind, state, send_at FROM outbox
         WHERE pr_id = ? AND state IN ('waiting', 'held', 'queued', 'claimed', 'unknown')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(prId);
    return row
      ? { commandId: row.id, kind: row.kind, state: row.state, sendAt: row.send_at }
      : null;
  }

  /**
   * Writes that GitHub accepted after `since` (when the PR was last read), so a change stays on
   * screen between its ack and the next read instead of flicking back.
   */
  ackedSince(prId: string, since: string): { kind: CommandKind; payload: CommandPayload }[] {
    // A fresh read lands within seconds of an ack, so never look further back than ten minutes.
    const floor = new Date(Date.now() - 10 * 60_000).toISOString();
    return this.db
      .query<{ kind: CommandKind; payload: string }, [string, string]>(
        `SELECT kind, payload FROM outbox
         WHERE pr_id = ? AND state = 'acked' AND updated_at > ? ORDER BY created_at`,
      )
      .all(prId, since > floor ? since : floor)
      .map((row) => ({ kind: row.kind, payload: JSON.parse(row.payload) as CommandPayload }));
  }

  /** How one write went, and what GitHub answered. */
  result(commandId: string): { state: OutboxState; detail: string | null; result: unknown } | null {
    const row = this.db
      .query<{ state: OutboxState; detail: string | null; result: string | null }, [string]>(
        "SELECT state, detail, result FROM outbox WHERE id = ?",
      )
      .get(commandId);
    if (!row) return null;
    return {
      state: row.state,
      detail: row.detail,
      result: row.result === null ? null : (JSON.parse(row.result) as unknown),
    };
  }

  /** Unresolved writes for one PR, for showing pending replies, resolves and viewed marks. */
  pendingFor(
    prId: string,
  ): { commandId: string; kind: CommandKind; state: OutboxState; payload: CommandPayload }[] {
    return this.db
      .query<{ id: string; kind: CommandKind; state: OutboxState; payload: string }, [string]>(
        `SELECT id, kind, state, payload FROM outbox
         WHERE pr_id = ? AND state IN ('waiting', 'held', 'queued', 'claimed', 'unknown') ORDER BY created_at`,
      )
      .all(prId)
      .map((row) => ({
        commandId: row.id,
        kind: row.kind,
        state: row.state,
        payload: JSON.parse(row.payload) as CommandPayload,
      }));
  }

  /**
   * Approvals on their way, plus ones that just landed (until the next sync shows them). A landed
   * approval only counts for the commit it approved: once the bot rebases, the PR needs one again.
   */
  approving(): { has(prId: string, headOid: string): boolean } {
    const rows = this.db
      .query<{ pr_id: string; state: OutboxState; expected_head: string }, [string]>(
        `SELECT pr_id, state, expected_head FROM outbox WHERE kind = 'approve'
         AND (state IN ('waiting', 'held', 'queued', 'claimed', 'unknown') OR (state = 'acked' AND updated_at > ?))`,
      )
      .all(new Date(Date.now() - 10 * 60_000).toISOString());
    const pending = new Set(rows.filter((r) => r.state !== "acked").map((r) => r.pr_id));
    const landed = new Set(
      rows.filter((r) => r.state === "acked").map((r) => `${r.pr_id}@${r.expected_head}`),
    );
    return { has: (prId, headOid) => pending.has(prId) || landed.has(`${prId}@${headOid}`) };
  }

  log(limit = 100): LogEntry[] {
    return (
      this.db
        // Marking notifications read happens on every PR you open; it's housekeeping, not news.
        .query<Row, [number]>(
          "SELECT * FROM outbox WHERE kind != 'notification-read' ORDER BY created_at DESC LIMIT ?",
        )
        .all(limit)
        .map((row) => ({
          commandId: row.id,
          kind: row.kind,
          account: row.account,
          target: { repo: row.repo, number: row.number, title: row.title },
          state: row.state,
          detail: row.detail,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }))
    );
  }

  /** How many writes are in each state; failures only count once they're newer than `seenAt`. */
  counts(seenAt: string) {
    const rows = this.db
      .query<{ state: OutboxState; n: number }, [string]>(
        "SELECT state, count(*) AS n FROM outbox WHERE kind != 'notification-read' AND (state != 'failed' OR updated_at > ?) GROUP BY state",
      )
      .all(seenAt);
    const by = Object.fromEntries(rows.map((r) => [r.state, r.n]));
    return {
      queued: (by.queued ?? 0) + (by.claimed ?? 0),
      held: by.held ?? 0,
      waiting: by.waiting ?? 0,
      failed: by.failed ?? 0,
      unknown: by.unknown ?? 0,
    };
  }

  writesSince(account: string, sinceMs: number): number {
    const row = this.db
      .query<{ n: number }, [string, string]>(
        "SELECT count(*) AS n FROM write_ledger WHERE account = ? AND at > ?",
      )
      .get(account, new Date(Date.now() - sinceMs).toISOString());
    return row?.n ?? 0;
  }

  start(): void {
    this.recover();
    this.timer ??= setInterval(() => void this.tick(), 250);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // -------------------------------------------------------------------------

  /** A previous run may have died mid-send. Those writes are unknown until GitHub says otherwise. */
  private recover(): void {
    const rows = this.db
      .query<{ pr_id: string }, [string]>(
        "UPDATE outbox SET state = 'unknown', detail = 'Interrupted while sending; checking GitHub', updated_at = ? WHERE state = 'claimed' RETURNING pr_id",
      )
      .all(new Date().toISOString());
    if (rows.length > 0) this.changed(rows.map((r) => r.pr_id));
  }

  private async tick(): Promise<void> {
    const nowIso = new Date().toISOString();
    const released = this.db
      .query<{ pr_id: string }, [string, string]>(
        "UPDATE outbox SET state = 'queued', updated_at = ? WHERE state = 'held' AND send_at <= ? RETURNING pr_id",
      )
      .all(nowIso, nowIso);
    if (released.length > 0) this.changed(released.map((r) => r.pr_id));
    this.releaseWaiting();

    for (const [account, port] of this.ports()) {
      if (this.busy.has(account)) continue;
      if ((this.pausedUntil.get(account) ?? 0) > Date.now()) continue;
      const unknown = this.next(account, "unknown");
      if (unknown) {
        void this.run(account, () => this.probe(port, unknown));
        continue;
      }
      const command = this.next(account, "queued");
      if (command && this.allowed(account, command.priority)) {
        void this.run(account, () => this.dispatch(port, command));
      }
    }
  }

  /** Lets waiting approvals go once the PR ahead of them in the same repo has merged. */
  private releaseWaiting(): void {
    const waiting = this.db.query<Row, []>("SELECT * FROM outbox WHERE state = 'waiting'").all();
    for (const row of waiting) {
      const command = fromRow(row);
      const before = command.afterPr
        ? this.db
            .query<{ state: OutboxState }, [string]>(
              "SELECT state FROM outbox WHERE pr_id = ? ORDER BY created_at DESC LIMIT 1",
            )
            .get(command.afterPr)
        : null;
      const decision = this.release(command, before?.state ?? null);
      if (decision.action === "wait") continue;
      if (decision.action === "stop") {
        this.update(command, decision.state, decision.detail);
        continue;
      }
      this.db
        .query(
          "UPDATE outbox SET state = 'queued', expected_head = ?, detail = ?, updated_at = ? WHERE id = ?",
        )
        .run(decision.expectedHead, decision.detail, new Date().toISOString(), command.id);
      this.changed([command.prId]);
    }
  }

  private async run(account: string, work: () => Promise<void>): Promise<void> {
    this.busy.add(account);
    try {
      await work();
    } catch (error) {
      console.error(`outbox ${account}:`, error);
    } finally {
      this.busy.delete(account);
    }
  }

  private next(account: string, state: "queued" | "unknown"): Command | null {
    const row = this.db
      .query<Row, [string, string, string]>(
        `SELECT * FROM outbox WHERE account = ? AND state = ? AND send_at <= ?
         ORDER BY priority, send_at LIMIT 1`,
      )
      .get(account, state, new Date().toISOString());
    return row ? fromRow(row) : null;
  }

  private allowed(account: string, priority: 0 | 1): boolean {
    const last = this.db
      .query<{ at: string }, [string]>(
        "SELECT at FROM write_ledger WHERE account = ? ORDER BY at DESC LIMIT 1",
      )
      .get(account);
    if (last && Date.now() - Date.parse(last.at) < LIMITS.minGapMs) return false;
    if (this.writesSince(account, 60_000) >= LIMITS.perMinute) return false;
    const hour = this.writesSince(account, 3_600_000);
    return priority === 0 ? hour < LIMITS.totalPerHour : hour < LIMITS.bulkPerHour;
  }

  private async dispatch(port: GitHubPort, command: Command): Promise<void> {
    const check = this.preflight(command);
    if (!check.ok) {
      this.update(command, check.state, check.detail);
      return;
    }

    this.db
      .query(
        "UPDATE outbox SET state = 'claimed', claimed_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?",
      )
      .run(new Date().toISOString(), new Date().toISOString(), command.id);

    try {
      const result = await send(port, command);
      this.acked(command, null, result);
    } catch (error) {
      this.handleError(command, error);
    }
  }

  private handleError(command: Command, error: unknown): void {
    if (!(error instanceof GitHubError)) {
      this.update(command, "unknown", `Unexpected error: ${String(error)}`);
      return;
    }
    switch (error.kind) {
      case "secondary-limit":
      case "rate-limit":
      case "auth": {
        // Not sent. Hold this account's queue; a 401 never falls back to another account.
        const wait = error.retryAfterMs ?? 60_000;
        this.pausedUntil.set(command.account, Date.now() + wait);
        this.update(
          command,
          "queued",
          `${error.kind === "auth" ? "Token rejected" : "GitHub asked us to slow down"}; retrying in ${Math.ceil(wait / 1000)}s`,
        );
        return;
      }
      case "network":
      case "server":
        // The request may or may not have been applied.
        this.update(command, "unknown", `${error.message}; checking whether it landed`);
        return;
      default:
        this.update(command, "failed", error.message);
    }
  }

  /** Decides what happened to a write whose outcome we never saw. */
  private async probe(port: GitHubPort, command: Command): Promise<void> {
    const since = Date.parse(command.claimedAt ?? command.createdAt) - 5 * 60_000;
    // The async merge API answers "already merged" to a repeat, so sending again is safe.
    if (command.kind === "merge") {
      this.update(command, "queued", "Checking the merge again");
      return;
    }
    if (command.kind === "approve" || command.kind === "review") {
      const wanted =
        command.kind === "approve" ? "APPROVED" : REVIEW_STATES[command.payload.event ?? "COMMENT"];
      const reviews = await port.reviewsBy(command.prId, command.account);
      const landed = reviews.find(
        (r) =>
          r.state === wanted &&
          r.commitOid === command.expectedHead &&
          Date.parse(r.submittedAt ?? "") >= since,
      );
      // Not there, so sending again can't duplicate it.
      if (landed) this.acked(command, "Confirmed on GitHub after an interrupted send", landed);
      else this.update(command, "queued", "Not found on GitHub; sending again");
      return;
    }
    // The commit landed if the branch's head now sits on top of the head we committed onto.
    if (command.kind === "suggestions") {
      const head = await port.branchHead(
        command.payload.headRepo ?? command.repo,
        command.payload.branch ?? "",
      );
      if (
        head?.parents.includes(command.expectedHead) &&
        head.message.startsWith(command.payload.headline ?? "")
      )
        this.acked(command, "Confirmed on GitHub after an interrupted send", { oid: head.oid });
      else if (head?.oid === command.expectedHead)
        this.update(command, "queued", "Not found on GitHub; sending again");
      else this.update(command, "failed", "The branch moved; check whether the suggestions landed");
      return;
    }
    // A second revert would open a second PR, so this one is for a person to check.
    if (command.kind === "revert") {
      this.update(
        command,
        "failed",
        "Couldn't tell whether the revert PR opened; check GitHub first",
      );
      return;
    }
    // Reacting twice leaves one reaction, so sending again is safe.
    if (command.kind === "react") {
      this.update(command, "queued", "Sending again");
      return;
    }
    if (CONTENT_KINDS.has(command.kind)) {
      const body = (command.payload.body ?? "").trim();
      const comments = await port.recentComments(command.prId);
      const landed = comments.find((c) => c.author === command.account && c.body.trim() === body);
      if (landed) this.acked(command, "Confirmed on GitHub after an interrupted send", landed);
      else this.update(command, "queued", "Not found on GitHub; sending again");
      return;
    }
    // Everything else (resolving, viewed marks, labels, reviewers, draft, close) lands the same
    // however many times it's sent.
    this.update(command, "queued", "Sending again");
  }

  private acked(command: Command, detail: string | null, result: unknown): void {
    if (CONTENT_KINDS.has(command.kind)) {
      this.db
        .query("INSERT INTO write_ledger (account, at) VALUES (?, ?)")
        .run(command.account, new Date().toISOString());
    }
    this.update(command, "acked", detail, result);
    for (const listener of this.ackListeners) listener(command);
  }

  private update(
    command: Command,
    state: OutboxState,
    detail: string | null,
    result?: unknown,
  ): void {
    this.db
      .query(
        "UPDATE outbox SET state = ?, detail = ?, result = coalesce(?, result), updated_at = ? WHERE id = ?",
      )
      .run(
        state,
        detail,
        result === undefined ? null : JSON.stringify(result),
        new Date().toISOString(),
        command.id,
      );
    this.changed([command.prId]);
  }

  private changed(prIds: string[]): void {
    this.version++;
    for (const listener of this.listeners) listener(prIds);
  }
}

function send(port: GitHubPort, command: Command): Promise<unknown> {
  const { payload } = command;
  switch (command.kind) {
    case "approve":
      return port.approve(command.prId, command.expectedHead, payload.body);
    case "review":
      return port.submitReview({
        prId: command.prId,
        commitOid: command.expectedHead,
        event: payload.event ?? "COMMENT",
        body: payload.body ?? "",
        threads: payload.threads ?? [],
      });
    case "reply":
      return port.reply(payload.threadId ?? "", payload.body ?? "");
    case "comment":
    case "bot-command":
      return port.comment(command.prId, payload.body ?? "");
    case "resolve":
    case "unresolve":
      return port.setResolved(payload.threadId ?? "", command.kind === "resolve");
    case "viewed":
    case "unviewed":
      return port.setViewed(command.prId, payload.path ?? "", command.kind === "viewed");
    case "notification-read":
      return port.markNotificationRead(payload.threadId ?? "");
    case "subscription":
      return port.setSubscription(
        command.prId,
        payload.subscription ?? "UNSUBSCRIBED",
        payload.threadId ?? null,
      );
    case "notification-done":
      return port.markNotificationDone(payload.threadId ?? "");
    case "rerun-failed":
      return port.rerunFailedJobs(command.repo, payload.runId ?? 0, payload.debug ?? false);
    case "rerun-all":
      return port.rerunRun(command.repo, payload.runId ?? 0, payload.debug ?? false);
    case "rerun-job":
      return port.rerunJob(command.repo, payload.jobId ?? 0, payload.debug ?? false);
    case "cancel-run":
      // A run that finished before the cancel arrived has nothing left to stop.
      return port.cancelRun(command.repo, payload.runId ?? 0).catch((error: unknown) => {
        if (!(error instanceof GitHubError && error.kind === "conflict")) throw error;
      });
    case "approve-run":
      return port.approveRun(command.repo, payload.runId ?? 0);
    case "approve-deployment":
      return port.approveDeployment(command.repo, payload.runId ?? 0, payload.environmentIds ?? []);
    case "merge":
      return mergeAndWait(port, command);
    case "suggestions":
      return commitSuggestions(port, command);
    case "auto-merge":
      return port.setAutoMerge(
        command.prId,
        payload.enabled ? (payload.method ?? "MERGE") : null,
        command.expectedHead,
      );
    case "update-branch":
      return port.updateBranch(command.prId, payload.rebase ?? false, command.expectedHead);
    case "labels":
    case "assignees":
    case "reviewers":
      return port.editMetadata(
        { id: command.prId, repo: command.repo, number: command.number },
        command.kind,
        {
          add: payload.add ?? [],
          remove: payload.remove ?? [],
        },
      );
    case "milestone":
      return port.setMilestone(command.repo, command.number, payload.milestone ?? null);
    case "draft":
      return port.setDraft(command.prId, payload.draft ?? true);
    case "close":
    case "reopen":
      return port.setOpen(command.prId, command.kind === "reopen");
    case "react":
      return port.react(
        payload.subjectId ?? "",
        payload.content ?? "THUMBS_UP",
        payload.on ?? true,
      );
    case "edit-comment":
      return port.editWriting(
        payload.subject ?? "issue-comment",
        payload.subjectId ?? "",
        payload.body ?? "",
      );
    case "delete-comment":
      // A comment that's already gone is what we wanted (a resend after a lost answer).
      return port
        .deleteComment(
          payload.subject === "review-comment" ? "review-comment" : "issue-comment",
          payload.subjectId ?? "",
        )
        .catch((error: unknown) => {
          if (!(error instanceof GitHubError && /could not resolve/i.test(error.message)))
            throw error;
        });
    case "minimize":
      return port.minimize(payload.subjectId ?? "", payload.reason ?? null);
    case "edit-pr":
      return port.editPr(command.prId, {
        ...(payload.title !== undefined ? { title: payload.title } : {}),
        ...(payload.body !== undefined ? { body: payload.body } : {}),
        ...(payload.base !== undefined ? { base: payload.base } : {}),
      });
    case "dismiss-review":
      return port.dismissReview(payload.subjectId ?? "", payload.body ?? "");
    case "lock":
      return port.setLocked(command.repo, command.number, payload.lockReason ?? null);
    case "enqueue":
      return port.enqueue(command.prId, command.expectedHead, payload.jump ?? false);
    case "dequeue":
      return port.dequeue(command.prId);
    case "delete-branch":
    case "restore-branch":
      return changeBranch(port, command);
    case "revert":
      return port.revert(command.prId, payload.title, payload.body);
    default:
      return Promise.reject(new Error(`unknown command kind ${String(command.kind)}`));
  }
}

/** Deletes or restores the head branch; already gone (or already back) after a resend is done. */
async function changeBranch(port: GitHubPort, command: Command): Promise<void> {
  const branch = command.payload.branch ?? "";
  try {
    if (command.kind === "delete-branch") await port.deleteBranch(command.repo, branch);
    else await port.restoreBranch(command.repo, branch, command.expectedHead);
  } catch (error) {
    if (!(error instanceof GitHubError && error.kind === "validation")) throw error;
  }
}

/** Merges, then waits (briefly) for GitHub to say how it went; checks run when the merge does. */
async function mergeAndWait(port: GitHubPort, command: Command): Promise<unknown> {
  const { payload } = command;
  let result = await port.merge(command.repo, command.number, {
    sha: command.expectedHead,
    method: payload.method ?? "MERGE",
    ...(payload.bypass ? { action: "direct_merge" as const } : {}),
    ...(payload.headline ? { title: payload.headline } : {}),
    ...(payload.body !== undefined ? { message: payload.body } : {}),
  });
  for (let i = 0; result.status === "pending" && result.uuid && i < 30; i++) {
    await Bun.sleep(1000);
    result = await port.mergeStatus(command.repo, command.number, result.uuid);
  }
  if (result.status === "failed") throw new GitHubError(result.message, "validation", null);
  return result;
}

const REVIEW_STATES: Record<ReviewEvent, string> = {
  APPROVE: "APPROVED",
  COMMENT: "COMMENTED",
  REQUEST_CHANGES: "CHANGES_REQUESTED",
};

function fromRow(row: Row): Command {
  return {
    id: row.id,
    planId: row.plan_id,
    account: row.account,
    kind: row.kind,
    prId: row.pr_id,
    repo: row.repo,
    number: row.number,
    title: row.title,
    expectedHead: row.expected_head,
    payload: JSON.parse(row.payload) as CommandPayload,
    state: row.state,
    priority: row.priority,
    afterPr: row.after_pr,
    sendAt: row.send_at,
    claimedAt: row.claimed_at,
    attempts: row.attempts,
    detail: row.detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** One commit with every applied suggestion, then their threads resolved, as GitHub does. */
async function commitSuggestions(port: GitHubPort, command: Command): Promise<{ oid: string }> {
  const { payload } = command;
  const result = await port
    .commitFiles({
      repo: payload.headRepo ?? command.repo,
      branch: payload.branch ?? "",
      expectedHeadOid: command.expectedHead,
      headline: payload.headline ?? "Apply suggestions from code review",
      body: payload.body ?? "",
      files: payload.files ?? [],
    })
    .catch((error: unknown) => {
      if (error instanceof GitHubError && error.message.includes("Expected branch to point to")) {
        throw new GitHubError(
          "Someone pushed to the branch first, so the suggestions weren't applied",
          "conflict",
          error.status,
        );
      }
      throw error;
    });
  // The commit is what matters; a thread left open is easy to resolve by hand.
  for (const threadId of payload.threadIds ?? []) {
    await port.setResolved(threadId, true).catch(() => undefined);
  }
  return result;
}
