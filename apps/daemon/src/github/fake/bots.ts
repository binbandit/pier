import { classify } from "@/domain/bumps";
import type { Bump } from "@pier/core/wire";

import type { CatalogEcosystem, CatalogEntry } from "./catalog";
import { Random } from "./random";
import type { FileChange } from "./world";

// Dependabot and Renovate PRs as the bots write them: titles, bodies, branch names, commit
// messages (Dependabot's `updated-dependencies:` trailer) and manifest/lockfile patches. Everything
// derived from a (package, version) is hashed from it, so the same bump reads the same in every
// repo, like release notes and lockfile integrity hashes do on GitHub.

export type DependencyType = "direct:production" | "direct:development" | "indirect";

export type PlannedBump = {
  entry: CatalogEntry;
  from: string;
  to: string;
  directory: string;
  dependencyType: DependencyType;
};

export type BotStyle = {
  /** The repo's commit-message prefix ("chore(deps)"), or null for plain "Bump …". */
  prefix: string | null;
  lockfile: "package-lock.json" | "pnpm-lock.yaml" | "yarn.lock";
  /** Whether Dependabot's trailer carries `update-type` (it depends on the repo's config). */
  updateTypes: boolean;
  /** Newer Renovate writes "→" in its change table, older "->". */
  arrow: "->" | "→";
};

export type BotPr = {
  author: "dependabot" | "renovate";
  title: string;
  body: string;
  headRefName: string;
  commitMessage: string;
  files: FileChange[];
  labels: { name: string; color: string }[];
  /** What parseBotPr should read back out of this PR. */
  bumps: Bump[];
};

const PACKAGE_MANAGERS: Record<CatalogEcosystem, string> = {
  npm: "npm_and_yarn",
  "github-actions": "github_actions",
  gomod: "go_modules",
  cargo: "cargo",
  docker: "docker",
};

const LANGUAGE_LABELS: Record<CatalogEcosystem, { name: string; color: string }> = {
  npm: { name: "javascript", color: "168700" },
  "github-actions": { name: "github_actions", color: "000000" },
  gomod: { name: "go", color: "16e2e2" },
  cargo: { name: "rust", color: "000000" },
  docker: { name: "docker", color: "21ceff" },
};

// ---------------------------------------------------------------------------
// Dependabot

/** `newDeps` are packages the update pulls into an npm lockfile for the first time. */
export function dependabotPr(
  bumps: PlannedBump[],
  style: BotStyle,
  group: string | null,
  newDeps: string[] = [],
): BotPr {
  const first = bumps[0];
  if (!first) throw new Error("a bot PR needs at least one bump");
  const ecosystem = first.entry.ecosystem;
  const directory = first.directory;
  const dirSegment = directory === "/" ? "" : `${directory.slice(1)}/`;
  const allDev = bumps.every((b) => b.dependencyType === "direct:development");
  const verb = style.prefix
    ? `${allDev ? style.prefix.replace(/\)$/, "-dev)") : style.prefix}: bump`
    : "Bump";
  const suffix = directory === "/" ? "" : ` in ${directory}`;

  const title = group
    ? groupTitle(verb, group, bumps.length, directory)
    : `${verb} ${first.entry.name} from ${first.from} to ${first.to}${suffix}`;
  const headRefName = group
    ? `dependabot/${PACKAGE_MANAGERS[ecosystem]}/${dirSegment}${group}-${hash(title + bumps.map(key).join()).hex(10)}`
    : `dependabot/${PACKAGE_MANAGERS[ecosystem]}/${dirSegment}${first.entry.name.replace(/^@/, "")}-${first.to}`;

  const intro = group ? groupIntro(group, bumps, directory) : singleIntro(first);
  const sections = group
    ? bumps.map((b) => `Updates \`${b.entry.name}\` from ${b.from} to ${b.to}\n${notesHtml(b)}`)
    : [notesHtml(first)];
  const body = [
    intro,
    sections.join("\n\n"),
    "<br />\n\n",
    ...(group ? [] : [compatibilityBadge(first)]),
    DEPENDABOT_FOOTER,
  ].join("\n");

  const summary = group
    ? [
        intro.split("\n")[0],
        ...bumps.map((b) => `Updates \`${b.entry.name}\` from ${b.from} to ${b.to}\n${links(b)}`),
      ]
    : [`${singleIntro(first)}\n${links(first)}`];
  const trailer = bumps.flatMap((b) => [
    `- dependency-name: ${b.entry.name}`,
    `  dependency-version: ${yamlScalar(b.to)}`,
    `  dependency-type: ${b.dependencyType}`,
    ...(style.updateTypes && semverOf(b) !== "unknown"
      ? [`  update-type: version-update:semver-${semverOf(b)}`]
      : []),
    ...(group ? [`  dependency-group: ${group}`] : []),
  ]);
  const commitMessage = [
    title,
    "",
    summary.join("\n\n"),
    "",
    "---",
    "updated-dependencies:",
    ...trailer,
    "...",
    "",
    "Signed-off-by: dependabot[bot] <support@github.com>",
  ].join("\n");

  return {
    author: "dependabot",
    title,
    body,
    headRefName,
    commitMessage,
    files: manifestFiles(bumps, style, newDeps),
    labels: [{ name: "dependencies", color: "0366d6" }, LANGUAGE_LABELS[ecosystem]],
    bumps: bumps.map((b) => ({
      ecosystem,
      pkg: b.entry.name,
      from: b.from,
      to: b.to,
      semver: semverOf(b),
      directory,
      dependencyType: b.dependencyType,
    })),
  };
}

