import { describe, expect, test } from "bun:test";

import { parseBotPr } from "@/domain/bumps";
import { defaultScopes } from "@/domain/settings";
import { GitHubError } from "@/github/client";
import { patchHunks } from "@/github/fake/diff";
import {
  createFakePorts,
  fakeRegistryFetch,
  generateScenario,
  type Preset,
} from "@/github/fake/scenario";
import type { FakePr, FakeWorld } from "@/github/fake/world";
import type { GitHubPort } from "@/github/port";
import { ReleaseRegistry } from "@/registry/release";
import { memoryStores } from "@/store/db";

const START = Date.parse("2026-10-13T12:00:00Z");
const DAY = 86_400_000;

function setup(preset: Preset) {
  const world = generateScenario({ preset, clock: "manual", start: START });
  const ports = createFakePorts(world);
  const port = (login: string): GitHubPort => {
    const found = ports.get(login);
    if (!found) throw new Error(`no port for ${login}`);
    return found;
  };
  return { world, you: port("binbandit"), sage: port("sage-smudge"), hippie: port("WastedHippie") };
}

function find(world: FakeWorld, match: (pr: FakePr) => boolean): FakePr {
  const pr = [...world.prs.values()].find(match);
  if (!pr) throw new Error("no PR matches");
  return pr;
}

const isBot = (pr: FakePr) => pr.author === "dependabot" || pr.author === "renovate";
const share = (part: number, whole: number) => part / whole;
const shape = (world: FakeWorld) =>
  [...world.prs.values()].map((pr) => `${pr.id} ${pr.repo.fullName}#${pr.number} ${pr.title}`);
const botQuery = (owner: string) =>
  `is:pr is:open archived:false (author:app/dependabot OR author:app/renovate) user:${owner}`;

describe("search", () => {
  const { world, you, sage, hippie } = setup("work");

  test("each account only finds PRs in repos it can read", async () => {
    const expected = [...world.prs.values()].filter(
      (pr) =>
        isBot(pr) && pr.state === "OPEN" && pr.repo.owner === "northwind" && !pr.repo.archived,
    );
    const yours = await you.search(botQuery("northwind"));
    expect(new Set(yours.map((hit) => hit.id))).toEqual(new Set(expected.map((pr) => pr.id)));

    // sage-smudge isn't in northwind: only its public repos show up.
    const theirs = await sage.search(botQuery("northwind"));
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.length).toBeLessThan(yours.length);
    expect(theirs.every((hit) => world.pr(hit.id)?.repo.isPrivate === false)).toBe(true);
    // ...but it is in kestrel-dev, private repos included.
    const kestrel = await sage.search(botQuery("kestrel-dev"));
    expect(kestrel.some((hit) => world.pr(hit.id)?.repo.isPrivate)).toBe(true);
  });

  test("default scopes separate accounts", async () => {
    const [, bots] = defaultScopes(["WastedHippie"]);
    const personal = await hippie.search(bots?.query ?? "");
    expect(personal).toHaveLength(6);
    expect(personal.every((hit) => world.pr(hit.id)?.repo.owner === "WastedHippie")).toBe(true);

    const [involved] = defaultScopes(["binbandit"]);
    const hits = await you.search(involved?.query ?? "");
    const prs = hits.flatMap((hit) => world.pr(hit.id) ?? []);
    expect(prs.filter((pr) => pr.author === "binbandit")).toHaveLength(15);
    expect(
      prs.filter((pr) => world.reviewRequested(pr, "binbandit")).length,
    ).toBeGreaterThanOrEqual(50);
    expect(prs.some(isBot)).toBe(false);
  });

  test("updated:>= narrows to recent activity, and unknown qualifiers fail loudly", async () => {
    const since = new Date(START - DAY).toISOString().slice(0, 19) + "Z";
    const all = await you.search(botQuery("lumen-labs"));
    const recent = await you.search(`${botQuery("lumen-labs")} updated:>=${since}`);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.length).toBeLessThan(all.length);
    expect(recent.every((hit) => hit.updatedAt >= since)).toBe(true);
    expect(you.search("is:pr sprocket:yes")).rejects.toThrow("sprocket");
  });
});

