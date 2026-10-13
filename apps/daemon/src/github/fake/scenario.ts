import type { Account } from "@/accounts/gh";
import { classify } from "@/domain/bumps";
import { type Settings, defaultScopes } from "@/domain/settings";
import type { GitHubPort } from "@/github/port";
import type { SemverClass } from "@pier/core/wire";

import {
  type BotStyle,
  type DependencyType,
  type PlannedBump,
  dependabotPr,
  renovatePr,
} from "./bots";
import {
  ADVISORIES,
  CATALOG,
  type CatalogEcosystem,
  type CatalogEntry,
  NEW_INSTALL_SCRIPTS,
} from "./catalog";
import { patchHunks } from "./diff";
import { FakeGitHub } from "./port";
import { Random } from "./random";
import { type HumanChange, REPLIES, REVIEW_COMMENTS, bigChange, humanChange } from "./samples";
import {
  type ChecksInput,
  type CommitInput,
  type FakePr,
  type FakeRepo,
  FakeWorld,
  type RepoOptions,
  type WorldOptions,
} from "./world";

// Ready-made worlds. "sandbox" mirrors the live sandbox (three repos, a dozen bot PRs, a few
// human PRs between the linked accounts); "work" is the scale scenario: ~300 repos across four
// orgs, ~2,000 Dependabot PRs plus Renovate, and the human PRs of a busy reviewer.

export type Preset = "sandbox" | "work";

export type ScenarioOptions = WorldOptions & {
  preset: Preset;
  /** gh accounts in gh's order; the first is "you". */
  accounts?: string[];
};

export const DEFAULT_ACCOUNTS = ["binbandit", "sage-smudge", "WastedHippie"];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function generateScenario(options: ScenarioOptions): FakeWorld {
  const { preset, accounts = DEFAULT_ACCOUNTS, ...worldOptions } = options;
  const world = new FakeWorld(worldOptions);
  world.accounts = [...accounts];
  for (const login of accounts) world.addUser(login, { name: displayName(login) });
  const builder = new Builder(world, new Random((worldOptions.seed ?? 1) * 7_919 + 104_729));
  if (preset === "sandbox") builder.sandbox();
  else builder.work();
  world.tick();
  return world;
}

/** One port per account, as main.ts builds `LiveGitHub`s. */
export function createFakePorts(
  world: FakeWorld,
  logins: string[] = world.accounts,
): Map<string, GitHubPort> {
  return new Map(logins.map((login) => [login, new FakeGitHub(world, login)]));
}

/** What `discoverAccounts()` would report for the world's accounts. */
export function createFakeAccounts(world: FakeWorld): Account[] {
  return world.accounts.map((login, i) => ({
    login,
    scopes: ["gist", "read:org", "read:project", "read:user", "repo", "workflow"],
    active: i === 0,
  }));
}

/**
 * First-run settings that fit the world: the default scopes plus "you" watching bot PRs in every
 * org you're in (or the sandbox owner's repos). The sandbox treats accounts as separate people,
 * like the live sandbox, so one can review another's PR.
 */
export function fakeDefaults(world: FakeWorld, preset: Preset): Partial<Settings> {
  const scopes = defaultScopes(world.accounts);
  const [you] = world.accounts;
  if (you) {
    const owners =
      preset === "sandbox"
        ? [...new Set([...world.repos.values()].map((r) => r.owner))].filter((o) => o !== you)
        : [...world.orgs].filter(([, members]) => members.has(you)).map(([org]) => org);
    for (const owner of owners) {
      scopes.push({
        id: `${you}:bots:${owner}`,
        account: you,
        kind: "bots",
        query: `is:pr is:open archived:false (author:app/dependabot OR author:app/renovate) user:${owner}`,
      });
    }
  }
  return { scopes, identity: { linked: preset !== "sandbox" } };
}

/** Answers deps.dev and registry.npmjs.org from the world's packages, so gates run offline. */
export function fakeRegistryFetch(world: FakeWorld): typeof fetch {
  const respond = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (url.hostname === "api.deps.dev") return depsDev(world, segments);
    if (url.hostname === "registry.npmjs.org") return npmRegistry(world, segments);
    return new Response("Not Found", { status: 404 });
  };
  return Object.assign(respond, { preconnect: fetch.preconnect });
}

// ---------------------------------------------------------------------------

type Stack = "node-service" | "web-app" | "go-service" | "rust-tool" | "library";

/** Teams own org code, so files come out "yours" through team membership. */
const ORG_CODEOWNERS: Record<string, string> = {
  northwind: "* @northwind/platform\n/docs/ @northwind/writers\n",
  "lumen-labs": "/src/ @lumen-labs/web\n*.md @lumen-labs/docs\n",
};

