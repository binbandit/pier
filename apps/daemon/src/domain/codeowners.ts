import type { GitHubPort } from "@/github/port";
import { parseCodeOwners } from "@pier/core/codeowners";
import type { CodeOwners } from "@pier/core/wire";

// Who owns what in a PR: its base branch's CODEOWNERS rules, and the owner names that mean you
// (your login and your teams). Both change rarely, so each is read once and kept a while; a
// failed read keeps serving what we had rather than holding up the PR.

const RULES_TTL_MS = 10 * 60_000;
const TEAMS_TTL_MS = 60 * 60_000;

type Cached<T> = { value: T; at: number };

export class CodeOwnersCache {
  private readonly rules = new Map<string, Cached<CodeOwners["rules"] | null>>();
  private readonly teams = new Map<string, Cached<string[]>>();

  constructor(private readonly ports: Map<string, GitHubPort>) {}

  async forPr(repo: string, base: string, account: string): Promise<CodeOwners | null> {
    const port = this.ports.get(account);
    if (!port) return null;
    const [rules, teams] = await Promise.all([
      this.read(this.rules, `${repo}@${base}`, RULES_TTL_MS, null, async () => {
        const text = await port.codeOwners(repo, base);
        return text === null ? null : parseCodeOwners(text);
      }),
      this.read(this.teams, account, TEAMS_TTL_MS, [], () => port.teams()),
    ]);
    if (!rules) return null;
    return { rules, you: [`@${account}`, ...teams.map((team) => `@${team}`)] };
  }

  private async read<T>(
    cache: Map<string, Cached<T>>,
    key: string,
    ttl: number,
    fallback: T,
    load: () => Promise<T>,
  ): Promise<T> {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < ttl) return cached.value;
    try {
      const value = await load();
      cache.set(key, { value, at: Date.now() });
      return value;
    } catch (error) {
      console.warn(`codeowners ${key}: ${String(error)}`);
      // Asked again in a minute, not on every look at the PR.
      const value = cached?.value ?? fallback;
      cache.set(key, { value, at: Date.now() - ttl + 60_000 });
      return value;
    }
  }
}