function groupTitle(verb: string, group: string, count: number, directory: string): string {
  // Dependabot has written both shapes over time; multi-directory configs use "across".
  const where = hash(group + directory).chance(0.5)
    ? "across 1 directory "
    : directory === "/"
      ? ""
      : `in ${directory} `;
  return `${verb} the ${group} group ${where}with ${count} update${count === 1 ? "" : "s"}`;
}

function singleIntro(b: PlannedBump): string {
  // Docker images have no source link, so Dependabot names them bare.
  const name =
    b.entry.ecosystem === "docker" ? b.entry.name : `[${b.entry.name}](${b.entry.source})`;
  return `Bumps ${name} from ${b.from} to ${b.to}.`;
}

function groupIntro(group: string, bumps: PlannedBump[], directory: string): string {
  const head = `Bumps the ${group} group with ${bumps.length} updates in the ${directory} directory`;
  const named = bumps.map((b) => `[${b.entry.name}](${b.entry.source})`);
  // Bigger groups lead with a table, because the prose list gets truncated.
  if (bumps.length >= 4) {
    const rows = bumps.map(
      (b) => `| [${b.entry.name}](${b.entry.source}) | \`${b.from}\` | \`${b.to}\` |`,
    );
    return [`${head}:`, "", "| Package | From | To |", "| --- | --- | --- |", ...rows, ""].join(
      "\n",
    );
  }
  const list =
    named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
  return `${head}: ${list}.\n`;
}

function links(b: PlannedBump): string {
  if (b.entry.ecosystem === "docker") return "";
  return [
    `- [Release notes](${b.entry.source}/releases)`,
    `- [Commits](${b.entry.source}/compare/${tag(b.from)}...${tag(b.to)})`,
  ].join("\n");
}

function notesHtml(b: PlannedBump): string {
  const { name, source } = b.entry;
  const notes = releaseNotes(b);
  const commits = notes.map((note) => {
    const sha = hash(`${name}@${b.to}:${note}`).hex(40);
    return `<li><a href="${source}/commit/${sha}"><code>${sha.slice(0, 7)}</code></a> ${escapeHtml(note)}</li>`;
  });
  return [
    "<details>",
    "<summary>Release notes</summary>",
    `<p><em>Sourced from <a href="${source}/releases">${escapeHtml(name)}'s releases</a>.</em></p>`,
    "<blockquote>",
    `<h2>${tag(b.to)}</h2>`,
    "<ul>",
    ...notes.map((note) => `<li>${escapeHtml(note)}</li>`),
    "</ul>",
    "</blockquote>",
    "</details>",
    "<details>",
    "<summary>Commits</summary>",
    "<ul>",
    ...commits,
    `<li>See full diff in <a href="${source}/compare/${tag(b.from)}...${tag(b.to)}">compare view</a></li>`,
    "</ul>",
    "</details>",
  ].join("\n");
}