const STACKS: Record<Stack, { ecosystems: [CatalogEcosystem, number][]; checks: string[] }> = {
  "node-service": {
    ecosystems: [
      ["npm", 72],
      ["github-actions", 14],
      ["docker", 14],
    ],
    checks: ["build", "test (20.x)", "test (22.x)", "lint"],
  },
  "web-app": {
    ecosystems: [
      ["npm", 86],
      ["github-actions", 14],
    ],
    checks: ["build", "test", "lint", "e2e"],
  },
  "go-service": {
    ecosystems: [
      ["gomod", 65],
      ["github-actions", 20],
      ["docker", 15],
    ],
    checks: ["build", "test", "golangci-lint"],
  },
  "rust-tool": {
    ecosystems: [
      ["cargo", 75],
      ["github-actions", 25],
    ],
    checks: ["check", "test", "clippy"],
  },
  library: {
    ecosystems: [
      ["npm", 86],
      ["github-actions", 14],
    ],
    checks: ["build", "test", "lint"],
  },
};

const DEV_PACKAGES = new Set([
  "typescript",
  "eslint",
  "vite",
  "vitest",
  "@types/node",
  "@types/react",
  "prettier",
  "jest",
  "@babel/core",
  "webpack",
  "@playwright/test",
  "msw",
  "@testing-library/react",
  "@typescript-eslint/parser",
  "lint-staged",
  "turbo",
  "nodemon",
  "rollup",
  "esbuild",
]);

const ORGS: [string, number][] = [
  ["northwind", 110],
  ["lumen-labs", 90],
  ["orbital-io", 60],
  ["kestrel-dev", 40],
];

const COLLEAGUES = [
  "mira-chen",
  "tobias-k",
  "priya-raman",
  "jonas-weber",
  "ava-lindqvist",
  "kenji-sato",
  "lucia-romero",
  "sam-okafor",
  "noor-haddad",
  "eli-brooks",
  "freya-nilsen",
  "dmitri-volkov",
  "aisha-bello",
  "matteo-ricci",
  "hana-kim",
  "owen-price",
  "zara-ahmed",
  "leo-martins",
  "ines-duarte",
  "ravi-menon",
];

const REPO_PREFIXES = [
  "billing",
  "auth",
  "search",
  "ingest",
  "payments",
  "notify",
  "catalog",
  "checkout",
  "identity",
  "ledger",
  "metrics",
  "reports",
  "scheduler",
  "storage",
  "gateway",
  "profile",
  "inventory",
  "shipping",
  "pricing",
  "analytics",
  "audit",
  "chat",
  "docs",
  "export",
  "feeds",
  "geo",
  "media",
  "onboarding",
  "orders",
  "rules",
];
const REPO_SUFFIXES = [
  "api",
  "service",
  "web",
  "worker",
  "ui",
  "cli",
  "sdk",
  "jobs",
  "admin",
  "proxy",
];

const SEMVER_WEIGHTS: Record<Exclude<SemverClass, "unknown">, number> = {
  patch: 55,
  minor: 30,
  major: 15,
};

type RepoPlan = {
  repo: FakeRepo;
  bot: "dependabot" | "renovate";
  ecosystems: [CatalogEcosystem, number][];
  npmDir: string;
  style: BotStyle;
  /** `${ecosystem}:${name}` with an open bot PR already. */
  used: Set<string>;
};

type BotPrPlan = {
  bumps: PlannedBump[];
  group: string | null;
  createdAt: number;
  checks: "success" | "failure" | "pending" | "none";
  conflict: boolean;
  /** Someone pushed to the bot's branch (fails provenance), or merged the base in (allowed). */
  extraCommit: "human" | "base-merge" | null;
  newDeps: string[];
};

class Builder {
  private readonly you: string;
  private readonly orgPeople = new Map<string, string[]>();

  constructor(
    private readonly world: FakeWorld,
    private readonly rng: Random,
  ) {
    this.you = world.accounts[0] ?? "you";
  }

  // -------------------------------------------------------------------------
  // Presets

