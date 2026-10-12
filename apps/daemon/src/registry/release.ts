import type { Database } from "bun:sqlite";

import { type } from "arktype";

import type { Ecosystem, ReleaseInfo } from "@pier/core/wire";

// Facts about the version a bump moves to: when it was published (supply-chain cooling-off),
// known advisories against it, and whether it adds an npm install script.
// Sources: deps.dev (most ecosystems), the npm registry (install scripts), GitHub releases (actions).

const DEPS_DEV_SYSTEMS: Partial<Record<Ecosystem, string>> = {
  npm: "npm",
  gomod: "go",
  cargo: "cargo",
  pip: "pypi",
  maven: "maven",
  nuget: "nuget",
  bundler: "rubygems",
};

/** Release dates never change; advisories can appear later, so lookups refresh daily. */
const TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;

const depsDevVersion = type({
  "publishedAt?": "string",
  "advisoryKeys?": type({ id: "string" }).array(),
  "links?": type({ label: "string", url: "string" }).array(),
});

const npmVersion = type({ "scripts?": "Record<string, string>" });

export type ReleaseLookup = {
  ecosystem: Ecosystem;
  pkg: string;
  from: string | null;
  to: string;
};

export type GitHubReleaseDate = (repo: string, tag: string) => Promise<string | null>;

export class ReleaseRegistry {
  private inFlight = new Map<string, Promise<ReleaseInfo | null>>();
  version = 0;

  constructor(
    private readonly cache: Database,
    private readonly githubReleaseDate: GitHubReleaseDate,
    private readonly privateScopes: () => string[],
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /** Cached info, or null if it hasn't been looked up yet (call `lookup` to fill it). */
  cached(bump: ReleaseLookup): ReleaseInfo | null {
    const row = this.cache
      .query<{ json: string }, [string]>("SELECT json FROM registry WHERE key = ?")
      .get(key(bump));
    const info = row ? (JSON.parse(row.json) as ReleaseInfo | null) : null;
    return info && withAge(info);
  }

  isStale(bump: ReleaseLookup): boolean {
    const row = this.cache
      .query<{ fetched_at: string; json: string }, [string]>(
        "SELECT fetched_at, json FROM registry WHERE key = ?",
      )
      .get(key(bump));
    if (!row) return true;
    // Misses are retried sooner: the package may be published yet, or a lookup bug may be fixed.
    const ttl = row.json === "null" ? MISS_TTL_MS : TTL_MS;
    return Date.now() - Date.parse(row.fetched_at) > ttl;
  }

  lookup(bump: ReleaseLookup): Promise<ReleaseInfo | null> {
    const k = key(bump);
    const existing = this.inFlight.get(k);
    if (existing) return existing;
    const pending = this.fetchInfo(bump)
      .then((info) => {
        // Misses are cached too (as JSON null), so unsupported packages aren't re-asked every tick.
        this.cache
          .query(
            `INSERT INTO registry (key, json, fetched_at) VALUES (?, ?, ?)
             ON CONFLICT (key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at`,
          )
          .run(k, JSON.stringify(info), new Date().toISOString());
        this.version++;
        return info && withAge(info);
      })
      .finally(() => this.inFlight.delete(k));
    this.inFlight.set(k, pending);
    return pending;
  }

  private async fetchInfo(bump: ReleaseLookup): Promise<ReleaseInfo | null> {
    if (bump.ecosystem === "npm" && this.isPrivate(bump.pkg)) return null;
    if (bump.ecosystem === "github-actions") return this.fromGitHub(bump);
    const system = DEPS_DEV_SYSTEMS[bump.ecosystem];
    if (!system) return null;

    const version =
      bump.ecosystem === "gomod" && !bump.to.startsWith("v") ? `v${bump.to}` : bump.to;
    const url = `https://api.deps.dev/v3/systems/${system}/packages/${encodeURIComponent(bump.pkg)}/versions/${encodeURIComponent(version)}`;
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const parsed = depsDevVersion(await response.json());
    if (parsed instanceof type.errors) return null;

    return {
      publishedAt: parsed.publishedAt ?? null,
      ageDays: null,
      advisories: (parsed.advisoryKeys ?? []).map((advisory) => advisory.id),
      hasNewInstallScript: bump.ecosystem === "npm" ? await this.newInstallScript(bump) : null,
      links: (parsed.links ?? []).filter((link) => /SOURCE_REPO|HOMEPAGE|ORIGIN/i.test(link.label)),
    };
  }

  /** Whether the target version runs an install-time script that the old version didn't. */
  private async newInstallScript(bump: ReleaseLookup): Promise<boolean | null> {
    const scripts = async (version: string) => {
      const name = bump.pkg.replace("/", "%2f");
      const response = await this.fetcher(
        `https://registry.npmjs.org/${name}/${encodeURIComponent(version)}`,
        {
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok) return null;
      const parsed = npmVersion(await response.json());
      if (parsed instanceof type.errors) return null;
      const s = parsed.scripts ?? {};
      return Boolean(s.preinstall || s.install || s.postinstall);
    };
    const to = await scripts(bump.to);
    if (to === null) return null;
    if (!to) return false;
    const from = bump.from ? await scripts(bump.from) : null;
    return from === null ? true : !from;
  }

  private async fromGitHub(bump: ReleaseLookup): Promise<ReleaseInfo | null> {
    // SHA-pinned actions have no release to date.
    if (/^[0-9a-f]{40}$/.test(bump.to)) return null;
    const repo = bump.pkg.split("/").slice(0, 2).join("/");
    const tags = bump.to.startsWith("v") ? [bump.to] : [`v${bump.to}`, bump.to];
    for (const tag of tags) {
      const publishedAt = await this.githubReleaseDate(repo, tag);
      if (publishedAt) {
        return {
          publishedAt,
          ageDays: null,
          advisories: [],
          hasNewInstallScript: null,
          links: [{ label: "Release", url: `https://github.com/${repo}/releases/tag/${tag}` }],
        };
      }
    }
    return null;
  }

  private isPrivate(pkg: string): boolean {
    return this.privateScopes().some((scope) => pkg.startsWith(`${scope}/`));
  }
}

function key(bump: ReleaseLookup): string {
  return `${bump.ecosystem}:${bump.pkg}@${bump.to}<-${bump.from ?? ""}`;
}

function withAge(info: ReleaseInfo): ReleaseInfo {
  if (!info.publishedAt) return info;
  return { ...info, ageDays: (Date.now() - Date.parse(info.publishedAt)) / 86_400_000 };
}