describe("bot PR formats", () => {
  test.each(["sandbox", "work"] as const)(
    "%s: hydrate round-trips through parseBotPr",
    async (preset) => {
      const { world, you } = setup(preset);
      const bots = [...world.prs.values()].filter(isBot);
      const hydrated = await you.hydrate(bots.map((pr) => pr.id));
      expect(hydrated).toHaveLength(
        bots.filter((pr) => world.permission(pr.repo, "binbandit")).length,
      );
      for (const { doc } of hydrated) {
        const parsed = parseBotPr({
          title: doc.title,
          body: doc.body,
          headRefName: doc.headRefName,
          authorLogin: doc.author?.login ?? null,
          commitMessages: doc.commits.map((c) => c.message),
          files: doc.files.map((f) => f.path),
        });
        // pier drops the "v" Renovate writes on Actions and Go versions; Dependabot doesn't.
        const expected = world
          .pr(doc.id)
          ?.bumps.map((b) =>
            b.ecosystem === "github-actions" || b.ecosystem === "gomod"
              ? { ...b, from: b.from && unv(b.from), to: unv(b.to) }
              : b,
          );
        expect({ title: doc.title, bumps: parsed?.bumps }).toEqual({
          title: doc.title,
          bumps: expected,
        });
      }
    },
  );

  test("the work preset covers every format pier parses", () => {
    const { world } = setup("work");
    const bots = [...world.prs.values()].filter(isBot);
    const dependabot = bots.filter((pr) => pr.author === "dependabot");
    const renovate = bots.filter((pr) => pr.author === "renovate");
    const ecosystems = new Set(dependabot.flatMap((pr) => pr.bumps.map((b) => b.ecosystem)));
    expect([...ecosystems].toSorted()).toEqual([
      "cargo",
      "docker",
      "github-actions",
      "gomod",
      "npm",
    ]);
    // Grouped PRs: prose for small groups, the "| Package | From | To |" table for big ones.
    expect(dependabot.some((pr) => pr.bumps.length > 1 && pr.bumps.length < 4)).toBe(true);
    expect(dependabot.some((pr) => pr.body.includes("| Package | From | To |"))).toBe(true);
    expect(dependabot.some((pr) => / in \/\w+$/.test(pr.title))).toBe(true);
    expect(dependabot.some((pr) => pr.bumps.some((b) => b.dependencyType === "indirect"))).toBe(
      true,
    );
    for (const lockfile of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]) {
      expect(dependabot.some((pr) => pr.files.some((f) => f.path.endsWith(lockfile)))).toBe(true);
    }
    expect(renovate.some((pr) => pr.body.includes("| Package | Change | Age | Confidence |"))).toBe(
      true,
    );
    expect(renovate.some((pr) => pr.bumps.length > 1)).toBe(true);
    expect(renovate.some((pr) => pr.bumps.some((b) => b.ecosystem === "github-actions"))).toBe(
      true,
    );
  });
});

