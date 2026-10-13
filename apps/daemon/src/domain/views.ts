import type { Outbox } from "@/outbox/outbox";
import type { ReleaseRegistry } from "@/registry/release";
import type {
  Bump,
  BumpRef,
  Cohort,
  FlightItem,
  GateResult,
  GroupItem,
  GroupRow,
  GroupView,
  MergePath,
  PrItem,
  QueueItem,
  ReleaseInfo,
  SemverClass,
  Split,
} from "@pier/core/wire";

import { bumpKey, isManifestOf } from "./bumps";
import type { DoneItems, Verdicts } from "./decisions";
import { evaluateGates, type Placement, place, summarizeGates } from "./gates";
import type { Model, PrRecord } from "./model";
import { checksFailing } from "./runway";
import type { SettingsStore } from "./settings";

// Everything the web app shows is derived here from the model plus Brayden's decisions.
// One snapshot is computed per change and reused by every request until something moves.

export type ViewContext = {
  model: Model;
  outbox: Outbox;
  verdicts: Verdicts;
  done: DoneItems;
  registry: ReleaseRegistry;
  settings: SettingsStore;
  /** Logins of every linked account. */
  accounts: () => string[];
  now: () => number;
};

export type BotEval = {
  record: PrRecord;
  bumps: Bump[];
  releases: (ReleaseInfo | null)[];
  gates: GateResult[];
  placement: Placement;
  approvedAtHead: boolean;
  approving: boolean;
};

type Group = { key: string; bump: Bump; members: string[] };

type Snapshot = {
  bots: Map<string, BotEval>;
  groups: Map<string, Group>;
  inbox: Record<Split, QueueItem[]>;
  flight: FlightItem[];
};

export class Views {
  private cached: { stamp: string; snapshot: Snapshot } | null = null;

  constructor(private readonly ctx: ViewContext) {}

  inbox(split: Split): QueueItem[] {
    return this.snapshot().inbox[split];
  }

  counts(): Record<Split, number> {
    const { inbox } = this.snapshot();
    return { review: inbox.review.length, deps: inbox.deps.length, mine: inbox.mine.length };
  }

  flight(): FlightItem[] {
    return this.snapshot().flight;
  }

  /** The open PRs behind a done key: a bump group's members, or the PR itself. */
  prIdsFor(key: string): string[] {
    if (key.startsWith("group:"))
      return this.snapshot().groups.get(key.slice("group:".length))?.members ?? [];
    if (key.startsWith("pr:")) return [key.slice("pr:".length)];
    return [];
  }

  /** The current cursor for a done key, so marking done hides exactly what's on screen now. */
  cursorFor(key: string): string | null {
    const snapshot = this.snapshot();
    if (key.startsWith("group:")) {
      const group = snapshot.groups.get(key.slice("group:".length));
      return group ? groupCursor(actionableMembers(group, snapshot.bots)) : null;
    }
    if (key.startsWith("pr:")) {
      const record = this.ctx.model.get(key.slice("pr:".length));
      return record ? prCursor(record) : null;
    }
    return null;
  }

  group(key: string): GroupView | null {
    const snapshot = this.snapshot();
    const group = snapshot.groups.get(key);
    if (!group) return null;
    const evals = group.members.flatMap((id) => snapshot.bots.get(id) ?? []);
    if (evals.length === 0) return null;

    const representative = pickRepresentative(evals);
    const repShape = shape(representative.record);
    const rows = evals
      .map((e) => this.row(e, group, repShape))
      .toSorted(
        (a, b) => cohortOrder(a.cohort) - cohortOrder(b.cohort) || a.repo.localeCompare(b.repo),
      );

    const fromCounts = new Map<string, number>();
    for (const e of evals) {
      const from = e.bumps.find((b) => bumpKey(b) === key)?.from ?? "unknown";
      fromCounts.set(from, (fromCounts.get(from) ?? 0) + 1);
    }
    const repBumpIndex = representative.bumps.findIndex((b) => bumpKey(b) === key);

    return {
      key,
      ecosystem: group.bump.ecosystem,
      pkg: group.bump.pkg,
      to: group.bump.to,
      semver: worstSemver(
        evals.map((e) => e.bumps.find((b) => bumpKey(b) === key)?.semver ?? "unknown"),
      ),
      fromVersions: [...fromCounts]
        .map(([version, count]) => ({ version, count }))
        .toSorted((a, b) => b.count - a.count),
      release: representative.releases[repBumpIndex] ?? null,
      gates: summarizeGates(evals.map((e) => e.gates)),
      notes: representative.record.doc.body || null,
      representative: {
        prId: representative.record.doc.id,
        repo: representative.record.doc.repo,
        number: representative.record.doc.number,
        files: representative.record.files ?? [],
      },
      rows,
      verdicts: this.ctx.verdicts.active(key, this.ctx.now()),
    };
  }

