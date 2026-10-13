import { type Account, OPTIONAL_SCOPES, REQUIRED_SCOPES, missingScopes } from "@/accounts/gh";
import { VERSION } from "@/config";
import { bumpKey } from "@/domain/bumps";
import { CodeOwnersCache } from "@/domain/codeowners";
import { DoneItems, Verdicts } from "@/domain/decisions";
import { Details } from "@/domain/details";
import { Drafts } from "@/domain/drafts";
import { provenanceGate } from "@/domain/gates";
import { Model } from "@/domain/model";
import { type InterdiffSource, ReviewService } from "@/domain/review";
import { SettingsStore, type Settings, defaultPolicy, defaultScopes } from "@/domain/settings";
import { Views } from "@/domain/views";
import type { RateWindow } from "@/github/client";
import type { GitHubPort } from "@/github/port";
import { EventHub } from "@/http/events";
import { Outbox, type Preflight, type Release } from "@/outbox/outbox";
import { Planner } from "@/outbox/planner";
import { ReleaseRegistry } from "@/registry/release";
import type { Stores } from "@/store/db";
import { SyncEngine } from "@/sync/engine";
import type { Topic } from "@pier/core/contract";
import type { AccountStatus } from "@pier/core/wire";

// Composition root: builds every part of the daemon from its stores and one GitHub port per
// account, and routes change notifications from the model and outbox to open windows.

export type AppOptions = {
  stores: Stores;
  accounts: Account[];
  ports: Map<string, GitHubPort>;
  /** Overrides applied on first run (e.g. sandbox scopes in E2E). */
  defaults?: Partial<Settings>;
  fetcher?: typeof fetch;
  /** The local git store for diffs and interdiffs. Optional so tests can run without git. */
  git?: InterdiffSource & { ensure(repo: string, account: string, oids: string[]): Promise<void> };
};

export type App = ReturnType<typeof createApp>;

/** Writes that decide something about the code, so they only go out for the commit you saw. */
const HEAD_BOUND = new Set([
  "approve",
  "review",
  "bot-command",
  "merge",
  "auto-merge",
  "update-branch",
  "enqueue",
]);

