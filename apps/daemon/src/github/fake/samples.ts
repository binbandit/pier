import type { Random } from "./random";
import type { FileChange } from "./world";

// What people's PRs change: a handful of small, plausible code changes (TypeScript, React, Go,
// docs), each with a follow-up push for "since your last review", plus one big generated file
// for diff performance. Contents are real text so patches, threads and fileText line up.

export type HumanChange = {
  title: string;
  branch: string;
  summary: string;
  files: FileChange[];
  /** A second push that reworks part of the change (after review feedback). */
  followUp: FileChange[];
};

const RESOURCES = ["users", "orders", "invoices", "projects", "webhooks", "events"];
const COMPONENTS = ["Invoice", "Project", "Member", "Deploy", "Billing", "Usage"];
const GO_PACKAGES = ["billing", "search", "ingest", "auth"];

const TEMPLATES: ((rng: Random) => HumanChange)[] = [
  paginate,
  retry,
  loadingState,
  goTimeout,
  docs,
  config,
];

export function humanChange(rng: Random): HumanChange {
  return rng.pick(TEMPLATES)(rng);
}

export const REVIEW_COMMENTS = [
  "Should this handle the empty case?",
  "nit: can we call this `pageSize` to match the API docs?",
  "This will scan the whole table without an index on `id`. Do we have one?",
  "Can we add a test for the 404 path?",
  "Is there a reason not to reuse the existing helper here?",
  "This reads much better, thanks.",
  "What happens if the upstream call times out halfway through?",
];

export const REPLIES = [
  "Good catch, fixed in the latest push.",
  "Added a test for it.",
  "Yes, there's an index from the 0042 migration.",
  "Kept it as is for now; happy to follow up separately.",
];

function paginate(rng: Random): HumanChange {
  const resource = rng.pick(RESOURCES);
  const route = `src/routes/${resource}.ts`;
  const before = `import { Router } from "express";

import { db } from "../db";

export const ${resource}Router = Router();

${resource}Router.get("/", async (_req, res) => {
  const rows = await db.query("SELECT * FROM ${resource} ORDER BY created_at DESC LIMIT 50");
  res.json(rows);
});

${resource}Router.get("/:id", async (req, res) => {
  const row = await db.one("SELECT * FROM ${resource} WHERE id = $1", [req.params.id]);
  res.json(row);
});
`;
  const after = (next: string) => `import { Router } from "express";
import { z } from "zod";

import { db } from "../db";

export const ${resource}Router = Router();

const page = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

${resource}Router.get("/", async (req, res) => {
  const { cursor, limit } = page.parse(req.query);
  const rows = await db.query(
    "SELECT * FROM ${resource} WHERE ($1::text IS NULL OR id < $1) ORDER BY id DESC LIMIT $2",
    [cursor ?? null, limit + 1],
  );
  const hasMore = rows.length > limit;
  res.json({ items: rows.slice(0, limit), next: ${next} });
});

${resource}Router.get("/:id", async (req, res) => {
  const row = await db.oneOrNone("SELECT * FROM ${resource} WHERE id = $1", [req.params.id]);
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(row);
});
`;
  const test = `import { describe, expect, test } from "vitest";

import { request } from "./helpers";

describe("GET /${resource}", () => {
  test("returns a page and a cursor", async () => {
    const res = await request.get("/${resource}?limit=2");
    expect(res.body.items).toHaveLength(2);
    expect(res.body.next).toBeTypeOf("string");
  });

  test("404s for an unknown id", async () => {
    const res = await request.get("/${resource}/missing");
    expect(res.status).toBe(404);
  });
});
`;
  return {
    title: `Paginate ${resource} with cursors`,
    branch: `feat/${resource}-pagination`,
    summary: `Replaces the fixed 50-row listing for ${resource} with cursor pagination, and returns 404 for unknown ids instead of a 500.`,
    files: [
      { path: route, before, after: after("hasMore ? rows[limit - 1].id : null") },
      { path: `test/${resource}.test.ts`, before: null, after: test },
    ],
    followUp: [{ path: route, after: after("hasMore ? (rows.at(limit - 1)?.id ?? null) : null") }],
  };
}

