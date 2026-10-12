import type { Database } from "bun:sqlite";

import { GitHubError } from "@/github/client";
import type { GitHubPort } from "@/github/port";
import type { CommandKind, LogEntry, OutboxState, PendingWrite } from "@pier/core/wire";

// Every write to GitHub is a persisted command. Its lifecycle:
//
//   held ──(undo window passes)──▶ queued ──▶ claimed ──▶ acked
//     │                              │           │
//     └──────── cancelled ◀──────────┘           ├──▶ failed   (GitHub said no)
//                                                └──▶ unknown  (crash or timeout mid-send)
//
// `claimed` is written to disk before the request goes out, so a crash can never cause a
// silent double-send: on restart, claimed commands become `unknown` and are resolved by reading
// GitHub (did the approval land?) rather than by retrying blindly.

export type CommandPayload = { body?: string };

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
>;

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
  version = 0;

  constructor(
    private readonly db: Database,
    private readonly ports: () => Map<string, GitHubPort>,
    private readonly preflight: Preflight,
  ) {}

  onChange(listener: (prIds: string[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
               state, priority, send_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            holdMs > 0 ? "held" : "queued",
            command.priority,
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
             WHERE id = ? AND state IN ('held', 'queued') RETURNING pr_id`,
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
         WHERE pr_id = ? AND state IN ('held', 'queued', 'claimed', 'unknown')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(prId);
    return row
      ? { commandId: row.id, kind: row.kind, state: row.state, sendAt: row.send_at }
      : null;
  }

  /** PR ids with an approval that's queued, in flight, or just landed (until the next sync shows it). */
  approvingPrIds(): Set<string> {
    const rows = this.db
      .query<{ pr_id: string }, [string]>(
        `SELECT DISTINCT pr_id FROM outbox WHERE kind = 'approve'
         AND (state IN ('held', 'queued', 'claimed', 'unknown') OR (state = 'acked' AND updated_at > ?))`,
      )
      .all(new Date(Date.now() - 10 * 60_000).toISOString());
    return new Set(rows.map((r) => r.pr_id));
  }

  log(limit = 100): LogEntry[] {
    return this.db
      .query<Row, [number]>("SELECT * FROM outbox ORDER BY created_at DESC LIMIT ?")
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
      }));
  }

  counts() {
    const rows = this.db
      .query<{ state: OutboxState; n: number }, []>(
        "SELECT state, count(*) AS n FROM outbox GROUP BY state",
      )
      .all();
    const by = Object.fromEntries(rows.map((r) => [r.state, r.n]));
    return {
      queued: (by.queued ?? 0) + (by.claimed ?? 0),
      held: by.held ?? 0,
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
      this.db
        .query("INSERT INTO write_ledger (account, at) VALUES (?, ?)")
        .run(command.account, new Date().toISOString());
      this.update(command, "acked", null, result);
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
    if (command.kind === "approve") {
      const since = Date.parse(command.claimedAt ?? command.createdAt) - 5 * 60_000;
      const reviews = await port.reviewsBy(command.prId, command.account);
      const landed = reviews.find(
        (r) =>
          r.state === "APPROVED" &&
          r.commitOid === command.expectedHead &&
          Date.parse(r.submittedAt ?? "") >= since,
      );
      if (landed) {
        this.db
          .query("INSERT INTO write_ledger (account, at) VALUES (?, ?)")
          .run(command.account, new Date().toISOString());
        this.update(command, "acked", "Confirmed on GitHub after an interrupted send", landed);
      } else {
        // No approval exists, so sending again can't duplicate one.
        this.update(command, "queued", "Not found on GitHub; sending again");
      }
      return;
    }
    // A comment can't be matched reliably, so a person decides.
    this.update(command, "failed", "May or may not have posted. Check the PR before retrying.");
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
  if (command.kind === "approve")
    return port.approve(command.prId, command.expectedHead, command.payload.body);
  return port.comment(command.prId, command.payload.body ?? "");
}

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
    sendAt: row.send_at,
    claimedAt: row.claimed_at,
    attempts: row.attempts,
    detail: row.detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
