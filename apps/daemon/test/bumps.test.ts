import { describe, expect, test } from "bun:test";

import { bumpKey, classify, detectBot, ecosystemFromFiles, parseBotPr } from "@/domain/bumps";
import type { BotPrInput } from "@/domain/bumps";

const pr = (overrides: Partial<BotPrInput>): BotPrInput => ({
  title: "",
  body: "",
  headRefName: "",
  authorLogin: null,
  commitMessages: [],
  files: [],
  ...overrides,
});

const trailer = (...deps: string[]) =>
  [
    "Bump something",
    "",
    "---",
    "updated-dependencies:",
    ...deps,
    "...",
    "",
    "Signed-off-by: dependabot[bot] <support@github.com>",
  ].join("\n");

describe("dependabot", () => {
  test("single npm bump with a full trailer", () => {
    const parsed = parseBotPr(
      pr({
        title: "Bump lodash from 4.17.15 to 4.17.21",
        body: "Bumps [lodash](https://github.com/lodash/lodash) from 4.17.15 to 4.17.21.\n- [Release notes](https://example.com)",
        headRefName: "dependabot/npm_and_yarn/lodash-4.17.21",
        authorLogin: "dependabot",
        commitMessages: [
          trailer(
            "- dependency-name: lodash",
            "  dependency-version: 4.17.21",
            "  dependency-type: direct:production",
            "  update-type: version-update:semver-patch",
          ),
        ],
        files: ["package.json", "package-lock.json"],
      }),
    );
    expect(parsed).toEqual({
      bot: "dependabot",
      bumps: [
        {
          ecosystem: "npm",
          pkg: "lodash",
          from: "4.17.15",
          to: "4.17.21",
          semver: "patch",
          directory: "/",
          dependencyType: "direct:production",
        },
      ],
    });
  });

  test("older trailer without dependency-version takes `to` from the title", () => {
    const parsed = parseBotPr(
      pr({
        title: "chore(deps): bump minimist from 1.2.5 to 1.2.8 in /frontend",
        headRefName: "dependabot/npm_and_yarn/frontend/minimist-1.2.8",
        authorLogin: "dependabot",
        commitMessages: [trailer("- dependency-name: minimist", "  dependency-type: indirect")],
      }),
    );
    expect(parsed?.bumps).toEqual([
      {
        ecosystem: "npm",
        pkg: "minimist",
        from: "1.2.5",
        to: "1.2.8",
        semver: "patch",
        directory: "/frontend",
        dependencyType: "indirect",
      },
    ]);
  });

  test("grouped update yields one bump per dependency", () => {
    const parsed = parseBotPr(
      pr({
        title: "Bump the npm_and_yarn group across 1 directory with 2 updates",
        body: [
          "Bumps the npm_and_yarn group with 2 updates in the / directory: [lodash](https://x) and [semver](https://y).",
          "",
          "Updates `lodash` from 4.17.15 to 4.17.21",
          "- [Release notes](https://x)",
          "",
          "Updates `semver` from 7.3.2 to 7.5.4",
        ].join("\n"),
        headRefName: "dependabot/npm_and_yarn/npm_and_yarn-1a2b3c",
        authorLogin: "dependabot[bot]",
        commitMessages: [
          trailer(
            "- dependency-name: lodash",
            "  dependency-version: 4.17.21",
            "  dependency-type: direct:production",
            "  dependency-group: npm_and_yarn",
            "- dependency-name: semver",
            "  dependency-version: 7.5.4",
            "  dependency-type: direct:production",
            "  dependency-group: npm_and_yarn",
          ),
        ],
      }),
    );
    expect(parsed?.bumps.map((b) => [b.pkg, b.from, b.to, b.semver])).toEqual([
      ["lodash", "4.17.15", "4.17.21", "patch"],
      ["semver", "7.3.2", "7.5.4", "minor"],
    ]);
  });

  test("large groups take from-versions from the summary table", () => {
    const parsed = parseBotPr(
      pr({
        title: "build(deps): bump the website group across 1 directory with 16 updates",
        body: [
          "Bumps the website group with 16 updates in the / directory:",
          "",
          "| Package | From | To |",
          "| --- | --- | --- |",
          "| [react](https://github.com/react/react) | `19.2.8` | `19.3.0` |",
          "| [typescript](https://github.com/microsoft/TypeScript) | `5.9.3` | `7.0.2` |",
        ].join("\n"),
        headRefName: "dependabot/npm_and_yarn/website-5d2a1f",
        authorLogin: "dependabot",
        commitMessages: [
          trailer(
            "- dependency-name: react",
            "  dependency-version: 19.3.0",
            "  dependency-type: direct:production",
            "  update-type: version-update:semver-minor",
            "- dependency-name: typescript",
            "  dependency-version: 7.0.2",
            "  dependency-type: direct:development",
            "  update-type: version-update:semver-major",
          ),
        ],
      }),
    );
    expect(parsed?.bumps.map((b) => [b.pkg, b.from, b.to, b.semver])).toEqual([
      ["react", "19.2.8", "19.3.0", "minor"],
      ["typescript", "5.9.3", "7.0.2", "major"],
    ]);
  });

  test("github actions major bump", () => {
    const parsed = parseBotPr(
      pr({
        title: "Bump actions/checkout from 3 to 4",
        body: "Bumps [actions/checkout](https://github.com/actions/checkout) from 3 to 4.",
        headRefName: "dependabot/github_actions/actions/checkout-4",
        authorLogin: "dependabot",
        commitMessages: [
          trailer(
            "- dependency-name: actions/checkout",
            "  dependency-type: direct:production",
            "  update-type: version-update:semver-major",
          ),
        ],
      }),
    );
    expect(parsed?.bumps[0]).toMatchObject({
      ecosystem: "github-actions",
      pkg: "actions/checkout",
      from: "3",
      to: "4",
      semver: "major",
    });
  });

  test("no trailer falls back to the title", () => {
    const parsed = parseBotPr(
      pr({
        title: "Bump ini from 1.3.5 to 1.3.8",
        headRefName: "dependabot/npm_and_yarn/ini-1.3.8",
        authorLogin: "dependabot",
        commitMessages: [
          "Bump ini from 1.3.5 to 1.3.8\n\nBumps [ini](https://x) from 1.3.5 to 1.3.8.",
        ],
      }),
    );
    expect(parsed?.bumps).toEqual([
      {
        ecosystem: "npm",
        pkg: "ini",
        from: "1.3.5",
        to: "1.3.8",
        semver: "patch",
        directory: "/",
        dependencyType: null,
      },
    ]);
  });
});