function compatibilityBadge(b: PlannedBump): string {
  const params = new URLSearchParams({
    "dependency-name": b.entry.name,
    "package-manager": PACKAGE_MANAGERS[b.entry.ecosystem],
    "previous-version": b.from,
    "new-version": b.to,
  });
  return `[![Dependabot compatibility score](https://dependabot-badges.githubapp.com/badges/compatibility_score?${params.toString()})](https://docs.github.com/en/github/managing-security-vulnerabilities/about-dependabot-security-updates#about-compatibility-scores)\n`;
}

const DEPENDABOT_FOOTER = `Dependabot will resolve any conflicts with this PR as long as you don't alter it yourself. You can also trigger a rebase manually by commenting \`@dependabot rebase\`.

[//]: # (dependabot-automerge-start)
[//]: # (dependabot-automerge-end)

---

<details>
<summary>Dependabot commands and options</summary>
<br />

You can trigger Dependabot actions by commenting on this PR:
- \`@dependabot rebase\` will rebase this PR
- \`@dependabot recreate\` will recreate this PR, overwriting any edits that have been made to it
- \`@dependabot show <dependency name> ignore conditions\` will show all of the ignore conditions of the specified dependency
- \`@dependabot ignore this major version\` will close this PR and stop Dependabot creating any more for this major version (unless you reopen the PR or upgrade to it yourself)
- \`@dependabot ignore this minor version\` will close this PR and stop Dependabot creating any more for this minor version (unless you reopen the PR or upgrade to it yourself)
- \`@dependabot ignore this dependency\` will close this PR and stop Dependabot creating any more for this dependency (unless you reopen the PR or upgrade to it yourself)


</details>`;

// ---------------------------------------------------------------------------
// Renovate

export function renovatePr(
  bumps: PlannedBump[],
  style: BotStyle,
  repo: string,
  newDeps: string[] = [],
): BotPr {
  const first = bumps[0];
  if (!first) throw new Error("a bot PR needs at least one bump");
  const grouped = bumps.length > 1;
  const isAction = first.entry.ecosystem === "github-actions";
  // Renovate keeps the tag's "v" for actions and drops it for npm versions.
  const version = (v: string) => (isAction ? tag(v) : v);
  const verb = style.prefix ? `${style.prefix}: update` : "Update";
  const major = semverOf(first) === "major";
  const toLabel = major ? `v${first.to.replace(/^v/, "").split(".")[0]}` : tag(first.to);

  const title = grouped
    ? `${verb} all non-major dependencies`
    : isAction
      ? `${verb} ${first.entry.name} action to ${toLabel}`
      : `${verb} dependency ${first.entry.name} to ${toLabel}`;
  const headRefName = grouped
    ? "renovate/all-minor-patch"
    : `renovate/${first.entry.name.replace(/^@/, "").replaceAll("/", "-")}-${first.to.replace(/^v/, "").split(".")[0]}.x`;

  const table = isAction
    ? [
        "| Package | Type | Update | Change |",
        "|---|---|---|---|",
        ...bumps.map(
          (b) =>
            `| [${b.entry.name}](https://redirect.github.com/${b.entry.name}) | action | ${semverOf(b)} | \`${version(b.from)}\` ${style.arrow} \`${version(b.to)}\` |`,
        ),
      ]
    : [
        "| Package | Change | Age | Confidence |",
        "|---|---|---|---|",
        ...bumps.map((b) => {
          const name = b.entry.name;
          const encoded = name.replace("/", "%2f");
          const badge = (kind: string, path: string) =>
            `[![${kind}](https://developer.mend.io/api/mc/badges/${kind}/npm/${encoded}/${path}?slim=true)](https://docs.renovatebot.com/merge-confidence/)`;
          return `| [${name}](${b.entry.source}) ([source](${b.entry.source})) | [\`${b.from}\` ${style.arrow} \`${b.to}\`](https://renovatebot.com/diffs/npm/${encoded}/${b.from}/${b.to}) | ${badge("age", b.to)} | ${badge("confidence", `${b.from}/${b.to}`)} |`;
        }),
      ];

  const notes = bumps.map((b) => {
    const repoPath = b.entry.source.replace("https://github.com/", "");
    return [
      "<details>",
      `<summary>${repoPath} (${b.entry.name})</summary>`,
      "",
      `### [\`${tag(b.to)}\`](${b.entry.source}/releases/tag/${tag(b.to)})`,
      "",
      `[Compare Source](${b.entry.source}/compare/${tag(b.from)}...${tag(b.to)})`,
      "",
      ...releaseNotes(b).map((note) => `- ${note}`),
      "",
      "</details>",
    ].join("\n");
  });

  const body = [
    "This PR contains the following updates:",
    "",
    ...table,
    "",
    "---",
    "",
    "### Release Notes",
    "",
    notes.join("\n\n"),
    "",
    RENOVATE_FOOTER.replace("{repo}", repo),
  ].join("\n");

  return {
    author: "renovate",
    title,
    body,
    headRefName,
    commitMessage: title,
    files: manifestFiles(bumps, style, newDeps),
    labels: [],
    bumps: bumps.map((b) => ({
      ecosystem: b.entry.ecosystem,
      pkg: b.entry.name,
      from: version(b.from),
      to: version(b.to),
      semver: semverOf(b),
      directory: "/",
      dependencyType: null,
    })),
  };
}

