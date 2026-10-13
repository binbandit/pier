import { bumpKey } from "@/domain/bumps";
import type { Verdicts } from "@/domain/decisions";
import type { Model, PrRecord } from "@/domain/model";
import type { SettingsStore } from "@/domain/settings";
import type { ActionKind, PlanPreview, PlanStep, SemverClass } from "@pier/core/wire";

import { LIMITS, type NewCommand, type Outbox } from "./outbox";

// Turns "do X to these PRs" into the fewest writes that achieve it, with every skip explained
// and every guard applied, then holds the plan until Brayden confirms it.

const PLAN_TTL_MS = 10 * 60_000;
/** Single-PR writes wait this long before sending, so `z` can still take them back. */
const UNDO_WINDOW_MS = 5_000;

type StoredPlan = {
  preview: PlanPreview;
  commands: NewCommand[];
  verdicts: { key: string; semver: SemverClass }[];
  createdAt: number;
};

export type PlannerDeps = {
  model: Model;
  outbox: Outbox;
  verdicts: Verdicts;
  settings: SettingsStore;
  accounts: () => string[];
};

export class Planner {
  private plans = new Map<string, StoredPlan>();

  constructor(private readonly deps: PlannerDeps) {}

  plan(action: ActionKind, prIds: string[], groupKey: string | null): PlanPreview {
    this.expire();
    const planId = crypto.randomUUID();
    const steps: PlanStep[] = [];
    const commands: NewCommand[] = [];
    const verdicts = new Map<string, SemverClass>();
    const warnings: string[] = [];
    const priority = prIds.length > 1 ? 1 : 0;

    for (const prId of new Set(prIds)) {
      const record = this.deps.model.get(prId);
      if (!record) continue;
      const doc = record.doc;
      const step: PlanStep = {
        prId,
        repo: doc.repo,
        number: doc.number,
        account: record.reader,
        writes: [],
        skip: null,
      };
      steps.push(step);

      step.skip = this.guard(record, action);
      if (step.skip) continue;

      if (action === "approve") {
        step.writes = ["approve"];
        commands.push({
          ...target(record),
          planId,
          kind: "approve",
          payload: { bumpKeys: (record.bot?.bumps ?? []).map(bumpKey) },
          priority,
        });
        for (const bump of record.bot?.bumps ?? []) verdicts.set(bumpKey(bump), bump.semver);
      } else {
        step.writes = ["comment"];
        commands.push({
          ...target(record),
          planId,
          kind: "bot-command",
          payload: { body: `@dependabot ${action}` },
          priority,
        });
      }
    }

    // Approving one of several bumps in a repo makes Dependabot rebase the others, which dismisses
    // approvals where stale-review dismissal is on. Worth knowing before spending writes.
    // Automation merges an approved bump straight away; approving a second bump in the same repo at
    // the same moment makes its merge fail on the moved base. So within a repo, each approval waits
    // for the one before it to merge.
    const perRepo = Map.groupBy(commands, (c) => c.repo);
    let chained = 0;
    if (action === "approve") {
      for (const sameRepo of perRepo.values()) {
        for (const [i, command] of sameRepo.entries()) {
          if (i === 0) continue;
          command.afterPr = sameRepo[i - 1]?.prId ?? null;
          chained++;
        }
      }
    }
    if (chained > 0) {
      warnings.push(
        `${chained} ${chained === 1 ? "approval waits" : "approvals wait"} for an earlier PR in the same repo to merge first.`,
      );
    }
    if (groupKey) {
      const others = new Set(
        commands.flatMap(
          (c) =>
            this.deps.model
              .get(c.prId)
              ?.bot?.bumps.map(bumpKey)
              .filter((k) => k !== groupKey) ?? [],
        ),
      );
      if (others.size > 0)
        warnings.push(
          `Grouped PRs here also carry ${others.size} other bump${others.size === 1 ? "" : "s"}; approving records verdicts for them too.`,
        );
    }

    const perAccount = [...Map.groupBy(commands, (c) => c.account)].map(([account, cs]) => {
      const used = this.deps.outbox.writesSince(account, 3_600_000);
      return { account, writes: cs.length, hourShare: (used + cs.length) / LIMITS.bulkPerHour };
    });
    const preview: PlanPreview = {
      planId,
      action,
      steps,
      writes: commands.length,
      perAccount,
      etaSeconds: Math.max(
        0,
        ...perAccount.map((a) => eta(a.writes, this.deps.outbox.writesSince(a.account, 3_600_000))),
      ),
      verdicts: [...verdicts].map(([key, semver]) => ({ key, semver })),
      warnings,
    };
    this.plans.set(planId, {
      preview,
      commands,
      verdicts: preview.verdicts,
      createdAt: Date.now(),
    });
    return preview;
  }