  sandbox(): void {
    const { world } = this;
    const [you = "you", other = you, owner = other] = world.accounts;
    this.publishCatalog(["typescript"]);
    const collaborators = Object.fromEntries(
      world.accounts.filter((a) => a !== owner).map((a) => [a, "WRITE" as const]),
    );
    const repo = (name: string, stack: Stack, options: RepoOptions = {}) =>
      world.addRepo(`${owner}/${name}`, {
        collaborators,
        watchers: [owner],
        checkNames: STACKS[stack].checks,
        ...options,
      });
    // Owned by the repo's owner, except the routes (yours) and the tests and docs (the other's).
    const codeOwners = [
      `* @${owner}`,
      `/src/routes/ @${you}`,
      `/test/ @${other}`,
      `*.md @${other}`,
    ].join("\n");
    const web = this.plan(
      repo("sandbox-web", "web-app", { automergeOnApproval: true, codeOwners }),
      "web-app",
      "dependabot",
    );
    const api = this.plan(
      repo("sandbox-api", "go-service", { automergeOnApproval: true, dismissStaleReviews: true }),
      "go-service",
      "dependabot",
    );
    const cli = this.plan(repo("sandbox-cli", "library"), "library", "renovate");

    const bump = (
      plan: RepoPlan,
      ecosystem: CatalogEcosystem,
      name: string,
      from: string,
      to: string,
    ) => {
      const entry = CATALOG[ecosystem].find((e) => e.name === name);
      if (!entry) throw new Error(`no catalog entry for ${name}`);
      plan.used.add(`${ecosystem}:${name}`);
      return this.planned(plan, entry, from, to);
    };
    const open = (plan: RepoPlan, bumps: PlannedBump[], extra: Partial<BotPrPlan> = {}) =>
      this.openBotPr(plan, {
        bumps,
        group: null,
        createdAt: this.createdAfterRelease(bumps),
        checks: "success",
        conflict: false,
        extraCommit: null,
        newDeps: [],
        ...extra,
      });

    open(web, [bump(web, "github-actions", "actions/checkout", "4", "5")]);
    open(api, [bump(api, "github-actions", "actions/checkout", "4", "5")]);
    open(web, [bump(web, "npm", "lodash", "4.17.20", "4.17.21")]);
    open(cli, [bump(cli, "npm", "lodash", "4.17.19", "4.17.21")]);
    open(web, [bump(web, "npm", "typescript", "5.8.3", "5.9.3")]);
    open(cli, [bump(cli, "npm", "typescript", "5.9.2", "5.9.3")], {
      newDeps: ["@typescript/native-preview"],
    });
    open(
      web,
      [
        bump(web, "npm", "react", "19.1.1", "19.2.1"),
        bump(web, "npm", "react-dom", "19.1.1", "19.2.1"),
        bump(web, "npm", "@types/react", "19.1.13", "19.2.2"),
      ],
      { group: "minor-and-patch" },
    );
    open(web, [bump(web, "docker", "node", "22.17.0-alpine", "22.20.0-alpine")]);
    open(api, [bump(api, "docker", "golang", "1.24.4-alpine", "1.25.2-alpine")], {
      checks: "failure",
    });
    open(api, [bump(api, "gomod", "github.com/stretchr/testify", "1.10.0", "1.11.1")], {
      extraCommit: "human",
    });
    open(api, [bump(api, "gomod", "golang.org/x/net", "0.43.0", "0.45.0")], { checks: "pending" });
    open(cli, [bump(cli, "npm", "eslint", "8.57.1", "9.37.0")]);

    // Human PRs between the accounts: `other` asks `you` for reviews in every shape.
    const now = world.now();
    const asks = [
      { repo: web, variant: "fresh" },
      { repo: api, variant: "fresh" },
      { repo: web, variant: "re-review" },
      { repo: cli, variant: "force-pushed" },
      { repo: web, variant: "failing" },
      { repo: api, variant: "discussed" },
    ] as const;
    for (const [i, ask] of asks.entries()) {
      this.reviewRequest(ask.repo.repo, other, ask.variant, now - (i + 1) * 7 * HOUR, owner);
    }
    this.humanPr(api.repo, owner, bigChange(), now - 26 * HOUR, [you], "success");
    this.authored(web.repo, other, "changes-requested", now - 30 * HOUR);

    // Two boards the web repo's PRs can go on; the pagination work is on the roadmap, in review.
    web.repo.projects.push(
      { id: "PVT_kwDOroadmap01", title: "Q4 roadmap" },
      { id: "PVT_kwDObugs0002", title: "Bugs" },
    );
    const paging = [...world.prs.values()].find(
      (pr) =>
        pr.repo === web.repo && pr.title === "Paginate events with cursors" && pr.author === other,
    );
    if (paging)
      paging.projectItems = new Map([
        ["PVT_kwDOroadmap01", { itemId: "PVTI_kwDOpaging01", status: "In review" }],
      ]);

    // A sweeping rename: hundreds of small changes, the shape that strains a review screen.
    world.openPr({
      repo: api.repo.fullName,
      author: owner,
      title: "Rename the logger across services",
      body: "Every service now logs through `logger.info` instead of the bare `log`.",
      headRefName: "rename-logger",
      files: Array.from({ length: 400 }, (_, i) => ({
        path: `services/svc-${String(i).padStart(3, "0")}/start.ts`,
        before: 'import { log } from "../logger";\n\nexport const start = () => log("start");\n',
        after:
          'import { logger } from "../logger";\n\nexport const start = () => logger.info("start");\n',
      })),
      reviewers: [you],
      checks: "success",
      createdAt: now - 3 * HOUR,
    });

    // A stack: config loading, then validation on top of it, then hot reload on top of that.
    const layers = [
      ["config-load", "main", "Load config from TOML files"],
      ["config-validate", "config-load", "Validate config against the schema"],
      ["config-reload", "config-validate", "Reload config when the file changes"],
    ] as const;
    const stacked: FakePr[] = [];
    for (const [i, [branch, base, title]] of layers.entries()) {
      const below = stacked.at(-1);
      stacked.push(
        world.openPr({
          repo: cli.repo.fullName,
          author: other,
          title,
          body: below
            ? `Part ${i + 1} of the config work, on top of [#${below.number}](https://github.com/${cli.repo.fullName}/pull/${below.number}).`
            : "Part 1 of the config work.",
          headRefName: branch,
          baseRefName: base,
          files: [{ path: `src/config/${branch}.ts`, after: `export const step = ${i + 1};\n` }],
          reviewers: [you],
          checks: "success",
          createdAt: now - (12 - i) * HOUR,
        }),
      );
    }
    world.stack(
      cli.repo.fullName,
      stacked.map((pr) => pr.number),
    );

    // The owner suggests changes on your PR, to apply one at a time or together.
    const yours = [...world.prs.values()].find(
      (pr) => pr.author === you && pr.state === "OPEN" && pr.repo === web.repo,
    );
    const routes = yours?.files.find((f) => f.path === "src/routes/events.ts");
    if (yours && routes) {
      world.review(yours.id, owner, {
        event: "COMMENT",
        body: "Two small things.",
        threads: [
          {
            subject: "line",
            path: routes.path,
            line: 10,
            side: "RIGHT",
            body: [
              "Smaller pages keep this fast:",
              "```suggestion",
              "  limit: z.coerce.number().int().min(1).max(100).default(25),",
              "```",
            ].join("\n"),
          },
          {
            subject: "line",
            path: "test/events.test.ts",
            line: 9,
            side: "RIGHT",
            body: [
              "```suggestion",
              "    expect(res.body.next).toEqual(expect.any(String));",
              "```",
            ].join("\n"),
          },
        ],
      });
    }
  }

