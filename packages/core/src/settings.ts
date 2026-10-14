import { type } from "arktype";

// What you can change about pier, shared by the daemon (which stores it) and the settings screen
// (which edits it), so both validate against one definition.

/** One search pier runs to find PRs, as one account. */
export const scopeSchema = type({
  id: "string",
  account: "string",
  query: "string",
  kind: "'personal' | 'bots'",
});

const botPolicy = type({
  /** Commit author names (or logins) allowed on a bot branch. */
  authors: "string[]",
  requireSigned: "boolean",
  /** Allow "Merge branch 'main' into …" commits that only bring in the base. */
  allowBaseMerges: "boolean",
});

/** What a dependency bump must pass to be Clear. */
export const depsPolicySchema = type({
  minReleaseAgeDays: "number >= 0",
  allowedSemver: "('major' | 'minor' | 'patch')[]",
  /** Brayden's repos merge on approval, so approving is useful even where rules don't require it. */
  approveWhenNotRequired: "boolean",
  staleAfterDays: "number > 0",
  verdictTtlDays: "number > 0",
  /** npm scopes (e.g. "@acme") that must never be looked up in public registries. */
  privateScopes: "string[]",
  bots: { dependabot: botPolicy, renovate: botPolicy },
});

export type Scope = typeof scopeSchema.infer;
export type DepsPolicy = typeof depsPolicySchema.infer;

/** The search for PRs you're part of, each account's out of the box. */
export const PERSONAL_QUERY =
  "is:pr is:open archived:false (involves:@me OR review-requested:@me OR reviewed-by:@me)";

/** Dependabot and Renovate PRs in one owner's repos (`user:` matches organisations too). */
export function botsQuery(owner: string): string {
  return `is:pr is:open archived:false (author:app/dependabot OR author:app/renovate) user:${owner}`;
}