  /** The PRs a pending plan would write to, so they can be re-read just before committing. */
  targets(planId: string): string[] {
    return this.plans.get(planId)?.commands.map((c) => c.prId) ?? [];
  }

  commit(planId: string): string[] {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error("This plan expired. Review it again.");
    this.plans.delete(planId);
    const ttl = this.deps.settings.get("policy").verdictTtlDays;
    for (const v of plan.verdicts) this.deps.verdicts.record(v.key, v.semver, ttl);
    const hold = plan.commands.length === 1 ? UNDO_WINDOW_MS : 0;
    return this.deps.outbox.enqueue(plan.commands, hold);
  }

  /** Why this PR gets no write, or null if it should. Checked again right before sending. */
  guard(
    record: PrRecord,
    action: ActionKind,
    options: { ignoreQueued?: boolean } = {},
  ): string | null {
    const doc = record.doc;
    if (doc.state !== "OPEN") return `Already ${doc.state.toLowerCase()}`;

    const sandbox = this.deps.settings.get("sandbox").writeOwners;
    const owner = doc.repo.split("/")[0] ?? "";
    if (sandbox && !sandbox.includes(owner)) return `Outside the sandbox (${owner})`;

    if (action !== "approve") {
      return record.bot?.bot === "dependabot" ? null : "Only Dependabot takes comment commands";
    }

    const linked = this.deps.settings.get("identity").linked
      ? this.deps.accounts()
      : [record.reader];
    if (doc.author && linked.includes(doc.author.login)) return "Your own PR";
    const altApproval = doc.latestReviews.find(
      (r) =>
        r.state === "APPROVED" &&
        r.author !== record.reader &&
        r.author !== null &&
        linked.includes(r.author),
    );
    if (altApproval) return `Already approved by your other account ${altApproval.author}`;

    const review = record.viewers.get(record.reader)?.latestReview;
    if (review?.state === "APPROVED" && review.commitOid === doc.headRefOid)
      return "Already approved";
    if (!options.ignoreQueued && this.deps.outbox.approving().has(doc.id, doc.headRefOid))
      return "Approval already queued";
    if (doc.reviewDecision === null && !this.deps.settings.get("policy").approveWhenNotRequired)
      return "No review required";
    return null;
  }

  private expire(): void {
    for (const [id, plan] of this.plans)
      if (Date.now() - plan.createdAt > PLAN_TTL_MS) this.plans.delete(id);
  }
}

function target(
  record: PrRecord,
): Pick<NewCommand, "account" | "prId" | "repo" | "number" | "title" | "expectedHead"> {
  const doc = record.doc;
  return {
    account: record.reader,
    prId: doc.id,
    repo: doc.repo,
    number: doc.number,
    title: doc.title,
    expectedHead: doc.headRefOid,
  };
}

/** Seconds to drain `writes` at the per-minute pace, waiting out the hourly cap if it's hit. */
function eta(writes: number, usedThisHour: number): number {
  const room = Math.max(0, LIMITS.bulkPerHour - usedThisHour);
  const now = Math.min(writes, room);
  const later = writes - now;
  const perWrite = Math.max(LIMITS.minGapMs / 1000, 60 / LIMITS.perMinute);
  return Math.ceil(now * perWrite + (later > 0 ? 3600 + later * perWrite : 0));
}