  work(): void {
    const { world, rng, you } = this;
    this.publishCatalog([]);
    const [, other, third] = world.accounts;

    for (const [org] of ORGS) {
      const people = rng.sample(COLLEAGUES, rng.int(8, 12));
      this.orgPeople.set(org, people);
      for (const login of people) world.addUser(login, { name: displayName(login) });
      world.addOrg(org, [you, ...people, ...(org === "kestrel-dev" && other ? [other] : [])]);
    }
    world.addTeam("northwind", "platform", [
      you,
      ...(this.orgPeople.get("northwind") ?? []).slice(0, 3),
    ]);
    world.addTeam("lumen-labs", "web", [
      you,
      ...(this.orgPeople.get("lumen-labs") ?? []).slice(0, 2),
    ]);

    const plans: RepoPlan[] = [];
    for (const [org, count] of ORGS) {
      const names = rng.sample(
        REPO_PREFIXES.flatMap((p) => REPO_SUFFIXES.map((s) => `${p}-${s}`)),
        count,
      );
      for (const name of names) {
        const stack = rng.weighted<Stack>([
          ["node-service", 35],
          ["web-app", 30],
          ["go-service", 15],
          ["rust-tool", 7],
          ["library", 13],
        ]);
        const npmStack = stack === "node-service" || stack === "web-app" || stack === "library";
        const repo = world.addRepo(`${org}/${name}`, {
          isPrivate: rng.chance(0.9),
          archived: rng.chance(0.01),
          requiredApprovals: rng.chance(0.85) ? 1 : 0,
          dismissStaleReviews: rng.chance(0.15),
          automergeOnApproval: rng.chance(0.4),
          checkNames: STACKS[stack].checks,
          codeOwners: ORG_CODEOWNERS[org] ?? null,
        });
        plans.push(
          this.plan(repo, stack, npmStack && rng.chance(0.12) ? "renovate" : "dependabot"),
        );
      }
    }
    // A couple of personal repos, so per-account scoping has something to separate.
    const personal = third ?? other ?? you;
    for (const [name, stack] of [
      ["dotfiles", "library"],
      ["homelab", "node-service"],
    ] as const) {
      const repo = world.addRepo(`${personal}/${name}`, {
        watchers: [personal],
        checkNames: STACKS[stack].checks,
      });
      const plan = this.plan(repo, stack, "dependabot");
      for (let i = 0; i < 3; i++) this.randomBotPr(plan);
    }

    this.fillBotPrs(
      plans.filter((p) => p.bot === "dependabot"),
      2_000,
    );
    for (const plan of plans.filter((p) => p.bot === "renovate")) {
      for (let i = rng.int(3, 8); i > 0; i--) this.randomBotPr(plan);
    }

    const orgRepos = plans.map((p) => p.repo).filter((r) => !r.archived);
    const now = world.now();
    const variants = [
      "fresh",
      "fresh",
      "fresh",
      "fresh",
      "fresh",
      "team",
      "re-review",
      "re-review",
      "discussed",
      "mention",
    ] as const;
    for (let i = 0; i < 50; i++) {
      const repo = rng.pick(orgRepos);
      const author = rng.pick(this.orgPeople.get(repo.owner) ?? COLLEAGUES);
      const variant = variants[i % variants.length] ?? "fresh";
      this.reviewRequest(repo, author, variant, now - rng.int(7 * 60, 12 * 24 * 60) * MINUTE);
    }
    const bigRepo = rng.pick(orgRepos);
    this.humanPr(
      bigRepo,
      rng.pick(this.orgPeople.get(bigRepo.owner) ?? COLLEAGUES),
      bigChange(),
      now - 20 * HOUR,
      [you],
      "success",
    );

    const states = [
      "changes-requested",
      "changes-requested",
      "changes-requested",
      "changes-requested",
      "failing",
      "failing",
      "failing",
      "approved-armed",
      "approved",
      "approved",
      "conflict",
      "conflict",
      "waiting",
      "waiting",
      "draft",
    ] as const;
    for (const state of states) {
      const repo = rng.pick(orgRepos);
      const reviewer = rng.pick(this.orgPeople.get(repo.owner) ?? COLLEAGUES);
      this.authored(repo, reviewer, state, now - rng.int(8 * 60, 9 * 24 * 60) * MINUTE);
    }
  }

