import type { Database } from "bun:sqlite";

import { type } from "arktype";

import {
  type DepsPolicy,
  PERSONAL_QUERY,
  type Scope,
  botsQuery,
  depsPolicySchema,
  scopeSchema,
} from "@pier/core/settings";

// Settings live in state.db as one JSON row per key, validated on read so a hand-edited or
// older value can never crash the daemon; anything invalid falls back to its default.

const identity = type({
  /** All gh accounts belong to one person: no alt-account approvals of your own PRs. */
  linked: "boolean",
});

const sandbox = type({
  /** When set, every write outside these repo owners is refused. Used for live E2E runs. */
  writeOwners: "string[] | null",
});

export const settingSchemas = {
  scopes: scopeSchema.array(),
  policy: depsPolicySchema,
  identity,
  sandbox,
  /** When the Log was last looked at; failed writes after it are the ones still to see. */
  logSeenAt: type("string"),
  /** Replies you use often, inserted from any comment box with Ctrl+. */
  replies: type({ id: "string", title: "string", body: "string" }).array(),
  /** Saved searches, shown in the sidebar under the splits. */
  views: type({ id: "string", name: "string", query: "string" }).array(),
} as const;

export type { DepsPolicy, Scope };
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
      query: PERSONAL_QUERY,
    },
    {
      id: `${account}:bots`,
      account,
      kind: "bots" as const,
      query: botsQuery(account),
    },
  ]);
}

export class SettingsStore {
  /** Bumped on every change, so views built from settings know to rebuild. */
  version = 0;

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
    this.version++;
  }
}