function retry(rng: Random): HumanChange {
  const attempts = rng.int(3, 6);
  const before = `export async function retry<T>(run: () => Promise<T>, attempts = ${attempts}): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      await sleep(2 ** attempt * 100);
    }
  }
  throw lastError;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
`;
  const after = (cap: number) => `export type RetryOptions = {
  attempts?: number;
  /** Upper bound for a single wait, so a long outage doesn't stall callers for minutes. */
  maxDelayMs?: number;
};

export async function retry<T>(run: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = ${attempts}, maxDelayMs = ${cap} } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      // Full jitter: spreads retries out so clients don't stampede a recovering service.
      const ceiling = Math.min(maxDelayMs, 2 ** attempt * 100);
      await sleep(Math.random() * ceiling);
    }
  }
  throw lastError;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
`;
  return {
    title: "Retry transient failures with full jitter",
    branch: "fix/retry-jitter",
    summary:
      "Retries now use full jitter with a capped delay, so a burst of failures doesn't make every client retry in lockstep.",
    files: [{ path: "src/lib/retry.ts", before, after: after(5_000) }],
    followUp: [{ path: "src/lib/retry.ts", after: after(2_000) }],
  };
}

function loadingState(rng: Random): HumanChange {
  const name = rng.pick(COMPONENTS);
  const path = `src/components/${name}Card.tsx`;
  const before = `import { use${name} } from "@/hooks/use-${name.toLowerCase()}";

export function ${name}Card({ id }: { id: string }) {
  const { data } = use${name}(id);
  return (
    <section className="rounded-lg border p-4">
      <h3 className="text-sm font-medium">{data?.name}</h3>
      <p className="text-muted-foreground text-xs">{data?.description}</p>
    </section>
  );
}
`;
  const after = (skeleton: string) => `import { Skeleton } from "@/components/ui/skeleton";
import { use${name} } from "@/hooks/use-${name.toLowerCase()}";

export function ${name}Card({ id }: { id: string }) {
  const { data, isPending, error } = use${name}(id);
  if (isPending) return <Skeleton className="${skeleton}" />;
  if (error) return <p className="text-destructive text-xs">Couldn't load this ${name.toLowerCase()}.</p>;
  return (
    <section className="rounded-lg border p-4">
      <h3 className="text-sm font-medium">{data.name}</h3>
      <p className="text-muted-foreground text-xs">{data.description}</p>
    </section>
  );
}
`;
  return {
    title: `Show a skeleton while ${name}Card loads`,
    branch: `ui/${name.toLowerCase()}-card-loading`,
    summary: `${name}Card rendered empty text while loading and nothing on error. It now shows a skeleton, and a short message when the request fails.`,
    files: [{ path, before, after: after("h-20 w-full") }],
    followUp: [{ path, after: after("h-[84px] w-full rounded-lg") }],
  };
}

function goTimeout(rng: Random): HumanChange {
  const pkg = rng.pick(GO_PACKAGES);
  const path = `internal/${pkg}/client.go`;
  const before = `package ${pkg}

import (
	"net/http"
)

type Client struct {
	base string
	http *http.Client
}

func New(base string) *Client {
	return &Client{base: base, http: http.DefaultClient}
}

func (c *Client) Get(path string) (*http.Response, error) {
	return c.http.Get(c.base + path)
}
`;
  const after = (timeout: string) => `package ${pkg}

import (
	"context"
	"net/http"
	"time"
)

type Client struct {
	base string
	http *http.Client
}

func New(base string) *Client {
	return &Client{base: base, http: &http.Client{Timeout: ${timeout}}}
}

func (c *Client) Get(ctx context.Context, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return nil, err
	}
	return c.http.Do(req)
}
`;
  return {
    title: `Time out ${pkg} client calls`,
    branch: `fix/${pkg}-client-timeout`,
    summary: `The ${pkg} client used http.DefaultClient, which never times out. Calls now take a context and the client has a timeout.`,
    files: [{ path, before, after: after("10 * time.Second") }],
    followUp: [{ path, after: after("5 * time.Second") }],
  };
}

const README = `# Service

## Development

\`\`\`sh
npm install
npm run dev
\`\`\`
`;

function readme(port: number): string {
  return `# Service

## Development

\`\`\`sh
npm install
cp .env.example .env
npm run dev
\`\`\`

The server listens on http://localhost:${port}. Set \`DATABASE_URL\` in \`.env\` to point at your local Postgres.

## Tests

\`\`\`sh
npm test
\`\`\`
`;
}