  // -------------------------------------------------------------------------
  // Packages

  /** Release history for every catalog package; `young` ones shipped in the last three days. */
  private publishCatalog(young: string[]): void {
    const { world, rng } = this;
    for (const entries of Object.values(CATALOG)) {
      for (const entry of entries) {
        const isYoung = young.includes(entry.name) || rng.chance(0.12);
        let at = world.now() - (isYoung ? rng.int(8, 66) * HOUR : rng.int(74, 28 * 24) * HOUR);
        for (const version of entry.versions.toReversed()) {
          const key = `${entry.ecosystem}:${entry.name}@${version}`;
          world.addRelease(
            entry.ecosystem,
            entry.name,
            version,
            {
              publishedAt: world.iso(at),
              advisories: ADVISORIES[key] ?? [],
              installScript: entry.installScript === true || NEW_INSTALL_SCRIPTS.has(key),
            },
            entry.source,
          );
          at -= rng.int(10, 60) * DAY;
        }
      }
    }
  }

  private publishedAt(entry: CatalogEntry, version: string): number {
    // Bare action majors ("5") were published with their first release.
    const exact = this.world.release(entry.ecosystem, entry.name, version);
    const release =
      exact ?? this.world.release(entry.ecosystem, entry.name, `${version}.0.0`) ?? null;
    return release ? Date.parse(release.publishedAt) : this.world.now() - 30 * DAY;
  }

  // -------------------------------------------------------------------------
  // Bot PRs

  private plan(repo: FakeRepo, stack: Stack, bot: RepoPlan["bot"]): RepoPlan {
    const { rng } = this;
    return {
      repo,
      bot,
      // Renovate's tables are only written here for npm and Actions.
      ecosystems: STACKS[stack].ecosystems.filter(
        ([ecosystem]) =>
          bot === "dependabot" || ecosystem === "npm" || ecosystem === "github-actions",
      ),
      npmDir: rng.chance(0.85) ? "/" : rng.pick(["/web", "/frontend", "/app"]),
      style: {
        prefix: rng.weighted<string | null>([
          [null, 50],
          ["chore(deps)", 30],
          ["build(deps)", 20],
        ]),
        lockfile: rng.weighted<BotStyle["lockfile"]>([
          ["package-lock.json", 80],
          ["pnpm-lock.yaml", 15],
          ["yarn.lock", 5],
        ]),
        updateTypes: rng.chance(0.5),
        arrow: rng.chance(0.5) ? "→" : "->",
      },
      used: new Set(),
    };
  }

