// The search language: GitHub's PR search syntax, plus pier's own qualifiers. Words match the
// title, description, repo, number, branch and author; `key:value` narrows by a qualifier; a
// leading `-` negates either; `label:a,b` means either; quotes keep spaces in a value. Ranges
// take `>`, `>=`, `<`, `<=` or `a..b`, and dates may be relative (`7d`, `12h`).

export const QUALIFIERS = {
  is: "open, closed, merged, unmerged, draft",
  state: "open or closed",
  draft: "true or false",
  author: "a login, @me, or app/dependabot",
  assignee: "a login or @me",
  label: "a label name",
  milestone: "a milestone title",
  no: "label, milestone, assignee or reviewer",
  repo: "owner/name",
  org: "an owner",
  user: "an owner",
  base: "the base branch",
  head: "the head branch",
  review: "none, required, approved or changes_requested",
  "review-requested": "a login, @me, or org/team",
  "reviewed-by": "a login or @me",
  involves: "a login or @me",
  status: "success, failure or pending",
  created: "a date or range",
  updated: "a date or range",
  sort: "updated, created, or either with -asc",
  in: "title or body",
  // pier's own
  turn: "me: waiting on you",
  checks: "success, failure, pending or none",
  size: "xs, s, m, l, xl, or a range of changed lines",
  acct: "which of your accounts reads it",
  bot: "true, dependabot or renovate",
  semver: "major, minor or patch (bump PRs)",
  cohort: "clear, look or stuck (bump PRs)",
} as const;

export type QualifierKey = keyof typeof QUALIFIERS;

export type Term =
  | { kind: "text"; text: string; negated: boolean }
  | { kind: "qualifier"; key: QualifierKey; values: string[]; negated: boolean };

export type Sort = { field: "updated" | "created"; direction: "asc" | "desc" };

export type Query = { terms: Term[]; sort: Sort; errors: string[] };

export function parseQuery(input: string): Query {
  const terms: Term[] = [];
  const errors: string[] = [];
  let sort: Sort = { field: "updated", direction: "desc" };
  for (const token of tokens(input)) {
    const negated = token.startsWith("-") && token.length > 1;
    const body = negated ? token.slice(1) : token;
    const colon = /^([a-z-]+):(.*)$/s.exec(body);
    if (!colon) {
      terms.push({ kind: "text", text: unquote(body).toLowerCase(), negated });
      continue;
    }
    const [, key = "", raw = ""] = colon;
    if (!isQualifier(key)) {
      errors.push(`pier doesn't know "${key}:"`);
      continue;
    }
    const value = unquote(raw);
    if (!value) {
      errors.push(`"${key}:" needs a value`);
      continue;
    }
    if (key === "sort") {
      const [field = "", direction = "desc"] = value.split("-");
      if (
        (field === "updated" || field === "created") &&
        (direction === "asc" || direction === "desc")
      )
        sort = { field, direction };
      else errors.push(`sort by updated or created, optionally with -asc`);
      continue;
    }
    terms.push({ kind: "qualifier", key, values: value.split(","), negated });
  }
  return { terms, sort, errors };
}

function isQualifier(key: string): key is QualifierKey {
  return Object.hasOwn(QUALIFIERS, key);
}

/** Splits on spaces outside quotes; `label:"needs review"` stays one token. */
function tokens(input: string): string[] {
  return input.match(/(?:[^\s"]+|"[^"]*"?)+/g) ?? [];
}

function unquote(value: string): string {
  return value.replace(/"/g, "");
}

export type Range = { min: number; max: number };

/**
 * A number or date range: `>5`, `<=10`, `3..8`, `2026-01-01..2026-02-01`. `parse` reads one end
 * as the span it covers (a whole day for a date, one value for a number), so `>2026-01-01` starts
 * the next day and `..2026-01-31` runs to that day's end, as on GitHub. A relative date is a
 * moment: `updated:>7d` is "after seven days ago", the last week. Null when an end isn't one.
 */
export function parseRange(value: string, parse: (end: string) => Range | null): Range | null {
  const between = /^(.+)\.\.(.+)$/.exec(value);
  if (between) {
    const from = between[1] === "*" ? { min: -Infinity, max: -Infinity } : parse(between[1] ?? "");
    const to = between[2] === "*" ? { min: Infinity, max: Infinity } : parse(between[2] ?? "");
    return from === null || to === null ? null : { min: from.min, max: to.max };
  }
  const compare = /^(>=|<=|>|<)?(.+)$/.exec(value);
  const at = parse(compare?.[2] ?? "");
  if (at === null) return null;
  switch (compare?.[1]) {
    case ">":
      return { min: at.max + 1, max: Infinity };
    case ">=":
      return { min: at.min, max: Infinity };
    case "<":
      return { min: -Infinity, max: at.min - 1 };
    case "<=":
      return { min: -Infinity, max: at.max };
    default:
      return at;
  }
}

/** pier's own qualifiers, which GitHub's search doesn't have. */
const PIER_ONLY = new Set<QualifierKey>(["turn", "size", "acct", "bot", "semver", "cohort"]);
/** `no:` values GitHub knows. */
const GITHUB_NO = new Set(["label", "milestone", "assignee", "project"]);

/**
 * The same search for GitHub's advanced search: pier's own qualifiers (and values GitHub lacks)
 * left out and named so the app can say so, `checks:` asked as `status:`, relative dates made
 * absolute, and `key:a,b` (which GitHub only reads for labels) spelled `(key:a OR key:b)`.
 */
export function toGitHubQuery(query: Query, now: number): { text: string; dropped: string[] } {
  const dropped: string[] = [];
  const parts = ["is:pr"];
  for (const term of query.terms) {
    const sign = term.negated ? "-" : "";
    if (term.kind === "text") {
      parts.push(sign + (/\s/.test(term.text) ? `"${term.text}"` : term.text));
      continue;
    }
    if (PIER_ONLY.has(term.key)) {
      dropped.push(`${term.key}:`);
      continue;
    }
    const key = term.key === "checks" ? "status" : term.key;
    const values = term.values
      .filter((v) => {
        const known =
          (term.key !== "checks" || v !== "none") && (term.key !== "no" || GITHUB_NO.has(v));
        if (!known) dropped.push(`${term.key}:${v}`);
        return known;
      })
      .map((v) => (key === "created" || key === "updated" ? absoluteDates(v, now) : v))
      .map((v) => (/\s/.test(v) ? `"${v}"` : v));
    if (values.length === 0) continue;
    if (key === "label" || values.length === 1) parts.push(`${sign}${key}:${values.join(",")}`);
    // Not any of them is none of them; any of them is an OR.
    else if (term.negated) parts.push(...values.map((v) => `-${key}:${v}`));
    else parts.push(`(${values.map((v) => `${key}:${v}`).join(" OR ")})`);
  }
  parts.push(`sort:${query.sort.field}-${query.sort.direction}`);
  return { text: parts.join(" "), dropped: [...new Set(dropped)] };
}

/** `>7d` → `>2026-10-06T12:00:00+00:00`: GitHub only reads dates and times. */
function absoluteDates(value: string, now: number): string {
  return value.replace(/(\d+)([dhw])(?![\w-])/g, (_, count: string, unit: string) => {
    const hours = unit === "h" ? 1 : unit === "w" ? 168 : 24;
    const at = new Date(now - Number(count) * hours * 3_600_000);
    return `${at.toISOString().slice(0, 19)}+00:00`;
  });
}