  // -------------------------------------------------------------------------

  private snapshot(): Snapshot {
    const { model, outbox, verdicts, done, registry, now } = this.ctx;
    // Release ages and staleness drift with time, so the snapshot also expires each minute.
    const stamp = [
      model.version,
      outbox.version,
      verdicts.version,
      done.version,
      registry.version,
      Math.floor(now() / 60_000),
    ].join(":");
    if (this.cached?.stamp === stamp) return this.cached.snapshot;
    const snapshot = this.build();
    this.cached = { stamp, snapshot };
    return snapshot;
  }

  private build(): Snapshot {
    const { model, outbox, registry, settings, now } = this.ctx;
    const policy = settings.get("policy");
    // Linked accounts are all you; in sandbox mode they're separate people reviewing each other.
    const linked = settings.get("identity").linked;
    const all = new Set(this.ctx.accounts());
    const approving = outbox.approving();
    const t = now();

    const bots = new Map<string, BotEval>();
    const groups = new Map<string, Group>();
    const review: PrItem[] = [];
    const mine: PrItem[] = [];
    const flight: FlightItem[] = [];

    for (const record of model.all()) {
      const doc = record.doc;
      if (doc.state !== "OPEN") continue;

      if (record.bot) {
        const releases = record.bot.bumps.map((bump) => registry.cached(bump));
        const gates = evaluateGates({
          doc,
          bot: record.bot.bot,
          bumps: record.bot.bumps,
          files: record.files,
          releases,
          policy,
          now: t,
        });
        const evaluation: BotEval = {
          record,
          bumps: record.bot.bumps,
          releases,
          gates,
          placement: place(doc, gates, policy, t),
          approvedAtHead: approvedAtHead(record),
          approving: approving.has(doc.id, doc.headRefOid),
        };
        bots.set(doc.id, evaluation);
        for (const bump of record.bot.bumps) {
          const key = bumpKey(bump);
          const group = groups.get(key) ?? { key, bump, members: [] };
          group.members.push(doc.id);
          groups.set(key, group);
        }
        if (evaluation.approvedAtHead || evaluation.approving)
          flight.push(
            this.flightItem(
              record,
              evaluation.approving
                ? "Approval queued"
                : "Approved; waiting for automation to merge",
            ),
          );
        continue;
      }

      const item = this.prItem(record, linked ? all : new Set([record.reader]));
      if (item?.split === "review") review.push(item.item);
      else if (item?.split === "mine") mine.push(item.item);
      else if (item?.flight) flight.push(this.flightItem(record, item.flight));
    }

    const deps = [...groups.values()]
      .flatMap((group) => this.groupItem(group, bots) ?? [])
      .toSorted(
        (a, b) => b.cohorts.clear - a.cohorts.clear || b.updatedAt.localeCompare(a.updatedAt),
      );

    return {
      bots,
      groups,
      inbox: { review: review.toSorted(byRecent), deps, mine: mine.toSorted(byRecent) },
      flight: flight.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }

  private groupItem(group: Group, bots: Map<string, BotEval>): GroupItem | null {
    const { verdicts, done, now } = this.ctx;
    const actionable = actionableMembers(group, bots);
    if (actionable.length === 0) return null;
    if (done.isDone(`group:${group.key}`, groupCursor(actionable))) return null;

    const cohorts: Record<Cohort, number> = { clear: 0, look: 0, stuck: 0 };
    for (const e of actionable) cohorts[e.placement.cohort]++;
    const covered = actionable.filter((e) =>
      e.bumps.every((b) => verdicts.covers(bumpKey(b), b.semver, now())),
    ).length;
    const semvers = actionable.map(
      (e) => e.bumps.find((b) => bumpKey(b) === group.key)?.semver ?? "unknown",
    );
    const repos = new Set(actionable.map((e) => e.record.doc.repo));

    const parts = (["clear", "look", "stuck"] as const)
      .filter((c) => cohorts[c] > 0)
      .map((c) => `${cohorts[c]} ${c}`);
    const reason =
      covered === actionable.length
        ? `${covered} covered by your earlier verdict`
        : parts.join(" · ");

    return {
      kind: "group",
      key: group.key,
      ecosystem: group.bump.ecosystem,
      pkg: group.bump.pkg,
      to: group.bump.to,
      fromVersions: [
        ...new Set(
          actionable.map((e) => e.bumps.find((b) => bumpKey(b) === group.key)?.from ?? "?"),
        ),
      ],
      semver: worstSemver(semvers),
      repoCount: repos.size,
      cohorts,
      covered,
      reason,
      updatedAt:
        actionable
          .map((e) => e.record.doc.updatedAt)
          .toSorted()
          .at(-1) ?? "",
      accounts: [...new Set(actionable.map((e) => e.record.reader))],
    };
  }

  private row(e: BotEval, group: Group, repShape: string): GroupRow {
    const doc = e.record.doc;
    const pending = this.ctx.outbox.pending(doc.id);
    const own = e.bumps.find((b) => bumpKey(b) === group.key);
    const others: BumpRef[] = e.bumps
      .filter((b) => bumpKey(b) !== group.key)
      .map(({ ecosystem, pkg, from, to, semver }) => ({ ecosystem, pkg, from, to, semver }));
    return {
      prId: doc.id,
      repo: doc.repo,
      number: doc.number,
      title: doc.title,
      url: doc.url,
      directory: own?.directory ?? "/",
      from: own?.from ?? null,
      account: e.record.reader,
      cohort: e.placement.cohort,
      reasons: e.placement.reasons,
      gates: e.gates,
      checks: {
        state: doc.checks.state,
        total: doc.checks.total,
        failing: doc.checks.failing,
        pending: doc.checks.pending,
      },
      mergeable: doc.mergeable,
      approvalRequired: doc.reviewDecision === "review_required",
      mergePath: mergePath(e.record),
      otherBumps: others,
      // A grouped PR always differs; saying which bumps it carries is the useful part.
      differs: others.length === 0 && shape(e.record) !== repShape,
      // An approval that just landed counts before the next read shows it.
      approvedByYou: e.approvedAtHead || (e.approving && pending === null),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      pending,
    };
  }

  /** Human PRs: Review when your eyes are needed, Mine when your own PR needs you. */
  private prItem(
    record: PrRecord,
    accounts: Set<string>,
  ): { split?: Split; item: PrItem; flight?: string } | null {
    const doc = record.doc;
    const mineAuthor = doc.author ? accounts.has(doc.author.login) : false;
    const personal = [...record.scopes].some((s) => s.endsWith(":involved"));
    if (!personal && !mineAuthor) return null;

    const base = {
      kind: "pr" as const,
      id: doc.id,
      repo: doc.repo,
      number: doc.number,
      title: doc.title,
      url: doc.url,
      author: doc.author,
      additions: doc.additions,
      deletions: doc.deletions,
      changedFiles: doc.changedFiles,
      isDraft: doc.isDraft,
      checks: {
        state: doc.checks.state,
        total: doc.checks.total,
        failing: doc.checks.failing,
        pending: doc.checks.pending,
      },
      reviewDecision: doc.reviewDecision,
      updatedAt: doc.updatedAt,
      account: record.reader,
    };
    const isDone = this.ctx.done.isDone(`pr:${doc.id}`, prCursor(record));

    if (mineAuthor) {
      const reason =
        doc.reviewDecision === "changes_requested"
          ? "Changes requested"
          : doc.checks.state === "failure"
            ? checksFailing(doc.checks.failing)
            : doc.mergeable === "conflicting"
              ? "Merge conflicts"
              : doc.reviewDecision === "approved" &&
                  doc.checks.state === "success" &&
                  !doc.autoMerge &&
                  !doc.mergeQueue
                ? "Approved and green; nothing is merging it"
                : null;
      if (reason && !isDone) return { split: "mine", item: { ...base, reason } };
      const waiting = doc.reviewRequests.map((r) => r.login);
      return {
        item: { ...base, reason: "" },
        flight: waiting.length > 0 ? `Waiting on ${waiting.join(", ")}` : "Waiting on review",
      };
    }

    if (doc.isDraft) return null;
    const requested = doc.reviewRequests.filter(
      (r) => (r.kind === "user" && accounts.has(r.login)) || r.kind === "team",
    );
    const viewer = record.viewers.get(record.reader)?.latestReview ?? null;
    const reviewedAtHead = viewer?.commitOid === doc.headRefOid;
    let reason: string | null = null;
    if (requested.some((r) => r.kind === "user") && !reviewedAtHead) {
      reason = viewer ? "Re-review requested" : "Review requested";
    } else if (requested.length > 0 && !viewer) {
      reason = `Team review requested (${requested.map((r) => r.login).join(", ")})`;
    } else if (viewer && !reviewedAtHead && viewer.state !== "APPROVED") {
      reason = "New commits since your review";
    }
    if (reason && !isDone) return { split: "review", item: { ...base, reason } };
    if (viewer?.state === "APPROVED")
      return { item: { ...base, reason: "" }, flight: "You approved; waiting to merge" };
    return null;
  }

  private flightItem(record: PrRecord, waitingOn: string): FlightItem {
    const doc = record.doc;
    return {
      prId: doc.id,
      repo: doc.repo,
      number: doc.number,
      title: doc.title,
      url: doc.url,
      account: record.reader,
      waitingOn,
      checks: {
        state: doc.checks.state,
        total: doc.checks.total,
        failing: doc.checks.failing,
        pending: doc.checks.pending,
      },
      mergePath: mergePath(record),
      updatedAt: doc.updatedAt,
    };
  }
}

function actionableMembers(group: Group, bots: Map<string, BotEval>): BotEval[] {
  return group.members
    .flatMap((id) => bots.get(id) ?? [])
    .filter((e) => !e.approvedAtHead && !e.approving);
}

/** New PRs joining a group bring it back after done; rebases of existing members don't. */
function groupCursor(actionable: BotEval[]): string {
  return actionable
    .map((e) => e.record.doc.id)
    .toSorted()
    .join(",");
}

function prCursor(record: PrRecord): string {
  return `${record.doc.updatedAt}:${record.doc.headRefOid}`;
}

function byRecent(a: PrItem, b: PrItem): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

function approvedAtHead(record: PrRecord): boolean {
  const review = record.viewers.get(record.reader)?.latestReview;
  return review?.state === "APPROVED" && review.commitOid === record.doc.headRefOid;
}

function mergePath(record: PrRecord): MergePath {
  if (record.doc.mergeQueue) return "merge-queue";
  if (record.doc.autoMerge) return "auto-merge";
  return "unknown";
}

/** File basenames plus manifest-only line counts; lockfile sizes naturally differ per repo. */
/**
 * The PR whose diff stands for the whole group: the most common shape among PRs that carry only
 * this bump, so the diff shows just this change and "differs" marks the real outliers. Clear PRs
 * win within that shape.
 */
export function pickRepresentative(evals: BotEval[]): BotEval {
  const loaded = evals.filter((e) => e.record.files);
  const single = loaded.filter((e) => e.bumps.length === 1);
  const pool = single.length > 0 ? single : loaded.length > 0 ? loaded : evals;
  const common = [...Map.groupBy(pool, (e) => shape(e.record)).values()].reduce((best, next) =>
    next.length > best.length ? next : best,
  );
  return common.find((e) => e.placement.cohort === "clear") ?? common[0]!;
}

function shape(record: PrRecord): string {
  const bot = record.bot;
  const files = record.doc.files;
  const names = files.map((f) => f.path.split("/").at(-1) ?? f.path).toSorted();
  const manifest = files
    .filter(
      (f) =>
        !/lock|\.sum$/i.test(f.path) && bot?.bumps.some((b) => isManifestOf(b.ecosystem, f.path)),
    )
    .map((f) => `${f.additions}/${f.deletions}`)
    .toSorted();
  return `${names.join(",")}|${manifest.join(",")}`;
}

function worstSemver(semvers: SemverClass[]): SemverClass {
  for (const level of ["major", "unknown", "minor", "patch"] as const)
    if (semvers.includes(level)) return level;
  return "unknown";
}

function cohortOrder(cohort: Cohort): number {
  return cohort === "clear" ? 0 : cohort === "look" ? 1 : 2;
}
