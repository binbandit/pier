import { type Account, OPTIONAL_SCOPES, REQUIRED_SCOPES, missingScopes } from "@/accounts/gh";
import { VERSION } from "@/config";
import { DoneItems, Verdicts } from "@/domain/decisions";
import { Details } from "@/domain/details";
import { Drafts } from "@/domain/drafts";
import { Model } from "@/domain/model";
import { type InterdiffSource, ReviewService } from "@/domain/review";
import { SettingsStore, type Settings, defaultPolicy, defaultScopes } from "@/domain/settings";
import { Views } from "@/domain/views";
import type { RateWindow } from "@/github/client";
import type { GitHubPort } from "@/github/port";
import { EventHub } from "@/http/events";
import { Outbox, type Preflight } from "@/outbox/outbox";
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

export function createApp(options: AppOptions) {
  const { stores, accounts, ports } = options;
  const logins = () => accounts.map((a) => a.login);
  const avatars = new Map<string, string>();

  const settings = new SettingsStore(stores.state, {
    scopes: defaultScopes(logins()),
    policy: defaultPolicy,
    identity: { linked: true },
    sandbox: { writeOwners: null },
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
    // Replies, resolves and viewed marks don't depend on the head; verdicts on the code do.
    if (command.kind !== "approve" && command.kind !== "review" && command.kind !== "bot-command") {
      return { ok: true };
    }
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

  const outbox = new Outbox(stores.state, () => ports, preflight);
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
    git: () => options.git ?? null,
  });

  const VIEW_TOPICS: Topic[] = ["inbox", "counts", "group", "flight", "status"];
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
        outbox: outbox.counts(),
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