describe("writes", () => {
  test("approving lands, and the repo's automation merges after the delay", async () => {
    const { world, you } = setup("sandbox");
    const pr = find(world, (p) => p.repo.name === "sandbox-web" && p.title.includes("lodash"));
    const [hydrated] = await you.hydrate([pr.id]);
    const head = hydrated?.doc.headRefOid ?? "";
    expect(hydrated?.doc.autoMerge).not.toBeNull();

    const review = await you.approve(pr.id, head);
    expect(review).toMatchObject({ state: "APPROVED", commitOid: head });
    expect(await you.reviewsBy(pr.id, "binbandit")).toEqual([review]);
    expect((await you.sweep([pr.id]))[0]).toMatchObject({
      state: "OPEN",
      reviewDecision: "approved",
    });

    world.advance(world.options.automergeDelayMs);
    expect((await you.sweep([pr.id]))[0]?.state).toBe("MERGED");
  });

  test("GitHub refuses approving your own PR", async () => {
    const { world, sage } = setup("sandbox");
    const own = find(world, (p) => p.author === "sage-smudge");
    expect(sage.approve(own.id, world.head(own))).rejects.toThrow("your own pull request");
  });

  test("a dropped response still applies the write", async () => {
    const { world, you } = setup("sandbox");
    const pr = find(world, (p) => p.repo.name === "sandbox-web" && p.title.includes("lodash"));
    world.faults.push({ account: "binbandit", method: "approve", kind: "drop-response" });

    const error = await you.approve(pr.id, world.head(pr)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).toMatchObject({ kind: "network" });
    expect((await you.reviewsBy(pr.id, "binbandit")).map((r) => r.state)).toEqual(["APPROVED"]);
    expect(world.faults).toHaveLength(0);
  });

  test("a secondary limit rejects the write without applying it", async () => {
    const { world, you } = setup("sandbox");
    const pr = find(world, (p) => p.repo.name === "sandbox-web" && p.title.includes("lodash"));
    world.faults.push({ method: "comment", kind: "secondary-limit", retryAfterMs: 90_000 });

    expect(you.comment(pr.id, "@dependabot rebase")).rejects.toMatchObject({
      kind: "secondary-limit",
      retryAfterMs: 90_000,
    });
    expect(await you.recentComments(pr.id)).toEqual([]);
    expect((await you.comment(pr.id, "@dependabot rebase")).id).toStartWith("IC_");
  });

  test("the merge API merges asynchronously; auto-merge waits for the approval", async () => {
    const { world, you } = setup("sandbox");
    const open = (name: string) =>
      world.openPr({
        repo: "WastedHippie/sandbox-web",
        author: "sage-smudge",
        title: `Add ${name}`,
        headRefName: `sage/${name}`,
        files: [{ path: `docs/${name}.md`, before: null, after: `# ${name}\n` }],
        checks: "success",
      });
    const [pr, armed, sibling] = ["one", "two", "three"].map(open);
    if (!pr || !armed || !sibling) throw new Error("unreachable");
    const { fullName: repo } = pr.repo;
    const head = world.head(pr);

    expect(you.merge(repo, pr.number, { sha: head, method: "SQUASH" })).rejects.toMatchObject({
      kind: "validation",
      message: expect.stringContaining("approving review is required"),
    });
    await you.approve(pr.id, head);
    expect(
      you.merge(repo, pr.number, { sha: "0".repeat(40), method: "SQUASH" }),
    ).rejects.toMatchObject({
      kind: "conflict",
    });
    const accepted = await you.merge(repo, pr.number, { sha: head, method: "SQUASH" });
    expect(accepted).toMatchObject({ status: "pending" });
    world.advance(world.options.mergeDelayMs);
    expect(await you.mergeStatus(repo, pr.number, accepted.uuid ?? "")).toMatchObject({
      status: "merged",
    });
    expect(world.pr(pr.id)?.state).toBe("MERGED");

    expect(await you.mergeInfo(armed.id)).toMatchObject({
      canEnableAutoMerge: true,
      autoMerge: null,
      reviewDecision: "REVIEW_REQUIRED",
      mergeStateStatus: "BLOCKED",
    });
    await you.setAutoMerge(armed.id, "SQUASH", world.head(armed));
    expect((await you.mergeInfo(armed.id))?.autoMerge).toEqual({ method: "SQUASH" });
    await you.approve(armed.id, world.head(armed));
    world.advance(world.options.automergeDelayMs);
    expect(world.pr(armed.id)?.state).toBe("MERGED");

    // main moved twice, so the third PR can bring it in.
    expect((await you.mergeInfo(sibling.id))?.canUpdateBranch).toBe(true);
    await you.updateBranch(sibling.id, false, world.head(sibling));
    expect(sibling.commits.at(-1)?.message).toStartWith("Merge branch 'main' into");
    expect((await you.mergeInfo(sibling.id))?.canUpdateBranch).toBe(false);
    expect(you.updateBranch(sibling.id, false, world.head(sibling))).rejects.toThrow(
      "no new commits",
    );
  });

  test("submitReview creates threads that others see in detail()", async () => {
    const { world, you, sage } = setup("sandbox");
    const pr = find(
      world,
      (p) =>
        p.author === "sage-smudge" &&
        world.reviewRequested(p, "binbandit") &&
        p.threads.length === 0 &&
        p.files.some((f) => f.additions > 0),
    );
    const file = pr.files.find((f) => f.additions > 0);
    const line = patchHunks(file?.patch ?? "")
      .flatMap((h) => h.lines)
      .find((l) => l.kind === "+")?.newLine;
    if (!file || !line) throw new Error("no added line");

    const review = await you.submitReview({
      prId: pr.id,
      commitOid: world.head(pr),
      event: "REQUEST_CHANGES",
      body: "One thing before this goes in.",
      threads: [{ subject: "line", path: file.path, line, side: "RIGHT", body: "Why this?" }],
    });
    const detail = await sage.detail(pr.id);
    const thread = detail?.threads.find((t) => t.comments[0]?.body === "Why this?");
    expect(thread).toMatchObject({ path: file.path, line, side: "RIGHT", outdated: false });
    expect(thread?.diffHunk.split("\n").at(-1)).toStartWith("+");
    expect(detail?.timeline.some((e) => e.kind === "review" && e.id === review.id)).toBe(true);

    await sage.reply(thread?.id ?? "", "Fixed it");
    await sage.setResolved(thread?.id ?? "", true);
    const after = (await you.detail(pr.id))?.threads.find((t) => t.id === thread?.id);
    expect(after).toMatchObject({ resolved: true, resolvedBy: "sage-smudge" });
    expect(after?.comments.map((c) => c.body)).toEqual(["Why this?", "Fixed it"]);

    // GitHub only takes comments on lines that are part of the diff.
    const outside = {
      subject: "line" as const,
      path: file.path,
      line: 9_999,
      side: "RIGHT" as const,
      body: "?",
    };
    expect(
      you.submitReview({
        prId: pr.id,
        commitOid: world.head(pr),
        event: "COMMENT",
        body: "",
        threads: [outside],
      }),
    ).rejects.toMatchObject({ kind: "graphql" });

    // A push that changes the file outdates the thread.
    world.pushCommit(pr.id, {
      message: "Rework",
      files: [{ path: file.path, after: "rewritten\n" }],
    });
    const outdated = (await you.detail(pr.id))?.threads.find((t) => t.id === thread?.id);
    expect(outdated).toMatchObject({ outdated: true, line: null });
  });
});