function docs(): HumanChange {
  return {
    title: "Document local setup and tests",
    branch: "docs/local-setup",
    summary:
      "New joiners kept asking how to run this locally. Adds the env file step and how to run tests.",
    files: [{ path: "README.md", before: README, after: readme(3000) }],
    followUp: [{ path: "README.md", after: readme(8080) }],
  };
}

function config(rng: Random): HumanChange {
  const flag = rng.pick(["AUDIT_LOG", "NEW_BILLING", "FAST_SEARCH"]);
  const before = `import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
});

export const config = schema.parse(process.env);
`;
  const after = (fallback: string) => `import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  ${flag}: z.enum(["on", "off"]).default("${fallback}"),
});

export const config = schema.parse(process.env);
`;
  return {
    title: `Add ${flag} feature flag`,
    branch: `feat/${flag.toLowerCase().replaceAll("_", "-")}-flag`,
    summary: `Adds the ${flag} flag so the rollout can be toggled per environment.`,
    files: [{ path: "src/config.ts", before, after: after("off") }],
    followUp: [{ path: "src/config.ts", after: after("on") }],
  };
}

/** A generated client of roughly `lines` lines, for diff performance (j/k on a 5,000-line diff). */
export function bigChange(lines = 5_200): HumanChange {
  const out = ["// Code generated by openapi-gen. DO NOT EDIT.", ""];
  for (let i = 0; out.length < lines; i++) {
    out.push(
      `export type Resource${i} = {`,
      "  id: string;",
      `  name: string;`,
      `  createdAt: string;`,
      "};",
      "",
      `export async function getResource${i}(id: string): Promise<Resource${i}> {`,
      `  const res = await fetch(\`/api/v3/resource-${i}/\${id}\`);`,
      "  if (!res.ok) throw new Error(`HTTP ${res.status}`);",
      `  return (await res.json()) as Resource${i};`,
      "}",
      "",
    );
  }
  const text = `${out.join("\n")}\n`;
  return {
    title: "Regenerate the API client from the v3 schema",
    branch: "chore/regenerate-api-client",
    summary: "Regenerated with openapi-gen 4.2. No hand edits; the diff is all generated code.",
    files: [{ path: "src/gen/api.ts", before: null, after: text }],
    followUp: [{ path: "src/gen/api.ts", after: text.replace("openapi-gen.", "openapi-gen 4.2.") }],
  };
}

/**
 * The tail of an Actions job log, as GitHub serves it (timestamps already stripped). Failing
 * jobs end with one `##[error]` line; which tool failed follows the job's name.
 */
export function jobLogLines(job: string, failed: boolean): string[] {
  const name = job.toLowerCase();
  if (name.includes("lint") || name.includes("clippy")) {
    return [
      "##[group]Run npm run lint",
      "> lint",
      "> eslint .",
      "##[endgroup]",
      "",
      ...(failed
        ? [
            "/home/runner/work/app/app/src/lib/retry.ts",
            "  14:7  error  'lastError' is never reassigned. Use 'const' instead  prefer-const",
            "",
            "✖ 1 problem (1 error, 0 warnings)",
            "##[error]Process completed with exit code 1.",
          ]
        : ["Done in 4.2s."]),
    ];
  }
  if (name.includes("test") || name.includes("e2e")) {
    return [
      "##[group]Run npm test",
      "> test",
      "> vitest run",
      "##[endgroup]",
      " ✓ src/lib/retry.test.ts (4 tests) 12ms",
      " ✓ src/routes/users.test.ts (6 tests) 48ms",
      ...(failed
        ? [
            " ❯ src/routes/orders.test.ts (5 tests | 1 failed) 61ms",
            "   × GET /orders > returns a page and a cursor 9ms",
            "     → expected undefined to be type of 'string'",
            "",
            " Test Files  1 failed | 2 passed (3)",
            "      Tests  1 failed | 14 passed (15)",
            "##[error]Process completed with exit code 1.",
          ]
        : [" ✓ src/routes/orders.test.ts (5 tests) 61ms", "", "      Tests  15 passed (15)"]),
    ];
  }
  return [
    "##[group]Run npm run build",
    "> build",
    "> tsc -p tsconfig.json",
    "##[endgroup]",
    ...(failed
      ? [
          "src/routes/orders.ts(21,40): error TS2532: Object is possibly 'undefined'.",
          "##[error]Process completed with exit code 2.",
        ]
      : ["Build finished in 9.8s."]),
  ];
}
