import { type Account, OPTIONAL_SCOPES, REQUIRED_SCOPES, missingScopes } from "@/accounts/gh";
import { VERSION } from "@/config";
import { DoneItems, Verdicts } from "@/domain/decisions";
import { Model } from "@/domain/model";
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
import type { AccountStatus, PrView } from "@pier/core/wire";

// Composition root: builds every part of the daemon from its stores and one GitHub port per
// account, and routes change notifications from the model and outbox to open windows.

export type AppOptions = {
  stores: Stores;
  accounts: Account[];
  ports: Map<string, GitHubPort>;
  /** Overrides applied on first run (e.g. sandbox scopes in E2E). */
  defaults?: Partial<Settings>;
  fetcher?: typeof fetch;
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
    if (record.doc.state !== "OPEN")
      return { ok: false, state: "cancelled", detail: `PR was ${record.doc.state.toLowerCase()}` };
    if (record.doc.headRefOid !== command.expectedHead) {
      return {
        ok: false,
        state: "failed",
        detail: "New commits arrived after you decided; review it again",
      };
    }
    const skip = planner.guard(record, command.kind === "approve" ? "approve" : "rebase", {
      ignoreQueued: true,
    });
    return skip ? { ok: false, state: "cancelled", detail: skip } : { ok: true };
  };

  const outbox = new Outbox(stores.state, () => ports, preflight);
  planner = new Planner({ model, outbox, verdicts, settings, accounts: logins });
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

  const VIEW_TOPICS: Topic[] = ["inbox", "counts", "group", "flight", "status"];
  model.onChange(() => events.emit(VIEW_TOPICS));
  outbox.onChange((prIds) => {
    sync.nudge(prIds);
    events.emit([...VIEW_TOPICS, "log"]);
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
    },
    stop() {
      sync.stop();
      outbox.stop();
      events.close();
      clearInterval(registryWatch);
    },
    /** A single PR for its canvas; loads its files the first time it's opened. */
    async prView(repo: string, number: number): Promise<PrView | null> {
      const record = [...model.all()].find((r) => r.doc.repo === repo && r.doc.number === number);
      if (!record) return null;
      const doc = record.doc;
      if (record.files === null && doc.filesTotal <= 3000) {
        const port = ports.get(record.reader);
        if (port) model.setFiles(doc.id, doc.headRefOid, await port.files(doc.repo, doc.number));
      }
      sync.nudge([doc.id]);
      const review = record.viewers.get(record.reader)?.latestReview;
      return {
        id: doc.id,
        repo: doc.repo,
        number: doc.number,
        title: doc.title,
        url: doc.url,
        body: doc.body,
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
        account: record.reader,
        approvedByYou: review?.state === "APPROVED" && review.commitOid === doc.headRefOid,
        pending: outbox.pending(doc.id),
        files: model.get(doc.id)?.files ?? null,
      };
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
