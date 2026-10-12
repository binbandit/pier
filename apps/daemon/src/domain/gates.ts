import type { PrDoc } from "@/github/pr-doc";
import type {
  Bot,
  Bump,
  Cohort,
  DiffFile,
  GateId,
  GateResult,
  GateStatus,
  ReleaseInfo,
} from "@pier/core/wire";

import { isManifestOf } from "./bumps";
import type { DepsPolicy } from "./settings";

// The safety gates a bot PR must pass before one key can approve it alongside dozens of others.
// Every gate is a pure function of what we know; "unknown" means we can't tell yet and is
// treated as a reason to look, never as a pass.

export type GateInput = {
  doc: PrDoc;
  bot: Bot;
  bumps: Bump[];
  /** REST files with patches at the current head, if fetched. */
  files: DiffFile[] | null;
  /** Release info per bump, aligned with `bumps`. Null where not looked up yet or unsupported. */
  releases: (ReleaseInfo | null)[];
  policy: DepsPolicy;
  now: number;
};

const GATE_IDS = [
  "semver",
  "release-age",
  "paths",
  "transitive",
  "provenance",
  "install-script",
  "advisory",
  "checks",
] as const satisfies readonly GateId[];

export const GATE_LABELS: Record<GateId, string> = {
  semver: "Semver",
  "release-age": "Release age",
  paths: "Files touched",
  transitive: "New transitive deps",
  provenance: "Commit provenance",
  "install-script": "Install scripts",
  advisory: "Advisories",
  checks: "Checks",
};

export function evaluateGates(input: GateInput): GateResult[] {
  return [
    semverGate(input),
    releaseAgeGate(input),
    pathsGate(input),
    transitiveGate(input),
    provenanceGate(input),
    installScriptGate(input),
    advisoryGate(input),
    checksGate(input),
  ];
}

export type Placement = { cohort: Cohort; reasons: string[] };

/**
 * Stuck: something has to change before approving makes sense (red CI, conflicts, stale).
 * Look: a gate failed or can't be evaluated yet. Clear: every gate passed.
 */
export function place(doc: PrDoc, gates: GateResult[], policy: DepsPolicy, now: number): Placement {
  const stuck: string[] = [];
  if (doc.checks.state === "failure") {
    stuck.push(
      doc.checks.failing > 0
        ? `${doc.checks.failing} failing check${doc.checks.failing === 1 ? "" : "s"}`
        : "checks failing",
    );
  }
  if (doc.mergeable === "conflicting") stuck.push("merge conflicts");
  const ageDays = (now - Date.parse(doc.createdAt)) / 86_400_000;
  if (ageDays > policy.staleAfterDays) stuck.push(`stale: opened ${Math.floor(ageDays)} days ago`);
  if (stuck.length > 0) return { cohort: "stuck", reasons: stuck };

  const look = gates
    .filter((g) => g.status === "fail" || g.status === "unknown")
    .map((g) => g.detail);
  return look.length > 0 ? { cohort: "look", reasons: look } : { cohort: "clear", reasons: [] };
}

/** Group-level summary: the worst status across rows, ignoring rows where a gate doesn't apply. */
export function summarizeGates(rows: GateResult[][]): GateResult[] {
  const order: GateStatus[] = ["fail", "unknown", "pass", "na"];
  return GATE_IDS.map((gate) => {
    const results = rows.flatMap((row) => row.filter((g) => g.gate === gate));
    const worst = results.toSorted((a, b) => order.indexOf(a.status) - order.indexOf(b.status))[0];
    if (!worst) return { gate, status: "na", detail: "Not applicable" };
    const failing = results.filter((g) => g.status === worst.status).length;
    const detail =
      worst.status === "fail" || worst.status === "unknown"
        ? `${worst.detail}${failing > 1 ? ` (+${failing - 1} more)` : ""}`
        : worst.detail;
    return { gate, status: worst.status, detail };
  });
}

// ---------------------------------------------------------------------------

const result = (gate: GateId, status: GateStatus, detail: string): GateResult => ({
  gate,
  status,
  detail,
});

function semverGate({ bumps, policy }: GateInput): GateResult {
  const unknown = bumps.filter((b) => b.semver === "unknown");
  if (unknown.length > 0)
    return result("semver", "unknown", `Can't classify ${unknown.map((b) => b.pkg).join(", ")}`);
  const blocked = bumps.filter(
    (b) => b.semver !== "unknown" && !policy.allowedSemver.includes(b.semver),
  );
  if (blocked.length > 0) {
    return result(
      "semver",
      "fail",
      blocked.map((b) => `${b.pkg} is a ${b.semver} bump`).join("; "),
    );
  }
  return result("semver", "pass", bumps.map((b) => b.semver).join(", "));
}

function releaseAgeGate({ bumps, releases, policy, now }: GateInput): GateResult {
  const ages = bumps.map((bump, i) => ({ bump, release: releases[i] ?? null }));
  const missing = ages.filter(({ release }) => !release?.publishedAt);
  if (missing.length > 0) {
    return result(
      "release-age",
      "unknown",
      `Release date unknown for ${missing.map(({ bump }) => bump.pkg).join(", ")}`,
    );
  }
  const young = ages.filter(({ release }) => {
    const age = (now - Date.parse(release?.publishedAt ?? "")) / 86_400_000;
    return age < policy.minReleaseAgeDays;
  });
  if (young.length > 0) {
    return result(
      "release-age",
      "fail",
      young
        .map(
          ({ bump, release }) =>
            `${bump.pkg} ${bump.to} published ${ago(now - Date.parse(release?.publishedAt ?? ""))}`,
        )
        .join("; "),
    );
  }
  return result("release-age", "pass", `Older than ${policy.minReleaseAgeDays} days`);
}