describe("commits", () => {
  test("committing files onto a branch that moved on is refused", async () => {
    const { world, you } = setup("sandbox");
    const pr = [...world.prs.values()].find(
      (p) => p.author === "binbandit" && p.title === "Paginate events with cursors",
    )!;
    const commit = (expectedHeadOid: string) =>
      you.commitFiles({
        repo: pr.repo.fullName,
        branch: pr.headRefName,
        expectedHeadOid,
        headline: "Apply suggestion from code review",
        body: "",
        files: [{ path: "notes.md", contents: "hi\n" }],
      });
    const stale = world.head(pr);
    await commit(stale);
    const refused = await commit(stale).then(
      () => null,
      (error: unknown) => error,
    );
    expect(String(refused)).toContain("Expected branch to point to");
  });
  test("a push moves threads with their lines, and outdates the ones it changed", () => {
    const { world } = setup("sandbox");
    const pr = [...world.prs.values()].find(
      (p) => p.author === "binbandit" && p.title === "Paginate events with cursors",
    )!;
    const path = "src/routes/events.ts";
    const onLine = (line: number) => pr.threads.find((t) => t.path === path && t.line === line)!;
    const kept = onLine(18);
    const changed = onLine(10);
    const text = world.fileText(pr.repo.fullName, world.head(pr), path)!.split("\n");
    text[9] = "  limit: z.coerce.number().int().min(1).max(100).default(25),";
    world.pushCommit(pr.id, {
      message: "Tighten the page size",
      files: [{ path, after: ["// Events, newest first.", ...text].join("\n") }],
    });
    expect([kept.line, changed.line]).toEqual([19, null]);
  });

  test("a commit's view holds only what it changed; a run of them adds up", async () => {
    const { world, you } = setup("sandbox");
    const pr = [...world.prs.values()].find((p) => p.title === "Paginate events with cursors")!;
    const repo = pr.repo.fullName;
    const [first, second] = (await you.detail(pr.id))!.commits;
    expect(second?.headline).toBe("Address review feedback");

    const parent = await you.commitParent(repo, second!.oid);
    expect(parent).toBe(first!.oid);
    const own = await you.compareFiles(repo, parent!, second!.oid);
    expect(own.map((f) => [f.path, f.additions, f.deletions])).toEqual([
      ["src/routes/events.ts", 1, 1],
    ]);

    const before = await you.commitParent(repo, first!.oid);
    const both = await you.compareFiles(repo, before!, second!.oid);
    expect(both.map((f) => f.path)).toEqual(["src/routes/events.ts", "test/events.test.ts"]);
  });
});