  /** Opens bot PRs across `plans` until `total` exist, a few per repo, unevenly. */
  private fillBotPrs(plans: RepoPlan[], total: number): void {
    const { rng } = this;
    let opened = 0;
    for (const plan of plans) {
      for (let i = rng.int(2, 11); i > 0 && opened < total; i--) {
        if (this.randomBotPr(plan)) opened++;
      }
    }
    for (let attempts = 0; opened < total && attempts < total * 5; attempts++) {
      if (this.randomBotPr(rng.pick(plans))) opened++;
    }
  }

  private randomBotPr(plan: RepoPlan): FakePr | null {
    const { rng, world } = this;
    const ecosystem = rng.weighted(plan.ecosystems);
    const old = rng.chance(0.1);
    const before = old ? world.now() - rng.int(31, 120) * DAY : undefined;
    const groupable =
      ecosystem === "npm" || (plan.bot === "dependabot" && ecosystem === "github-actions");
    // Some group attempts find too few packages and are dropped, hence a little above 10%.
    const group = groupable && rng.chance(plan.bot === "dependabot" ? 0.13 : 0.15);
    const groupName = !group
      ? null
      : plan.bot === "renovate"
        ? "all-non-major"
        : ecosystem === "github-actions"
          ? "actions"
          : rng.weighted([
              ["minor-and-patch", 50],
              ["npm_and_yarn", 25],
              ["production-dependencies", 25],
            ]);

    const bumps = this.pickBumps(plan, ecosystem, group ? rng.int(2, 6) : 1, !group, before);
    if (bumps.length === 0 || (group && bumps.length < 2)) {
      for (const b of bumps) plan.used.delete(`${b.entry.ecosystem}:${b.entry.name}`);
      return null;
    }
    const createdAt = Math.min(this.createdAfterRelease(bumps), before ?? Infinity);
    return this.openBotPr(plan, {
      bumps,
      group: groupName,
      createdAt,
      checks: rng.weighted([
        ["success", 75],
        ["failure", 12],
        ["pending", 8],
        ["none", 5],
      ]),
      conflict: rng.chance(0.03),
      extraCommit: rng.chance(0.01) ? "human" : rng.chance(0.01) ? "base-merge" : null,
      newDeps:
        ecosystem === "npm" && rng.chance(0.04)
          ? rng.sample(["is-unicode-supported", "yocto-queue", "fast-uri", "ms"], rng.int(1, 2))
          : [],
    });
  }

  private pickBumps(
    plan: RepoPlan,
    ecosystem: CatalogEcosystem,
    count: number,
    majors: boolean,
    before: number | undefined,
  ): PlannedBump[] {
    const available = CATALOG[ecosystem].filter(
      (e) => !plan.used.has(`${ecosystem}:${e.name}`) && !(plan.bot === "renovate" && e.indirect),
    );
    const bumps: PlannedBump[] = [];
    for (const entry of this.rng.sample(available, available.length)) {
      if (bumps.length >= count) break;
      const bump = this.pickBump(plan, entry, majors, before);
      if (!bump) continue;
      plan.used.add(`${ecosystem}:${entry.name}`);
      bumps.push(bump);
    }
    return bumps;
  }

  /** The newest release out by `before`, from an older one weighted towards patch bumps. */
  private pickBump(
    plan: RepoPlan,
    entry: CatalogEntry,
    majors: boolean,
    before: number | undefined,
  ): PlannedBump | null {
    const { rng } = this;
    const out = entry.versions.filter(
      (v) => before === undefined || this.publishedAt(entry, v) < before,
    );
    const to = out.at(-1);
    if (!to) return null;
    const classes = (["patch", "minor", "major"] as const).filter(
      (c) => (majors || c !== "major") && out.slice(0, -1).some((v) => classify(v, to) === c),
    );
    if (classes.length === 0) return null;
    const semver = rng.weighted(classes.map((c) => [c, SEMVER_WEIGHTS[c]] as const));
    const from = rng.pick(out.slice(0, -1).filter((v) => classify(v, to) === semver));
    // Workflows usually pin a moving major tag, so action majors read "from 4 to 5".
    if (entry.ecosystem === "github-actions" && semver === "major" && rng.chance(0.7))
      return this.planned(plan, entry, major(from), major(to));
    return this.planned(plan, entry, from, to);
  }

  private planned(plan: RepoPlan, entry: CatalogEntry, from: string, to: string): PlannedBump {
    const dependencyType: DependencyType = entry.indirect
      ? "indirect"
      : DEV_PACKAGES.has(entry.name)
        ? "direct:development"
        : "direct:production";
    return {
      entry,
      from,
      to,
      directory: entry.ecosystem === "npm" ? plan.npmDir : "/",
      dependencyType,
    };
  }

  /** Bots open PRs within a couple of days of the newest release they carry. */
  private createdAfterRelease(bumps: PlannedBump[]): number {
    const released = Math.max(...bumps.map((b) => this.publishedAt(b.entry, b.to)));
    const latest = this.world.now() - this.rng.int(5, 90) * MINUTE;
    return Math.max(released, Math.min(released + this.rng.int(10, 48 * 60) * MINUTE, latest));
  }