describe("renovate", () => {
  test("parses the change table regardless of column order", () => {
    const parsed = parseBotPr(
      pr({
        title: "Update dependency lodash to v4.17.21",
        headRefName: "renovate/lodash-4.x",
        authorLogin: "renovate",
        body: [
          "This PR contains the following updates:",
          "",
          "| Package | Change | Age | Confidence |",
          "|---|---|---|---|",
          "| [lodash](https://lodash.com/) ([source](https://github.com/lodash/lodash)) | [`4.17.15` -> `4.17.21`](https://renovatebot.com/diffs/npm/lodash/4.17.15/4.17.21) | ![age](x) | ![confidence](y) |",
          "| [semver](https://github.com/npm/node-semver) | [`7.3.2` → `8.0.0`](https://renovatebot.com/diffs/npm/semver/7.3.2/8.0.0) | ![age](x) | ![confidence](y) |",
        ].join("\n"),
      }),
    );
    expect(parsed?.bumps.map((b) => [b.ecosystem, b.pkg, b.from, b.to, b.semver])).toEqual([
      ["npm", "lodash", "4.17.15", "4.17.21", "patch"],
      ["npm", "semver", "7.3.2", "8.0.0", "major"],
    ]);
  });

  test("falls back to the title and infers ecosystem from files", () => {
    const parsed = parseBotPr(
      pr({
        title: "Update actions/checkout action to v4",
        headRefName: "renovate/actions-checkout-4.x",
        authorLogin: "renovate[bot]",
        files: [".github/workflows/ci.yml"],
      }),
    );
    expect(parsed?.bumps[0]).toMatchObject({
      ecosystem: "github-actions",
      pkg: "actions/checkout",
      to: "4",
    });
  });
});

test('Dependabot\'s "5 to 6" and Renovate\'s "v5 -> v6" are the same bump', () => {
  const dependabot = parseBotPr(
    pr({
      title: "Bump actions/setup-go from 5 to 6",
      headRefName: "dependabot/github_actions/actions/setup-go-6",
      authorLogin: "dependabot",
      files: [".github/workflows/ci.yml"],
    }),
  );
  const renovate = parseBotPr(
    pr({
      title: "Update actions/setup-go action to v6",
      headRefName: "renovate/actions-setup-go-6.x",
      authorLogin: "renovate[bot]",
      files: [".github/workflows/ci.yml"],
      body: [
        "| Package | Type | Update | Change |",
        "|---|---|---|---|",
        "| [actions/setup-go](https://github.com/actions/setup-go) | action | major | `v5` -> `v6` |",
      ].join("\n"),
    }),
  );
  const [a] = dependabot?.bumps ?? [];
  const [b] = renovate?.bumps ?? [];
  expect(a && bumpKey(a)).toBe("github-actions:actions/setup-go@6");
  expect(b && bumpKey(b)).toBe("github-actions:actions/setup-go@6");
  expect(b?.from).toBe("5");
});

describe("helpers", () => {
  test("human PRs are not bot PRs", () => {
    expect(detectBot({ authorLogin: "alice", headRefName: "feature/x" })).toBeNull();
    expect(
      parseBotPr(pr({ title: "Bump version", authorLogin: "alice", headRefName: "bump" })),
    ).toBeNull();
  });

  test("classify compares the first differing component", () => {
    expect(classify("1.2.3", "1.2.4")).toBe("patch");
    expect(classify("1.2.3", "1.3.0")).toBe("minor");
    expect(classify("v1.2.3", "v2.0.0")).toBe("major");
    expect(classify("3", "4")).toBe("major");
    expect(classify(null, "4")).toBe("unknown");
    expect(classify("abc123", "def456")).toBe("unknown");
    expect(
      classify(
        "02cb101ec7c40f2c49e1d9714d64511d8e1b74de",
        "7e38f4b43b4db5c8dd498af069a4f6196df1d067",
      ),
    ).toBe("unknown");
  });

  test("ecosystem from files only when unambiguous", () => {
    expect(ecosystemFromFiles(["web/package.json", "web/package-lock.json"])).toBe("npm");
    expect(ecosystemFromFiles(["go.mod", "package.json"])).toBeNull();
    expect(ecosystemFromFiles(["src/index.ts"])).toBeNull();
  });

  test("bump keys ignore package name casing", () => {
    expect(bumpKey({ ecosystem: "npm", pkg: "Lodash", to: "4.17.21" })).toBe("npm:lodash@4.17.21");
  });
});