describe("notifications", () => {
  test("changed once, then 304 until something happens", async () => {
    const { world, you } = setup("sandbox");
    const first = await you.notifications();
    expect(first.changed).toBe(true);
    const threads = first.changed ? first.threads : [];
    expect(threads.some((t) => t.reason === "review_requested")).toBe(true);

    const used = you.rates().core?.used;
    expect((await you.notifications()).changed).toBe(false);
    // 304s are free.
    expect(you.rates().core?.used).toBe(used);
    expect((await you.notifications(true)).changed).toBe(true);

    const pr = find(
      world,
      (p) => p.author === "sage-smudge" && world.reviewRequested(p, "binbandit"),
    );
    world.advance(60_000);
    world.comment(pr.id, "sage-smudge", "Pushed a fix for the flaky test.");
    const next = await you.notifications();
    const thread = next.changed
      ? next.threads.find((t) => t.repo === pr.repo.fullName && t.number === pr.number)
      : undefined;
    expect(thread).toMatchObject({ repo: pr.repo.fullName, unread: true, updatedAt: world.iso() });

    await you.markNotificationDone(thread?.id ?? "");
    const done = await you.notifications();
    expect(done.changed && done.threads.some((t) => t.id === thread?.id)).toBe(false);
  });
});

describe("checks", () => {
  test("failing jobs have logs and can be re-run", async () => {
    const { world, you } = setup("sandbox");
    const pr = find(world, (p) => p.repo.name === "sandbox-api" && p.title.includes("golang "));
    const repo = pr.repo.fullName;
    const head = world.head(pr);

    const failing = (await you.checks(repo, head)).runs.find((run) => run.state === "failure");
    expect(failing?.jobId).toBeNumber();
    expect(failing?.runId).toBeNumber();

    const log = await you.jobLog(repo, failing?.jobId ?? 0);
    const sections = log?.steps.flatMap((step) => step.sections) ?? [];
    const failed = sections.find((section) => section.errors.length > 0);
    expect(failed?.errors).toHaveLength(1);
    expect(failed?.lines[failed.errors[0] ?? -1]).toContain("Process completed with exit code");
    expect(sections.flatMap((s) => s.lines).some((l) => l.includes("##["))).toBe(false);
    expect(await you.jobLog(repo, 1)).toBeNull();

    await you.rerunFailedJobs(repo, failing?.runId ?? 0, false);
    expect(world.reruns).toEqual([
      { repo, runId: failing?.runId ?? 0, by: "binbandit", at: world.iso() },
    ]);
    expect((await you.hydrate([pr.id]))[0]?.doc.checks.state).toBe("pending");
    world.advance(world.options.ciDurationMs);
    expect((await you.checks(repo, head)).runs.map((run) => run.state)).toEqual([
      "success",
      "success",
      "success",
    ]);
  });
});

