// Read-only smoke test of the live GitHub port against a real account: `bun scripts/smoke.ts <login>`.
import { readToken } from "@/accounts/gh";
import { GitHubClient } from "@/github/client";
import { LiveGitHub } from "@/github/live";
import { HydrateQuery, SweepQuery } from "@/github/ops";
import { memoryStores } from "@/store/db";

const login = Bun.argv[2] ?? "binbandit";
const query = Bun.argv[3] ?? `is:pr is:open author:app/dependabot user:${login}`;
const { cache } = memoryStores();
const client = new GitHubClient(login, readToken, cache);
const gh = new LiveGitHub(client);

const time = async <T>(label: string, fn: () => Promise<T>) => {
  const start = performance.now();
  const result = await fn();
  console.log(`${label.padEnd(14)} ${Math.round(performance.now() - start)}ms`);
  return result;
};

console.log(await time("viewer", () => gh.viewer()));
const hits = await time("search", () => gh.search(query));
console.log(`  ${hits.length} hits`);
const ids = hits.slice(0, 100).map((h) => h.id);
const swept = await time("sweep x100", () => gh.sweep(ids));
console.log(
  `  ${swept.length} swept; states`,
  Object.groupBy(swept, (s) => s.rollup),
);
const hydrated = await time("hydrate x25", () => gh.hydrate(ids.slice(0, 25)));
const sample = hydrated[0]!.doc;
console.log(
  `  ${hydrated.length} docs; e.g. ${sample.repo}#${sample.number} ${sample.title}; body ${sample.body.length}B; files ${sample.files.length}; commits ${sample.commits.length}; checks`,
  sample.checks.state,
);
const files = await time("files", () => gh.files(sample.repo, sample.number));
console.log(
  `  ${files.length} files: ${files.map((f) => `${f.path} (${f.patch?.length ?? "no"} patch)`).join(", ")}`,
);
const again = await time("files (etag)", () => gh.files(sample.repo, sample.number));
console.log(`  ${again.length} files again`);
const notes = await time("notifications", () => gh.notifications());
console.log(
  `  changed=${notes.changed} poll=${notes.pollIntervalSec}s ${notes.changed ? notes.threads.length + " threads" : ""}`,
);
const notes2 = await time("notif (304)", () => gh.notifications());
console.log(`  changed=${notes2.changed}`);
console.log("rates", gh.rates());

// Price the batch queries without running them.
for (const [name, doc, vars] of [
  ["Sweep x100", SweepQuery, { ids }],
  ["Hydrate x25", HydrateQuery, { ids: ids.slice(0, 25) }],
] as const) {
  const priced = doc.toString().replace(/\{/, "{ rateLimit(dryRun: true) { cost } ");
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${await readToken(login)}`,
      "content-type": "application/json",
      "x-github-next-global-id": "1",
    },
    body: JSON.stringify({ query: priced, variables: vars }),
  });
  const body = (await response.json()) as {
    data?: { rateLimit?: { cost: number } };
    errors?: unknown;
  };
  console.log(`cost ${name}:`, body.data?.rateLimit?.cost ?? body.errors);
}