  private openBotPr(plan: RepoPlan, p: BotPrPlan): FakePr {
    const { world, rng } = this;
    const built =
      plan.bot === "dependabot"
        ? dependabotPr(p.bumps, plan.style, p.group, p.newDeps)
        : renovatePr(p.bumps, plan.style, plan.repo.fullName, p.newDeps);
    const commits: CommitInput[] = [{ message: built.commitMessage, at: p.createdAt }];
    const person = rng.pick(this.orgPeople.get(plan.repo.owner) ?? [...world.accounts]);
    if (p.extraCommit === "human")
      commits.push({ message: "Fix lockfile after merge", author: person, at: p.createdAt + HOUR });
    if (p.extraCommit === "base-merge") {
      commits.push({
        message: `Merge branch '${plan.repo.defaultBranch}' into ${built.headRefName}`,
        author: person,
        at: p.createdAt + HOUR,
      });
    }
    const pr = world.at(p.createdAt, () =>
      world.openPr({
        repo: plan.repo.fullName,
        author: built.author,
        title: built.title,
        body: built.body,
        headRefName: built.headRefName,
        files: built.files,
        commits,
        labels: built.labels,
        bumps: built.bumps,
        mergeable: p.conflict ? "conflicting" : "mergeable",
        checks: p.checks === "pending" ? "none" : p.checks,
      }),
    );
    if (p.checks === "pending")
      world.runChecks(pr.id, rng.chance(0.85) ? "success" : "failure", rng.int(2, 25) * MINUTE);
    return pr;
  }

  // -------------------------------------------------------------------------
  // Human PRs

  private humanPr(
    repo: FakeRepo,
    author: string,
    change: HumanChange,
    createdAt: number,
    reviewers: string[],
    checks: ChecksInput | "running",
    options: { isDraft?: boolean; conflict?: boolean } = {},
  ): FakePr {
    const { world } = this;
    const pr = world.at(createdAt, () =>
      world.openPr({
        repo: repo.fullName,
        author,
        title: change.title,
        body: `## Summary\n${change.summary}\n\n## Testing\n- [x] Unit tests\n- [ ] Checked on staging`,
        headRefName: `${author.split("-")[0]}/${change.branch.split("/").at(-1) ?? change.branch}`,
        files: change.files,
        reviewers,
        checks: checks === "running" ? "none" : checks,
        isDraft: options.isDraft ?? false,
        mergeable: options.conflict ? "conflicting" : "mergeable",
      }),
    );
    if (checks === "running") world.runChecks(pr.id, "success", this.rng.int(3, 20) * MINUTE);
    return pr;
  }

  /** `author` asks you for a review; the variant decides what has happened since. */
  private reviewRequest(
    repo: FakeRepo,
    author: string,
    variant: "fresh" | "team" | "re-review" | "discussed" | "mention" | "force-pushed" | "failing",
    createdAt: number,
    bystander?: string,
  ): void {
    const { world, rng, you } = this;
    const change = humanChange(rng);
    const team = [...world.teams].find(
      ([slug, members]) => slug.startsWith(`${repo.owner}/`) && members.has(you),
    )?.[0];
    const reviewers = variant === "team" && team ? [team] : [you];
    const checks =
      variant === "failing"
        ? "failure"
        : rng.weighted<ChecksInput | "running">([
            ["success", 70],
            ["running", 15],
            ["failure", 10],
            ["none", 5],
          ]);
    const pr = this.humanPr(repo, author, change, createdAt, reviewers, checks);

    if (variant === "re-review" || variant === "force-pushed") {
      const thread = this.threadOn(pr, REVIEW_COMMENTS[0] ?? "");
      const review = world.at(createdAt + HOUR, () =>
        world.review(pr.id, you, {
          event: variant === "re-review" ? "REQUEST_CHANGES" : "COMMENT",
          body: "A couple of things before this goes in.",
          threads: thread ? [thread] : [],
        }),
      );
      world.at(createdAt + 3 * HOUR, () => {
        const threadId = pr.threads.find((t) => t.comments[0]?.reviewId === review.id)?.id;
        if (threadId) world.reply(threadId, author, rng.pick(REPLIES));
        if (variant === "force-pushed")
          world.forcePush(pr.id, { files: change.followUp, actor: author });
        else
          world.pushCommit(pr.id, { message: "Address review feedback", files: change.followUp });
        world.requestReview(pr.id, you, author);
      });
    }
    if (variant === "discussed") {
      const peer =
        bystander ??
        rng.pick((this.orgPeople.get(repo.owner) ?? COLLEAGUES).filter((p) => p !== author));
      const thread = this.threadOn(pr, rng.pick(REVIEW_COMMENTS));
      world.at(createdAt + 2 * HOUR, () =>
        world.review(pr.id, peer, {
          event: "COMMENT",
          body: "Left a question inline.",
          threads: thread ? [thread] : [],
        }),
      );
      world.at(createdAt + 4 * HOUR, () =>
        world.comment(pr.id, author, "Thanks! Updated the description with the rollout plan."),
      );
    }
    if (variant === "mention")
      world.at(createdAt + 2 * HOUR, () =>
        world.comment(pr.id, author, `@${you} could you take a look at the migration part?`),
      );
  }