const RENOVATE_FOOTER = `---

### Configuration

📅 **Schedule**: Branch creation - At any time (no schedule defined), Automerge - At any time (no schedule defined).

🚦 **Automerge**: Disabled by config. Please merge this manually once you are satisfied.

♻ **Rebasing**: Whenever PR becomes conflicted, or you tick the rebase/retry checkbox.

🔕 **Ignore**: Close this PR and you won't be reminded about this update again.

---

 - [ ] <!-- rebase-check -->If you want to rebase/retry this PR, check this box

---

This PR was generated by [Mend Renovate](https://mend.io/renovate/). View the [repository job log](https://developer.mend.io/github/{repo}).
<!--renovate-debug:eyJjcmVhdGVkSW5WZXIiOiI0MS4xNDQuMyIsInVwZGF0ZWRJblZlciI6IjQxLjE0NC4zIn0=-->`;

// ---------------------------------------------------------------------------
// Manifest and lockfile patches

/** A hunk whose header counts are derived from its lines. */
type Hunk = { at: number; lines: string[]; section?: string };

const ctx = (line: string) => ` ${line}`;
const del = (line: string) => `-${line}`;
const add = (line: string) => `+${line}`;

function patchOf(hunks: Hunk[]): string {
  let delta = 0;
  let free = 1;
  return hunks
    .toSorted((a, b) => a.at - b.at)
    .map((h) => {
      const oldCount = h.lines.filter((l) => !l.startsWith("+")).length;
      const newCount = h.lines.filter((l) => !l.startsWith("-")).length;
      // Hashed positions can collide; hunks must stay in order and apart.
      const at = Math.max(h.at, free);
      free = at + oldCount + 4;
      const header = `@@ -${at},${oldCount} +${at + delta},${newCount} @@${h.section ? ` ${h.section}` : ""}`;
      delta += newCount - oldCount;
      return [header, ...h.lines].join("\n");
    })
    .join("\n");
}

/** The files a set of bumps touches, all in one ecosystem and directory. */
function manifestFiles(bumps: PlannedBump[], style: BotStyle, newDeps: string[]): FileChange[] {
  const first = bumps[0];
  if (!first) return [];
  const dir = first.directory === "/" ? "" : `${first.directory.slice(1)}/`;
  switch (first.entry.ecosystem) {
    case "npm":
      return npmFiles(bumps, dir, style.lockfile, newDeps);
    case "github-actions":
      return actionFiles(bumps);
    case "gomod":
      return [
        { path: `${dir}go.mod`, patch: patchOf(bumps.map(goModHunk)) },
        { path: `${dir}go.sum`, patch: patchOf(bumps.map(goSumHunk)) },
      ];
    case "cargo":
      return [
        { path: `${dir}Cargo.toml`, patch: patchOf(bumps.map(cargoTomlHunk)) },
        { path: `${dir}Cargo.lock`, patch: patchOf(bumps.map(cargoLockHunk)) },
      ];
    case "docker":
      return [{ path: `${dir}Dockerfile`, patch: patchOf(bumps.map(dockerHunk)) }];
    default:
      return [];
  }
}