describe("registry", () => {
  test("release lookups answer offline from the world's packages", async () => {
    // A wall clock, since the registry ages releases against Date.now().
    const world = generateScenario({ preset: "sandbox" });
    const you = createFakePorts(world).get("binbandit");
    const registry = new ReleaseRegistry(
      memoryStores().cache,
      async (repo, tag) => (await you?.releaseDate(repo, tag)) ?? null,
      () => [],
      fakeRegistryFetch(world),
    );
    const bump = (pkg: string) => {
      const found = [...world.prs.values()].flatMap((pr) => pr.bumps).find((b) => b.pkg === pkg);
      if (!found) throw new Error(`no bump for ${pkg}`);
      return found;
    };

    const lodash = await registry.lookup(bump("lodash"));
    expect(lodash).toMatchObject({
      publishedAt: world.release("npm", "lodash", "4.17.21")?.publishedAt,
      hasNewInstallScript: false,
      advisories: [],
    });
    // The sandbox's TypeScript release is days old, so the release-age gate has work to do.
    expect((await registry.lookup(bump("typescript")))?.ageDays).toBeLessThan(3);
    expect((await registry.lookup(bump("github.com/stretchr/testify")))?.publishedAt).toBeString();
    // `actions/checkout@5` resolves through the newest 5.x release.
    expect((await registry.lookup(bump("actions/checkout")))?.publishedAt).toBe(
      world.release("github-actions", "actions/checkout", "5.0.0")?.publishedAt ?? "",
    );
  });
});

describe("scenarios", () => {
  test("the same seed builds the same world", () => {
    expect(shape(setup("sandbox").world)).toEqual(shape(setup("sandbox").world));
  });

  test("work generates in under 2s with roughly the documented distribution", () => {
    const started = performance.now();
    const world = generateScenario({ preset: "work" });
    expect(performance.now() - started).toBeLessThan(2_000);

    const prs = [...world.prs.values()];
    const bots = prs.filter(isBot);
    const dependabot = bots.filter((pr) => pr.author === "dependabot");
    const bumps = bots.flatMap((pr) => pr.bumps);

    expect(world.repos.size).toBeWithin(295, 310);
    expect(world.orgs.size).toBe(4);
    expect(dependabot.length).toBeWithin(2_000, 2_020);
    expect(bots.length - dependabot.length).toBeWithin(50, 300);
    expect(
      share(dependabot.filter((pr) => pr.bumps.length > 1).length, dependabot.length),
    ).toBeWithin(0.07, 0.14);
    expect(
      share(
        bots.filter((pr) => world.now() - Date.parse(pr.createdAt) > 30 * DAY).length,
        bots.length,
      ),
    ).toBeWithin(0.06, 0.14);
    expect(share(bumps.filter((b) => b.ecosystem === "npm").length, bumps.length)).toBeGreaterThan(
      0.5,
    );
    expect(share(bumps.filter((b) => b.semver === "major").length, bumps.length)).toBeWithin(
      0.03,
      0.2,
    );
    expect(
      share(bots.filter((pr) => world.rollup(pr) === "success").length, bots.length),
    ).toBeGreaterThan(0.6);
    expect(share(bots.filter((pr) => world.rollup(pr) === "none").length, bots.length)).toBeWithin(
      0.02,
      0.09,
    );
    expect(bots.filter((pr) => world.rollup(pr) === "failure").length).toBeGreaterThan(0);
    expect(bots.filter((pr) => pr.mergeable === "conflicting").length).toBeGreaterThan(0);
    expect(
      bots.filter((pr) => pr.commits.some((c) => c.authorLogin !== null)).length,
    ).toBeGreaterThan(0);

    // The same bump lands in many repos, from different starting versions.
    const groups = Map.groupBy(bumps, (b) => `${b.ecosystem}:${b.pkg}@${b.to}`);
    const biggest = [...groups.values()].toSorted((a, b) => b.length - a.length)[0] ?? [];
    expect(biggest.length).toBeGreaterThan(20);
    expect(new Set(biggest.map((b) => b.from)).size).toBeGreaterThan(1);
    // Some targets are too fresh for the release-age gate.
    const young = bumps.filter((b) => {
      const published = world.release(b.ecosystem, b.pkg, b.to)?.publishedAt;
      return published !== undefined && world.now() - Date.parse(published) < 3 * DAY;
    });
    expect(young.length).toBeGreaterThan(0);

    expect(prs.filter((pr) => world.reviewRequested(pr, "binbandit")).length).toBeWithin(45, 60);
    expect(prs.filter((pr) => pr.author === "binbandit")).toHaveLength(15);
  });
});

function unv(version: string): string {
  return version.replace(/^v(?=\d)/, "");
}