  /** One of your own PRs, in the state the variant names. */
  private authored(
    repo: FakeRepo,
    reviewer: string,
    state:
      | "changes-requested"
      | "failing"
      | "approved-armed"
      | "approved"
      | "conflict"
      | "waiting"
      | "draft",
    createdAt: number,
  ): void {
    const { world, rng, you } = this;
    const change = humanChange(rng);
    const checks: ChecksInput | "running" =
      state === "failing" ? "failure" : state === "waiting" ? "running" : "success";
    const pr = this.humanPr(
      repo,
      you,
      change,
      createdAt,
      state === "draft" ? [] : [reviewer],
      checks,
      {
        isDraft: state === "draft",
        conflict: state === "conflict",
      },
    );
    if (state === "changes-requested") {
      const thread = this.threadOn(pr, rng.pick(REVIEW_COMMENTS));
      world.at(createdAt + 2 * HOUR, () =>
        world.review(pr.id, reviewer, {
          event: "REQUEST_CHANGES",
          body: "Close, but a couple of things.",
          threads: thread ? [thread] : [],
        }),
      );
    }
    if (state === "approved" || state === "approved-armed") {
      world.at(createdAt + 2 * HOUR, () =>
        world.review(pr.id, reviewer, { event: "APPROVE", body: "LGTM" }),
      );
      if (state === "approved-armed")
        pr.autoMerge = { enabledAt: world.iso(createdAt + 3 * HOUR), method: "SQUASH" };
    }
  }

  /** A draft thread on an added line of the PR's first file. */
  private threadOn(pr: FakePr, body: string) {
    const file = pr.files.find((f) => f.additions > 0);
    const lines = patchHunks(file?.patch ?? "").flatMap((h) =>
      h.lines.flatMap((l) => (l.kind === "+" && l.newLine !== null ? [l.newLine] : [])),
    );
    if (!file || lines.length === 0) return null;
    return {
      subject: "line" as const,
      path: file.path,
      line: this.rng.pick(lines),
      side: "RIGHT" as const,
      body,
    };
  }
}

function major(version: string): string {
  return version.split(".")[0] ?? version;
}

/** "mira-chen" -> "Mira Chen"; accounts keep their login as their name. */
function displayName(login: string): string {
  if (!login.includes("-")) return login;
  return login
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Registry answers

const DEPS_DEV_ECOSYSTEMS: Record<string, CatalogEcosystem> = {
  npm: "npm",
  go: "gomod",
  cargo: "cargo",
};

/** `/v3/systems/{system}/packages/{name}/versions/{version}` */
function depsDev(world: FakeWorld, segments: string[]): Response {
  const [, , system = "", , name = "", , version = ""] = segments;
  const ecosystem = DEPS_DEV_ECOSYSTEMS[system];
  const pkg = ecosystem && world.packages.get(`${ecosystem}:${name}`);
  // Go versions carry a "v" on deps.dev; the world stores them as Dependabot writes them.
  const release = pkg
    ? pkg.releases.get(ecosystem === "gomod" ? version.replace(/^v/, "") : version)
    : null;
  if (!pkg || !release) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({
    versionKey: { system: system.toUpperCase(), name, version },
    publishedAt: release.publishedAt,
    isDefault: true,
    licenses: ["MIT"],
    advisoryKeys: release.advisories.map((id) => ({ id })),
    links: [
      { label: "SOURCE_REPO", url: pkg.sourceUrl },
      { label: "HOMEPAGE", url: pkg.sourceUrl },
    ],
  });
}

/** `/{name}/{version}`, where a scoped name arrives as one encoded segment. */
function npmRegistry(world: FakeWorld, segments: string[]): Response {
  const version = segments.at(-1) ?? "";
  const name = segments.slice(0, -1).join("/");
  const release = world.packages.get(`npm:${name}`)?.releases.get(version);
  if (!release) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    name,
    version,
    scripts: {
      test: "node --test",
      ...(release.installScript ? { postinstall: "node install.js" } : {}),
    },
  });
}