function npmFiles(
  bumps: PlannedBump[],
  dir: string,
  lockfile: BotStyle["lockfile"],
  newDeps: string[],
): FileChange[] {
  const direct = bumps.filter((b) => b.dependencyType !== "indirect");
  const files: FileChange[] = [];
  if (direct.length > 0)
    files.push({ path: `${dir}package.json`, patch: patchOf(direct.map(packageJsonHunk)) });
  const lockHunks =
    lockfile === "package-lock.json"
      ? [
          ...bumps.flatMap((b) => [
            ...(b.dependencyType === "indirect" ? [] : [lockRootHunk(b)]),
            lockEntryHunk(b),
          ]),
          // Only package-lock.json is read for new packages, so only it carries them.
          ...(newDeps.length > 0 ? [newPackagesHunk(newDeps)] : []),
        ]
      : lockfile === "pnpm-lock.yaml"
        ? bumps.flatMap(pnpmHunks)
        : bumps.map(yarnHunk);
  files.push({ path: `${dir}${lockfile}`, patch: patchOf(lockHunks) });
  return files;
}

/** Neighbouring dependencies, so context lines look like a real manifest. */
function neighbours(b: PlannedBump): [string, string, string, string] {
  const h = hash(`${b.entry.name}:neighbours`);
  const pool = ["@sentry/node", "clsx", "cors", "dayjs", "nanoid", "p-limit", "picocolors", "yaml"];
  const [a = "clsx", c = "cors", d = "nanoid", e = "yaml"] = h.sample(pool, 4).toSorted();
  return [a, c, d, e];
}

function packageJsonHunk(b: PlannedBump): Hunk {
  const [a, c, d, e] = neighbours(b);
  const h = hash(`${b.entry.name}:package.json`);
  const range = () => `"^${h.int(1, 9)}.${h.int(0, 20)}.${h.int(0, 9)}"`;
  return {
    at: h.int(12, 48),
    lines: [
      ctx(`    "${a}": ${range()},`),
      ctx(`    "${c}": ${range()},`),
      del(`    "${b.entry.name}": "^${b.from}",`),
      add(`    "${b.entry.name}": "^${b.to}",`),
      ctx(`    "${d}": ${range()},`),
      ctx(`    "${e}": ${range()}`),
      ctx("  },"),
    ],
  };
}

function lockRootHunk(b: PlannedBump): Hunk {
  const [a, c, d, e] = neighbours(b);
  return {
    at: hash(`${b.entry.name}:lock-root`).int(14, 60),
    lines: [
      ctx(`        "${a}": "^2.1.1",`),
      ctx(`        "${c}": "^2.8.5",`),
      del(`        "${b.entry.name}": "^${b.from}",`),
      add(`        "${b.entry.name}": "^${b.to}",`),
      ctx(`        "${d}": "^5.1.6",`),
      ctx(`        "${e}": "^2.8.1"`),
      ctx("      },"),
    ],
  };
}

function lockEntryHunk(b: PlannedBump): Hunk {
  const { name } = b.entry;
  const file = name.split("/").at(-1) ?? name;
  const entry = (v: string, mark: (line: string) => string) => [
    mark(`      "version": "${v}",`),
    mark(`      "resolved": "https://registry.npmjs.org/${name}/-/${file}-${v}.tgz",`),
    mark(`      "integrity": "sha512-${integrity(name, v)}",`),
  ];
  return {
    at: hash(`${b.entry.name}:lock-entry`).int(400, 9000),
    lines: [
      ctx("      }"),
      ctx("    },"),
      ctx(`    "node_modules/${name}": {`),
      ...entry(b.from, del),
      ...entry(b.to, add),
      ...(b.dependencyType === "direct:development" ? [ctx('      "dev": true,')] : []),
      ctx('      "license": "MIT",'),
      ctx('      "engines": {'),
      ctx('        "node": ">=18"'),
    ],
  };
}

