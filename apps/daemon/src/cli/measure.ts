import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

import { type } from "arktype";

import { type Account, discoverAccounts, readToken } from "@/accounts/gh";
import { paths } from "@/config";
import { type Scope, defaultScopes, settingSchemas } from "@/domain/settings";
import { GitHubClient } from "@/github/client";
import { TypedDocumentString } from "@/github/gql/graphql";
import { HYDRATE_BATCH, SWEEP_BATCH, isPullHit } from "@/github/live";
import { HydrateQuery, RateLimitQuery, SearchPullsQuery, SweepQuery } from "@/github/ops";
import { memoryStores } from "@/store/db";
import { FULL_SEARCH_EVERY_MS, HOT_SWEEP_MS, SEARCH_EVERY_MS, WARM_SWEEP_MS } from "@/sync/engine";

// `pier doctor --measure`: what keeping up with these accounts would cost, before relying on
// pier for them. Read-only: it counts each scope's open PRs (one search each), prices the
// queries the sync runs with GitHub's dry run (which costs nothing), and estimates the hourly
// GraphQL points against the 5,000 GitHub allows each account.

const HOURLY_POINTS = 5_000;
/** Assumptions the estimate needs; the sync's real numbers depend on how busy the day is. */
const HOT_PRS = 50;
const CHANGES_PER_PR_PER_DAY = 2;

export async function measure(): Promise<void> {
  const accounts = await discoverAccounts();
  const scopes = configuredScopes(accounts.map((a) => a.login));
  const cache = memoryStores().cache;
  console.log("");
  for (const account of accounts) {
    const client = new GitHubClient(account.login, readToken, cache);
    await measureAccount(
      client,
      account,
      scopes.filter((s) => s.account === account.login),
    );
  }
}

async function measureAccount(client: GitHubClient, account: Account, scopes: Scope[]) {
  console.log(account.login);
  if (scopes.length === 0) {
    console.log("  no scopes watched\n");
    return;
  }
  const counted = await Promise.all(
    scopes.map(async (scope) => {
      const data = await client.graphql(SearchPullsQuery, { query: scope.query, after: null });
      const ids = (data.search.nodes ?? []).filter(isPullHit).map((hit) => hit.id);
      return { scope, open: data.search.issueCount, ids };
    }),
  );
  for (const { scope, open } of counted) {
    console.log(`  ${String(open).padStart(6)} open  ${scope.kind}  ${scope.query}`);
  }
  // Scopes overlap (a PR you're asked to review can also be a bot's), so this is the most.
  const prs = counted.reduce((sum, c) => sum + c.open, 0);
  const ids = [...new Set(counted.flatMap((c) => c.ids))];

  const search = await cost(client, SearchPullsQuery, {
    query: scopes[0]?.query ?? "",
    after: null,
  });
  // Priced as full batches, as the sync sends them once there are enough PRs.
  const sweep = await cost(client, SweepQuery, { ids: batchOf(ids, SWEEP_BATCH) });
  const hydrate = await cost(client, HydrateQuery, { ids: batchOf(ids, HYDRATE_BATCH) });
  const busy = Math.min(HOT_PRS, prs);
  const pages = counted.reduce((sum, c) => sum + Math.max(1, Math.ceil(c.open / 100)), 0);
  const budget = [
    ["searching for changes", scopes.length * perHour(SEARCH_EVERY_MS) * search],
    ["full searches", pages * perHour(FULL_SEARCH_EVERY_MS) * search],
    ["sweeping open PRs", Math.ceil(prs / SWEEP_BATCH) * perHour(WARM_SWEEP_MS) * sweep],
    [`sweeping ${busy} busy PRs`, Math.ceil(busy / SWEEP_BATCH) * perHour(HOT_SWEEP_MS) * sweep],
    [
      `reading changed PRs (each ${CHANGES_PER_PR_PER_DAY}x a day)`,
      Math.ceil((prs * CHANGES_PER_PR_PER_DAY) / 24 / HYDRATE_BATCH) * hydrate,
    ],
  ] as const;
  const total = budget.reduce((sum, [, points]) => sum + points, 0);

  console.log(
    `  query cost: search ${search}, sweep of ${SWEEP_BATCH} ${sweep}, read of ${HYDRATE_BATCH} ${hydrate}`,
  );
  for (const [what, points] of budget) {
    console.log(`  ${String(Math.round(points)).padStart(6)} points/hour  ${what}`);
  }
  const share = Math.round((total / HOURLY_POINTS) * 100);
  const now = await client.graphql(RateLimitQuery, {});
  const advice = share > 60 ? "  (high: narrow the bot scopes in settings)" : "";
  console.log(
    `  ${String(Math.round(total)).padStart(6)} points/hour in all, ${share}% of ${HOURLY_POINTS}${advice}`,
  );
  console.log(
    `  right now: ${now.rateLimit?.remaining ?? "?"} of ${now.rateLimit?.limit ?? "?"} left this hour\n`,
  );
}

/** `size` PR ids, repeating the ones there are (pricing doesn't mind repeats). */
function batchOf(ids: string[], size: number): string[] {
  return ids.length === 0 ? [] : Array.from({ length: size }, (_, i) => ids[i % ids.length] ?? "");
}

function perHour(everyMs: number): number {
  return 3_600_000 / everyMs;
}

/** What a query costs, from GitHub's dry run of it: priced, not run, and free. */
async function cost<R, V>(client: GitHubClient, doc: TypedDocumentString<R, V>, variables: V) {
  const priced = new TypedDocumentString<{ rateLimit: { cost: number } | null }, V>(
    doc.toString().replace("{", "{ rateLimit(dryRun: true) { cost } "),
  );
  const data = await client.graphql(priced, variables);
  return data.rateLimit?.cost ?? 0;
}

/** The scopes pier is set to watch, or what it would start with. */
function configuredScopes(logins: string[]): Scope[] {
  if (existsSync(paths.stateDb)) {
    const db = new Database(paths.stateDb, { readonly: true });
    const row = db
      .query<{ json: string }, []>("SELECT json FROM setting WHERE key = 'scopes'")
      .get();
    db.close();
    const parsed = row ? settingSchemas.scopes(JSON.parse(row.json)) : null;
    if (parsed && !(parsed instanceof type.errors)) return parsed;
  }
  return defaultScopes(logins);
}