export function createApp(options: AppOptions) {
  const { stores, accounts, ports } = options;
  const logins = () => accounts.map((a) => a.login);
  const avatars = new Map<string, string>();

  const settings = new SettingsStore(stores.state, {
    scopes: defaultScopes(logins()),
    policy: defaultPolicy,
    identity: { linked: true },
    sandbox: { writeOwners: null },
    logSeenAt: new Date(0).toISOString(),
    views: [],
    ...options.defaults,
  });
  const model = new Model(stores.cache, (login) => {
    const index = logins().indexOf(login);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  });
  const firstPort = () => [...ports.values()][0];
  const registry = new ReleaseRegistry(
    stores.cache,
    async (repo, tag) => (await firstPort()?.releaseDate(repo, tag)) ?? null,
    () => settings.get("policy").privateScopes,
    options.fetcher,
  );
  const verdicts = new Verdicts(stores.state);
  const done = new DoneItems(stores.state);

  let planner: Planner;
  // Re-checked right before each send, with whatever the sync engine knows by then.
  const preflight: Preflight = (command) => {
    const record = model.get(command.prId);
    if (!record) return { ok: false, state: "failed", detail: "PR is no longer tracked" };
    // In sandbox mode nothing outside the sandbox owners is ever written, whatever the kind.
    const sandboxOwners = settings.get("sandbox").writeOwners;
    const owner = record.doc.repo.split("/")[0] ?? "";
    if (sandboxOwners && !sandboxOwners.includes(owner)) {
      return { ok: false, state: "cancelled", detail: `Outside the sandbox (${owner})` };
    }
    // Replies, resolves and viewed marks don't depend on the head; verdicts on the code do.
    if (!HEAD_BOUND.has(command.kind)) return { ok: true };
    if (record.doc.state !== "OPEN") {
      return { ok: false, state: "cancelled", detail: `PR was ${record.doc.state.toLowerCase()}` };
    }
    if (record.doc.headRefOid !== command.expectedHead) {
      return {
        ok: false,
        state: "failed",
        detail: "New commits arrived after you decided; review it again",
      };
    }
    const approving =
      command.kind === "approve" ||
      (command.kind === "review" && command.payload.event === "APPROVE");
    const action = command.kind === "bot-command" ? "rebase" : "approve";
    const skip =
      approving || command.kind === "bot-command"
        ? planner.guard(record, action, { ignoreQueued: true })
        : null;
    return skip ? { ok: false, state: "cancelled", detail: skip } : { ok: true };
  };

  // A waiting approval goes once the PR ahead of it merged. If Dependabot rebased this one in the
  // meantime, the earlier decision still holds as long as the bump and the commit authors didn't
  // change; anything else needs your eyes again.
  const WAIT_LIMIT_MS = 3 * 60 * 60_000;
  const release: Release = (command, predecessor) => {
    const record = model.get(command.prId);
    if (!record) return { action: "stop", state: "failed", detail: "PR is no longer tracked" };
    if (record.doc.state !== "OPEN") {
      return {
        action: "stop",
        state: "cancelled",
        detail: `PR was ${record.doc.state.toLowerCase()}`,
      };
    }
    const ahead = command.afterPr ? model.get(command.afterPr) : undefined;
    const aheadStuck = predecessor === "failed" || predecessor === "cancelled";
    const waitingOn = ahead && ahead.doc.state === "OPEN" && !aheadStuck;
    const notReady = record.doc.mergeable !== "mergeable";
    if (waitingOn || notReady) {
      sync.nudge([command.prId, ...(command.afterPr ? [command.afterPr] : [])], 2 * 60_000);
      if (Date.now() - Date.parse(command.createdAt) < WAIT_LIMIT_MS) return { action: "wait" };
      const who = ahead ? `#${ahead.doc.number}` : "the PR ahead of it";
      return { action: "stop", state: "failed", detail: `Gave up waiting for ${who} to merge` };
    }
    if (record.doc.headRefOid === command.expectedHead) {
      return { action: "queue", expectedHead: command.expectedHead, detail: null };
    }
    const bot = record.bot;
    const sameBumps =
      bot !== null &&
      JSON.stringify(bot.bumps.map(bumpKey).toSorted()) ===
        JSON.stringify([...(command.payload.bumpKeys ?? [])].toSorted());
    const provenance = bot
      ? provenanceGate({ doc: record.doc, bot: bot.bot, policy: settings.get("policy") })
      : null;
    if (sameBumps && provenance?.status === "pass") {
      return {
        action: "queue",
        expectedHead: record.doc.headRefOid,
        detail: "Approving the rebased commit",
      };
    }
    return { action: "stop", state: "failed", detail: "It changed while waiting; review it again" };
  };

  const outbox = new Outbox(stores.state, () => ports, preflight, release);
  planner = new Planner({ model, outbox, verdicts, settings, accounts: logins });
  const drafts = new Drafts(stores.state);
  const details = new Details(stores.cache);
  const views = new Views({
    model,
    outbox,
    verdicts,
    done,
    registry,
    settings,
    accounts: logins,
    now: Date.now,
  });
  const sync = new SyncEngine(model, () => ports, settings, registry, stores.cache);
  const events = new EventHub();
  const review = new ReviewService({
    model,
    ports,
    outbox,
    drafts,
    details,
    sync,
    planner,
    codeOwners: new CodeOwnersCache(ports),
    linked: () => settings.get("identity").linked,
    git: () => options.git ?? null,
  });

  const VIEW_TOPICS: Topic[] = ["inbox", "counts", "group", "flight", "status", "search", "views"];
  model.onChange((ids) => {
    events.emit([...VIEW_TOPICS, "pr"]);
    fetchHumanHeads(ids);
  });

  // Every head of a human PR is fetched into the git store as soon as it's seen: once the author
  // force-pushes, GitHub may stop serving the old one, and "since your last review" needs it.
  const fetchedHeads = new Set<string>();
  function fetchHumanHeads(ids: string[]) {
    const git = options.git;
    if (!git) return;
    for (const id of ids) {
      const record = model.get(id);
      if (!record || record.bot || record.doc.state !== "OPEN") continue;
      const key = `${record.doc.repo}@${record.doc.headRefOid}`;
      if (fetchedHeads.has(key)) continue;
      fetchedHeads.add(key);
      git
        .ensure(record.doc.repo, record.reader, [record.doc.headRefOid])
        .catch((error: unknown) => {
          fetchedHeads.delete(key);
          console.warn(`git fetch ${key}: ${String(error)}`);
        });
    }
  }
  outbox.onChange((prIds) => {
    sync.nudge(prIds);
    events.emit([...VIEW_TOPICS, "log", "pr"]);
  });
  sync.onStatus(() => events.emit(["status"]));
  outbox.onAcked((command) => {
    // Read the PR again straight away: the sweep can't see most of what a write changes (your
    // review, labels, people), and waiting for the next sync leaves it looking untouched.
    const record = model.get(command.prId);
    const aboutNotifications =
      command.kind === "notification-done" || command.kind === "notification-read";
    if (record && !aboutNotifications) sync.markDirty(command.prId, record.reader);
    if (command.kind === "notification-done" && command.payload.threadId) {
      sync.forgetThread(command.account, command.payload.threadId);
    }
  });
  let lastRegistryVersion = registry.version;
  const registryWatch = setInterval(() => {
    if (registry.version === lastRegistryVersion) return;
    lastRegistryVersion = registry.version;
    events.emit(["inbox", "counts", "group"]);
  }, 1_000);

  function accountStatus(account: Account): AccountStatus {
    const port = ports.get(account.login);
    const rates = port?.rates();
    return {
      login: account.login,
      avatarUrl: avatars.get(account.login) ?? `https://github.com/${account.login}.png?size=64`,
      ok: missingScopes(account, REQUIRED_SCOPES).length === 0,
      scopes: account.scopes,
      missingScopes: missingScopes(account, [...REQUIRED_SCOPES, ...OPTIONAL_SCOPES]),
      graphql: rateWindow(rates?.graphql),
      rest: rateWindow(rates?.core),
      writesThisHour: outbox.writesSince(account.login, 3_600_000),
    };
  }

  return {
    settings,
    model,
    views,
    outbox,
    planner,
    sync,
    events,
    verdicts,
    done,
    stores,
    accounts,
    ports,
    async start() {
      await Promise.all(
        [...ports.values()].map(async (port) => {
          try {
            const viewer = await port.viewer();
            avatars.set(port.login, viewer.avatarUrl);
          } catch (error) {
            console.warn(`could not read ${port.login}: ${String(error)}`);
          }
        }),
      );
      outbox.start();
      sync.start();
      fetchHumanHeads([...model.all()].map((r) => r.doc.id));
    },
    stop() {
      sync.stop();
      outbox.stop();
      events.close();
      clearInterval(registryWatch);
    },
    review,
    /**
     * Clears GitHub's notifications about these PRs on every account that has one, so they aren't
     * triaged twice. Held as long as the undo toast, because GitHub can't un-clear a notification.
     */
    clearNotifications(prIds: string[]): string[] {
      const commands = prIds.flatMap((prId) => {
        const record = model.get(prId);
        if (!record) return [];
        const { doc } = record;
        return sync.threadsFor(doc.repo, doc.number).map((thread) => ({
          planId: null,
          account: thread.account,
          kind: "notification-done" as const,
          prId,
          repo: doc.repo,
          number: doc.number,
          title: doc.title,
          expectedHead: doc.headRefOid,
          payload: { threadId: thread.threadId },
          priority: 1 as const,
        }));
      });
      return commands.length > 0 ? outbox.enqueue(commands, 6_000) : [];
    },
    status() {
      const s = sync.getStatus();
      return {
        version: VERSION,
        accounts: accounts.map(accountStatus),
        sync: {
          state: s.state,
          lastSyncAt: s.lastSyncAt,
          trackedPrs: s.trackedPrs,
          message: s.message ?? (s.pending > 0 ? `Reading ${s.pending} PRs` : null),
        },
        outbox: outbox.counts(settings.get("logSeenAt")),
        counts: views.counts(),
      };
    },
  };
}

function rateWindow(w: RateWindow | null | undefined) {
  return w
    ? { remaining: w.remaining, limit: w.limit, resetAt: new Date(w.resetAt).toISOString() }
    : null;
}