/** Packages the update installs for the first time (what the transitive gate looks for). */
function newPackagesHunk(names: string[]): Hunk {
  return {
    at: 9200,
    lines: [
      ctx('      "license": "MIT"'),
      ctx("    },"),
      ...names.flatMap((name) => [
        add(`    "node_modules/${name}": {`),
        add('      "version": "1.0.4",'),
        add(`      "resolved": "https://registry.npmjs.org/${name}/-/${name}-1.0.4.tgz",`),
        add(`      "integrity": "sha512-${integrity(name, "1.0.4")}",`),
        add('      "license": "MIT"'),
        add("    },"),
      ]),
      ctx('    "node_modules/zod": {'),
    ],
  };
}

function pnpmHunks(b: PlannedBump): Hunk[] {
  const { name } = b.entry;
  const entryKey = (v: string) => (name.startsWith("@") ? `'${name}@${v}'` : `${name}@${v}`);
  const importer: Hunk = {
    at: hash(`${name}:pnpm-importer`).int(10, 80),
    section: "importers:",
    lines: [
      ctx(`      ${name.startsWith("@") ? `'${name}'` : name}:`),
      del(`        specifier: ^${b.from}`),
      del(`        version: ${b.from}`),
      add(`        specifier: ^${b.to}`),
      add(`        version: ${b.to}`),
    ],
  };
  const pkg: Hunk = {
    at: hash(`${name}:pnpm-package`).int(300, 4000),
    section: "packages:",
    lines: [
      ctx(""),
      del(`  ${entryKey(b.from)}:`),
      del(`    resolution: {integrity: sha512-${integrity(name, b.from)}}`),
      add(`  ${entryKey(b.to)}:`),
      add(`    resolution: {integrity: sha512-${integrity(name, b.to)}}`),
      ctx("    engines: {node: '>=18'}"),
    ],
  };
  return b.dependencyType === "indirect" ? [pkg] : [importer, pkg];
}

function yarnHunk(b: PlannedBump): Hunk {
  const { name } = b.entry;
  const file = name.split("/").at(-1) ?? name;
  const block = (v: string, mark: (line: string) => string) => [
    mark(name.startsWith("@") ? `"${name}@^${v}":` : `${name}@^${v}:`),
    mark(`  version "${v}"`),
    mark(
      `  resolved "https://registry.yarnpkg.com/${name}/-/${file}-${v}.tgz#${hash(`${name}@${v}`).hex(40)}"`,
    ),
    mark(`  integrity sha512-${integrity(name, v)}`),
  ];
  return {
    at: hash(`${name}:yarn`).int(200, 6000),
    lines: [ctx(""), ...block(b.from, del), ...block(b.to, add), ctx("")],
  };
}

function actionFiles(bumps: PlannedBump[]): FileChange[] {
  const workflows = hash(bumps.map(key).join()).chance(0.3)
    ? ["ci.yml", "release.yml"]
    : ["ci.yml"];
  return workflows.map((workflow) => ({
    path: `.github/workflows/${workflow}`,
    patch: patchOf(
      bumps.map((b) => ({
        at: hash(`${b.entry.name}:${workflow}`).int(8, 40),
        section: "jobs:",
        lines: [
          ctx("    runs-on: ubuntu-latest"),
          ctx("    steps:"),
          ctx("      - name: Check out"),
          del(`        uses: ${b.entry.name}@${tag(b.from)}`),
          add(`        uses: ${b.entry.name}@${tag(b.to)}`),
          ctx("        with:"),
          ctx("          fetch-depth: 0"),
          ctx("      - run: npm ci"),
        ],
      })),
    ),
  }));
}

