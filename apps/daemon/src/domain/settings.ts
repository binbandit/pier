import type { Database } from "bun:sqlite";

import { type } from "arktype";

// Settings live in state.db as one JSON row per key, validated on read so a hand-edited or
// older value can never crash the daemon; anything invalid falls back to its default.

const scope = type({
  id: "string",
  account: "string",
  query: "string",
  kind: "'personal' | 'bots'",
});

const botPolicy = type({
  /** Commit author names (or logins) allowed on a bot branch. */
  authors: "string[]",
  requireSigned: "boolean",
  /** Allow "Merge branch 'main' into …" commits that only bring in the base. */
  allowBaseMerges: "boolean",
});

const policy = type({
  minReleaseAgeDays: "number >= 0",
  allowedSemver: "('major' | 'minor' | 'patch')[]",
  /** Brayden's repos merge on approval, so approving is useful even where rules don't require it. */
  approveWhenNotRequired: "boolean",
  staleAfterDays: "number > 0",
  verdictTtlDays: "number > 0",
  /** npm scopes (e.g. "@acme") that must never be looked up in public registries. */
  privateScopes: "string[]",
  bots: { dependabot: botPolicy, renovate: botPolicy },
});

const identity = type({
  /** All gh accounts belong to one person: no alt-account approvals of your own PRs. */
  linked: "boolean",
});

const sandbox = type({
  /** When set, every write outside these repo owners is refused. Used for live E2E runs. */
  writeOwners: "string[] | null",
});

export const settingSchemas = {
  scopes: scope.array(),
  policy,
  identity,
  sandbox,
  /** When the Log was last looked at; failed writes after it are the ones still to see. */
  logSeenAt: type("string"),
  /** Saved searches, shown in the sidebar under the splits. */
  views: type({ id: "string", name: "string", query: "string" }).array(),
} as const;

export type Scope = typeof scope.infer;
export type DepsPolicy = typeof policy.infer;
export type SettingKey = keyof typeof settingSchemas;
export type Settings = { [K in SettingKey]: (typeof settingSchemas)[K]["infer"] };

export const defaultPolicy: DepsPolicy = {
  minReleaseAgeDays: 3,
  allowedSemver: ["patch", "minor"],
  approveWhenNotRequired: true,
  staleAfterDays: 30,
  verdictTtlDays: 14,
  privateScopes: [],
  bots: {
    dependabot: { authors: ["dependabot[bot]"], requireSigned: true, allowBaseMerges: true },
    renovate: {
      authors: ["renovate[bot]", "renovate-bot", "mend-renovate[bot]"],
      requireSigned: false,
      allowBaseMerges: true,
    },
  },
};

/** Out of the box: anything you're involved in, plus bot PRs on repos each account owns. */
export function defaultScopes(accounts: string[]): Scope[] {
  return accounts.flatMap((account) => [
    {
      id: `${account}:involved`,
      account,
      kind: "personal" as const,
      query:
        "is:pr is:open archived:false (involves:@me OR review-requested:@me OR reviewed-by:@me)",
    },
    {
      id: `${account}:bots`,
      account,
      kind: "bots" as const,
      query: `is:pr is:open archived:false (author:app/dependabot OR author:app/renovate) user:${account}`,
    },
  ]);
}

export class SettingsStore {
  constructor(
    private readonly db: Database,
    private readonly defaults: Settings,
  ) {}

  get<K extends SettingKey>(key: K): Settings[K] {
    const row = this.db
      .query<{ json: string }, [string]>("SELECT json FROM setting WHERE key = ?")
      .get(key);
    if (!row) return this.defaults[key];
    const parsed = settingSchemas[key](JSON.parse(row.json));
    if (parsed instanceof type.errors) {
      console.warn(`setting ${key} is invalid (${parsed.summary}); using the default`);
      return this.defaults[key];
    }
    return parsed as Settings[K];
  }

  set<K extends SettingKey>(key: K, value: Settings[K]): void {
    const parsed = settingSchemas[key](value);
    if (parsed instanceof type.errors) throw new Error(`invalid ${key}: ${parsed.summary}`);
    this.db
      .query(
        "INSERT INTO setting (key, json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET json = excluded.json",
      )
      .run(key, JSON.stringify(value));
  }
}