function pathsGate({ doc, bumps }: GateInput): GateResult {
  if (doc.filesTotal > doc.files.length)
    return result("paths", "unknown", `${doc.filesTotal} files changed; too many to check`);
  const ecosystems = new Set(bumps.map((b) => b.ecosystem));
  const unexpected = doc.files.filter(
    (f) => ![...ecosystems].some((eco) => isManifestOf(eco, f.path)),
  );
  if (unexpected.length > 0) {
    const shown = unexpected
      .slice(0, 3)
      .map((f) => f.path)
      .join(", ");
    return result(
      "paths",
      "fail",
      `Touches ${shown}${unexpected.length > 3 ? ` and ${unexpected.length - 3} more` : ""}`,
    );
  }
  return result("paths", "pass", "Only manifests and lockfiles");
}

/** npm lockfiles only: new `node_modules/…` entries beyond the packages being bumped. */
function transitiveGate({ bumps, files }: GateInput): GateResult {
  if (!bumps.every((b) => b.ecosystem === "npm"))
    return result("transitive", "na", "Not checked for this ecosystem");
  const lockfiles =
    files?.filter((f) => /(^|\/)(package-lock|npm-shrinkwrap)\.json$/.test(f.path)) ?? null;
  if (lockfiles === null) return result("transitive", "unknown", "Lockfile diff not loaded yet");
  if (lockfiles.length === 0) return result("transitive", "na", "No npm lockfile in this PR");
  if (lockfiles.some((f) => f.patch === null))
    return result("transitive", "unknown", "Lockfile diff too large to check");

  const bumped = new Set(bumps.map((b) => b.pkg));
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const file of lockfiles) {
    for (const line of file.patch?.split("\n") ?? []) {
      const m = /^([+-])\s+"(?:.*\/)?node_modules\/([^"]+)": \{/.exec(line);
      if (!m?.[2]) continue;
      (m[1] === "+" ? added : removed).add(m[2]);
    }
  }
  const fresh = [...added].filter((name) => !removed.has(name) && !bumped.has(name));
  if (fresh.length > 0) {
    return result(
      "transitive",
      "fail",
      `+${fresh.length} new transitive: ${fresh.slice(0, 3).join(", ")}${fresh.length > 3 ? "…" : ""}`,
    );
  }
  return result("transitive", "pass", "No new transitive packages");
}

function provenanceGate({ doc, bot, policy }: GateInput): GateResult {
  if (doc.commitsTotal > doc.commits.length) {
    return result(
      "provenance",
      "unknown",
      `${doc.commitsTotal} commits; only the last ${doc.commits.length} checked`,
    );
  }
  const rules = policy.bots[bot];
  for (const commit of doc.commits) {
    const author = commit.authorLogin ?? commit.authorName ?? "unknown";
    const fromBot = rules.authors.includes(author);
    const baseMerge =
      rules.allowBaseMerges &&
      /^Merge (branch|remote-tracking branch|[0-9a-f]{7,40} into)/.test(commit.message);
    if (!fromBot && !baseMerge)
      return result("provenance", "fail", `Commit ${commit.oid.slice(0, 7)} by ${author}`);
    if (fromBot && rules.requireSigned && commit.signatureValid !== true) {
      return result("provenance", "fail", `Commit ${commit.oid.slice(0, 7)} is not signed`);
    }
  }
  return result("provenance", "pass", `All commits by ${bot}`);
}

function installScriptGate({ bumps, releases }: GateInput): GateResult {
  const npm = bumps
    .map((bump, i) => ({ bump, release: releases[i] ?? null }))
    .filter(({ bump }) => bump.ecosystem === "npm");
  if (npm.length === 0) return result("install-script", "na", "npm only");
  const added = npm.filter(({ release }) => release?.hasNewInstallScript === true);
  if (added.length > 0)
    return result(
      "install-script",
      "fail",
      `${added.map(({ bump }) => bump.pkg).join(", ")} adds an install script`,
    );
  const unknown = npm.filter(({ release }) => release?.hasNewInstallScript == null);
  if (unknown.length > 0)
    return result(
      "install-script",
      "unknown",
      `Install scripts unknown for ${unknown.map(({ bump }) => bump.pkg).join(", ")}`,
    );
  return result("install-script", "pass", "No new install scripts");
}

function advisoryGate({ bumps, releases }: GateInput): GateResult {
  const flagged = bumps.flatMap((bump, i) =>
    (releases[i]?.advisories ?? []).map((id) => `${bump.pkg} ${bump.to}: ${id}`),
  );
  if (flagged.length > 0) return result("advisory", "fail", flagged.join("; "));
  const unknown = bumps.filter((_, i) => !releases[i]);
  if (unknown.length > 0)
    return result(
      "advisory",
      "unknown",
      `Advisories unknown for ${unknown.map((b) => b.pkg).join(", ")}`,
    );
  return result("advisory", "pass", "No known advisories");
}

function checksGate({ doc }: GateInput): GateResult {
  const { state, total, pending, failing } = doc.checks;
  if (state === "success") return result("checks", "pass", `${total} passing`);
  if (state === "pending")
    return result("checks", "unknown", `Checks running (${pending} pending)`);
  if (state === "failure") return result("checks", "fail", `${failing} failing`);
  return result("checks", "fail", "No checks reported");
}

function ago(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) return "just now";
  if (hours < 48) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
