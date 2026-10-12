import type { Bot, Bump, Ecosystem, SemverClass } from "@pier/core/wire";

// Turns a bot PR into the dependency bumps it carries. Sources, most to least trusted:
// Dependabot's `updated-dependencies` commit trailer, the PR body, the title, the branch name,
// and finally the changed file paths (ecosystem only).

export type BotPrInput = {
  title: string;
  body: string;
  headRefName: string;
  authorLogin: string | null;
  /** Oldest first. */
  commitMessages: string[];
  files: string[];
};

export type ParsedBotPr = { bot: Bot; bumps: Bump[] };

export function detectBot(pr: Pick<BotPrInput, "authorLogin" | "headRefName">): Bot | null {
  const login =
    pr.authorLogin
      ?.toLowerCase()
      .replace(/\[bot\]$/, "")
      .replace(/^app\//, "") ?? "";
  if (login === "dependabot" || login === "dependabot-preview") return "dependabot";
  if (login === "renovate" || login === "renovate-bot" || login === "mend-renovate")
    return "renovate";
  if (pr.headRefName.startsWith("dependabot/")) return "dependabot";
  if (pr.headRefName.startsWith("renovate/")) return "renovate";
  return null;
}

export function parseBotPr(pr: BotPrInput): ParsedBotPr | null {
  const bot = detectBot(pr);
  if (!bot) return null;
  const bumps = bot === "dependabot" ? parseDependabot(pr) : parseRenovate(pr);
  return bumps.length > 0 ? { bot, bumps } : null;
}

// ---------------------------------------------------------------------------
// Dependabot

const DEPENDABOT_ECOSYSTEMS: Record<string, Ecosystem> = {
  npm_and_yarn: "npm",
  bun: "npm",
  go_modules: "gomod",
  github_actions: "github-actions",
  cargo: "cargo",
  pip: "pip",
  uv: "pip",
  bundler: "bundler",
  composer: "composer",
  maven: "maven",
  gradle: "gradle",
  nuget: "nuget",
  docker: "docker",
  docker_compose: "docker",
  terraform: "terraform",
};

type TrailerEntry = {
  name: string;
  version: string | null;
  type: string | null;
  updateType: string | null;
};

function parseDependabot(pr: BotPrInput): Bump[] {
  const branchParts = pr.headRefName.split("/");
  const ecosystem =
    DEPENDABOT_ECOSYSTEMS[branchParts[1] ?? ""] ?? ecosystemFromFiles(pr.files) ?? "unknown";
  const directory = directoryFromTitle(pr.title) ?? directoryFromBody(pr.body) ?? "/";

  const ranges = versionRanges(pr.title, pr.body);
  const trailer = latestTrailer(pr.commitMessages);

  if (trailer.length > 0) {
    return trailer.map((entry) => {
      const range = ranges.get(entry.name.toLowerCase());
      const to = entry.version ?? range?.to ?? "unknown";
      return {
        ecosystem,
        pkg: entry.name,
        from: range?.from ?? null,
        to,
        semver: semverFromUpdateType(entry.updateType) ?? classify(range?.from ?? null, to),
        directory,
        dependencyType: entry.type,
      };
    });
  }

  // No trailer (very old PRs or a squashed branch): fall back to what the title and body say.
  return [...ranges.entries()].map(([, range]) => ({
    ecosystem,
    pkg: range.name,
    from: range.from,
    to: range.to,
    semver: classify(range.from, range.to),
    directory,
    dependencyType: null,
  }));
}

/** Reads the YAML-ish `updated-dependencies:` block Dependabot appends to its commits. */
function latestTrailer(messages: string[]): TrailerEntry[] {
  for (const message of messages.toReversed()) {
    const start = message.indexOf("updated-dependencies:");
    if (start === -1) continue;
    const entries: TrailerEntry[] = [];
    for (const line of message.slice(start).split("\n").slice(1)) {
      const item = /^-\s+dependency-name:\s*(.+)$/.exec(line.trim());
      if (item?.[1]) {
        entries.push({ name: unquote(item[1]), version: null, type: null, updateType: null });
        continue;
      }
      const field = /^([a-z-]+):\s*(.*)$/.exec(line.trim());
      const current = entries.at(-1);
      if (!field || !current) {
        if (line.trim() === "..." || line.startsWith("Signed-off-by")) break;
        continue;
      }
      const value = unquote(field[2] ?? "");
      if (field[1] === "dependency-version") current.version = value;
      else if (field[1] === "dependency-type") current.type = value;
      else if (field[1] === "update-type") current.updateType = value;
    }
    if (entries.length > 0) return entries;
  }
  return [];
}

type Range = { name: string; from: string | null; to: string };

/** Every "X from A to B" the title and body mention, keyed by lower-cased package name. */
function versionRanges(title: string, body: string): Map<string, Range> {
  const ranges = new Map<string, Range>();
  const add = (name: string, from: string | null, to: string) => {
    const key = name.toLowerCase();
    if (!ranges.has(key))
      ranges.set(key, { name, from: from && cleanVersion(from), to: cleanVersion(to) });
  };

  // Grouped updates: "Updates `lodash` from 4.17.15 to 4.17.21"
  for (const m of body.matchAll(/Updates? `([^`]+)` from (\S+) to (\S+)/g)) {
    if (m[1] && m[2] && m[3]) add(m[1], m[2], m[3]);
  }
  // Large groups summarise in a table first, because the per-package prose gets truncated:
  // "| [react](https://…) | `19.2.8` | `19.3.0` |"
  for (const m of body.matchAll(
    /^\|\s*\[([^\]]+)\]\([^)]*\)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/gm,
  )) {
    if (m[1] && m[2] && m[3]) add(m[1], m[2], m[3]);
  }
  // Single update: "Bumps [lodash](https://…) from 4.17.15 to 4.17.21."
  for (const m of body.matchAll(/Bumps \[([^\]]+)\]\([^)]*\) from (\S+) to (\S+)/g)) {
    if (m[1] && m[2] && m[3]) add(m[1], m[2], m[3]);
  }
  // Title: "Bump lodash from 4.17.15 to 4.17.21 in /web", optionally with a conventional prefix.
  const t = /(?:^|:\s*)bump (\S+) from (\S+) to (\S+)/i.exec(title);
  if (t?.[1] && t[2] && t[3] && t[1].toLowerCase() !== "the") add(t[1], t[2], t[3]);
  return ranges;
}

function directoryFromTitle(title: string): string | null {
  const m = / in (\/\S*)\s*$/.exec(title);
  return m?.[1] ?? null;
}

function directoryFromBody(body: string): string | null {
  const m = /in the (\/\S*) directory/.exec(body);
  return m?.[1] ?? null;
}

const UPDATE_TYPES: Record<string, SemverClass> = {
  "version-update:semver-major": "major",
  "version-update:semver-minor": "minor",
  "version-update:semver-patch": "patch",
};

function semverFromUpdateType(updateType: string | null): SemverClass | null {
  return (updateType && UPDATE_TYPES[updateType]) || null;
}

// ---------------------------------------------------------------------------
// Renovate

const RENOVATE_DATASOURCES: Record<string, Ecosystem> = {
  npm: "npm",
  go: "gomod",
  "github-tags": "github-actions",
  "github-releases": "github-actions",
  "github-actions": "github-actions",
  crate: "cargo",
  pypi: "pip",
  rubygems: "bundler",
  packagist: "composer",
  maven: "maven",
  "gradle-version": "gradle",
  nuget: "nuget",
  docker: "docker",
  "terraform-provider": "terraform",
  "terraform-module": "terraform",
};

function parseRenovate(pr: BotPrInput): Bump[] {
  const fileEcosystem = ecosystemFromFiles(pr.files);
  const bumps = renovateTable(pr.body).map(({ name, from, to, datasource }) => ({
    ecosystem:
      (datasource ? RENOVATE_DATASOURCES[datasource] : undefined) ?? fileEcosystem ?? "unknown",
    pkg: name,
    from,
    to,
    semver: classify(from, to),
    directory: "/",
    dependencyType: null,
  }));
  if (bumps.length > 0) return bumps;

  // Title fallback: "Update dependency lodash to v4.17.21", "Update actions/checkout action to v4".
  const t =
    /update (?:dependency |module |plugin |image )?(\S+)(?: (?:action|digest|docker tag))? to v?(\S+)/i.exec(
      pr.title,
    );
  if (!t?.[1] || !t[2]) return [];
  const to = cleanVersion(t[2]);
  return [
    {
      ecosystem: fileEcosystem ?? "unknown",
      pkg: t[1],
      from: null,
      to,
      semver: classify(null, to),
      directory: "/",
      dependencyType: null,
    },
  ];
}

type TableRow = { name: string; from: string | null; to: string; datasource: string | null };

/** Parses Renovate's "| Package | Change | … |" table. Column order varies by config. */
function renovateTable(body: string): TableRow[] {
  const lines = body.split("\n").map((l) => l.trim());
  const headerIndex = lines.findIndex((l) => /^\|.*\bPackage\b.*\|/i.test(l) && /Change/i.test(l));
  if (headerIndex === -1) return [];
  const header = cells(lines[headerIndex] ?? "").map((c) => c.toLowerCase());
  const packageCol = header.findIndex((c) => c.includes("package"));
  const changeCol = header.findIndex((c) => c.includes("change"));

  const rows: TableRow[] = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.startsWith("|")) break;
    const row = cells(line);
    const packageCell = row[packageCol] ?? "";
    const changeCell = row[changeCol] ?? "";
    const name =
      /\[([^\]]+)\]/.exec(packageCell)?.[1] ?? /`([^`]+)`/.exec(packageCell)?.[1] ?? packageCell;
    const change = /`([^`]+)`\s*(?:->|→)\s*`([^`]+)`/.exec(changeCell);
    if (!name || !change?.[2]) continue;
    const datasource = /renovatebot\.com\/diffs\/([^/]+)\//.exec(changeCell)?.[1] ?? null;
    rows.push({
      name: name.trim(),
      from: cleanVersion(change[1] ?? ""),
      to: cleanVersion(change[2]),
      datasource,
    });
  }
  return rows;
}

function cells(line: string): string[] {
  return line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

// ---------------------------------------------------------------------------
// Shared helpers

const MANIFESTS: [RegExp, Ecosystem][] = [
  [
    /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/,
    "npm",
  ],
  [/(^|\/)go\.(mod|sum)$/, "gomod"],
  [/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$|(^|\/)action\.ya?ml$/, "github-actions"],
  [/(^|\/)Cargo\.(toml|lock)$/, "cargo"],
  [/(^|\/)(requirements[^/]*\.txt|Pipfile(\.lock)?|pyproject\.toml|poetry\.lock|uv\.lock)$/, "pip"],
  [/(^|\/)Gemfile(\.lock)?$/, "bundler"],
  [/(^|\/)composer\.(json|lock)$/, "composer"],
  [/(^|\/)pom\.xml$/, "maven"],
  [/(^|\/)(build\.gradle(\.kts)?|gradle\.lockfile|libs\.versions\.toml)$/, "gradle"],
  [/\.(cs|fs|vb)proj$|(^|\/)packages\.lock\.json$/, "nuget"],
  [/(^|\/)Dockerfile[^/]*$|(^|\/)(docker-)?compose[^/]*\.ya?ml$/, "docker"],
  [/\.tf$|(^|\/)\.terraform\.lock\.hcl$/, "terraform"],
];

/** The ecosystem whose manifests make up the changed files, when it is unambiguous. */
export function ecosystemFromFiles(files: string[]): Ecosystem | null {
  const found = new Set<Ecosystem>();
  for (const file of files) {
    const match = MANIFESTS.find(([pattern]) => pattern.test(file));
    if (match) found.add(match[1]);
  }
  return found.size === 1 ? [...found][0]! : null;
}

/** Whether a path is a manifest or lockfile of the given ecosystem. */
export function isManifestOf(ecosystem: Ecosystem, path: string): boolean {
  return MANIFESTS.some(([pattern, eco]) => eco === ecosystem && pattern.test(path));
}

/** Classifies a version change by its first differing numeric component. */
export function classify(from: string | null, to: string): SemverClass {
  if (!from) return "unknown";
  const a = numericParts(from);
  const b = numericParts(to);
  if (!a || !b) return "unknown";
  for (const [i, level] of (["major", "minor", "patch"] as const).entries()) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return level;
  }
  return "patch";
}

function numericParts(version: string): number[] | null {
  // Commit SHAs (pinned actions, git dependencies) aren't versions, even when they start with digits.
  if (/^[0-9a-f]{7,40}$/i.test(version.trim()) && /[a-f]/i.test(version)) return null;
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version.trim());
  if (!m) return null;
  return [m[1], m[2], m[3]].map((part) => Number(part ?? 0));
}

function cleanVersion(version: string): string {
  return unquote(version)
    .replace(/[.,;:]+$/, "")
    .replace(/^`|`$/g, "");
}

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

/** Stable identity of "this package moving to this version" across repos and bots. */
export function bumpKey(bump: Pick<Bump, "ecosystem" | "pkg" | "to">): string {
  return `${bump.ecosystem}:${bump.pkg.toLowerCase()}@${bump.to}`;
}