function goModHunk(b: PlannedBump): Hunk {
  return {
    at: hash(`${b.entry.name}:go.mod`).int(5, 30),
    section: "go 1.24",
    lines: [
      ctx("require ("),
      ctx("\tgithub.com/google/uuid v1.6.0"),
      del(`\t${b.entry.name} v${b.from}`),
      add(`\t${b.entry.name} v${b.to}`),
      ctx("\tgolang.org/x/sync v0.17.0"),
      ctx(")"),
    ],
  };
}

function goSumHunk(b: PlannedBump): Hunk {
  const sum = (v: string, mark: (line: string) => string) => [
    mark(`${b.entry.name} v${v} h1:${integrity(`${b.entry.name}h1`, v).slice(0, 43)}=`),
    mark(`${b.entry.name} v${v}/go.mod h1:${integrity(`${b.entry.name}mod`, v).slice(0, 43)}=`),
  ];
  return {
    at: hash(`${b.entry.name}:go.sum`).int(20, 120),
    lines: [...sum(b.from, del), ...sum(b.to, add)],
  };
}

function cargoTomlHunk(b: PlannedBump): Hunk {
  return {
    at: hash(`${b.entry.name}:Cargo.toml`).int(7, 20),
    section: 'edition = "2021"',
    lines: [
      ctx("[dependencies]"),
      ctx('anyhow = "1.0"'),
      del(`${b.entry.name} = { version = "${b.from}", features = ["derive"] }`),
      add(`${b.entry.name} = { version = "${b.to}", features = ["derive"] }`),
      ctx('tracing = "0.1"'),
    ],
  };
}

function cargoLockHunk(b: PlannedBump): Hunk {
  return {
    at: hash(`${b.entry.name}:Cargo.lock`).int(100, 1500),
    lines: [
      ctx(""),
      ctx("[[package]]"),
      ctx(`name = "${b.entry.name}"`),
      del(`version = "${b.from}"`),
      add(`version = "${b.to}"`),
      ctx('source = "registry+https://github.com/rust-lang/crates.io-index"'),
      del(`checksum = "${hash(`${b.entry.name}@${b.from}`).hex(64)}"`),
      add(`checksum = "${hash(`${b.entry.name}@${b.to}`).hex(64)}"`),
    ],
  };
}

function dockerHunk(b: PlannedBump): Hunk {
  return {
    at: 1,
    lines: [
      del(`FROM ${b.entry.name}:${b.from} AS build`),
      add(`FROM ${b.entry.name}:${b.to} AS build`),
      ctx("WORKDIR /app"),
      ctx("COPY . ."),
      ctx("RUN make build"),
    ],
  };
}

// ---------------------------------------------------------------------------
// Shared helpers

const NOTES = [
  "Fix a regression when the input is empty",
  "Add support for ESM-only consumers",
  "Improve error messages for invalid options",
  "Bump internal dependencies",
  "Fix types for strict mode",
  "Reduce install size",
  "Handle Windows paths consistently",
  "Fix memory leak in long-running processes",
  "Document the new configuration flag",
  "Speed up cold starts",
];

function releaseNotes(b: PlannedBump): string[] {
  return hash(`${b.entry.name}@${b.to}:notes`).sample(NOTES, 3);
}

export function semverOf(b: Pick<PlannedBump, "from" | "to">) {
  return classify(b.from, b.to);
}

function key(b: PlannedBump): string {
  return `${b.entry.name}@${b.to}`;
}

/** Tags carry a "v" unless the version already does (or is a Docker tag). */
function tag(version: string): string {
  return /^v|-/.test(version) ? version : `v${version}`;
}

/** YAML would read `5` or `1.10` as numbers, so Dependabot quotes them. */
function yamlScalar(value: string): string {
  return /^\d+(\.\d+)?$/.test(value) ? `'${value}'` : value;
}

function integrity(name: string, version: string): string {
  return `${hash(`${name}@${version}:integrity`).idChars(86).replaceAll("-", "+").replaceAll("_", "/")}==`;
}

/** A Random seeded from text, for details that must match wherever the same bump appears. */
function hash(text: string): Random {
  return new Random(Bun.hash.crc32(text));
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
