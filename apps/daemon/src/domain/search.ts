import { type Query, type Range, type Term, parseRange } from "@pier/core/query";
import type { Cohort } from "@pier/core/wire";

import type { PrRecord } from "./model";

// Searching the replica: every PR pier tracks, open or recently closed, matched in memory, so
// results come back as you type and work offline. Qualifiers mean what they mean on GitHub.

export type SearchContext = {
  /** Your logins; `@me` is any of them. */
  you: string[];
  /** Your teams ("org/slug"); a request to one of them is a request to you. */
  teams: string[];
  /** PRs where it's your turn (Review and Mine). */
  turn: ReadonlySet<string>;
  /** Bump PRs' semver classes and cohort. */
  bots: ReadonlyMap<string, { semvers: string[]; cohort: Cohort }>;
  now: number;
};

const DAY_MS = 86_400_000;
const SIZES: Record<string, [number, number]> = {
  xs: [0, 9],
  s: [10, 49],
  m: [50, 249],
  l: [250, 999],
  xl: [1000, Infinity],
};

export function searchRecords(records: PrRecord[], query: Query, ctx: SearchContext): PrRecord[] {
  // `in:title` / `in:body` narrow where words are looked for.
  const scope = query.terms.flatMap((t) =>
    t.kind === "qualifier" && t.key === "in" ? t.values : [],
  );
  const field = query.sort.field === "created" ? "createdAt" : "updatedAt";
  const sign = query.sort.direction === "asc" ? 1 : -1;
  return records
    .filter((record) =>
      query.terms.every((term) => matchesTerm(term, record, ctx, scope) !== term.negated),
    )
    .toSorted((a, b) => sign * a.doc[field].localeCompare(b.doc[field]));
}

function matchesTerm(term: Term, record: PrRecord, ctx: SearchContext, scope: string[]): boolean {
  const { doc } = record;
  if (term.kind === "text") return haystack(record, scope).includes(term.text);
  const any = (test: (value: string) => boolean) => term.values.some((v) => test(v.toLowerCase()));
  const person = (value: string) => (value === "@me" ? ctx.you.map(lower) : [bare(value)]);
  const isPerson = (login: string | null | undefined, value: string) =>
    login !== null && login !== undefined && person(value).includes(bare(login));

  switch (term.key) {
    case "is":
    case "state":
      return any((v) => {
        if (v === "open") return doc.state === "OPEN";
        if (v === "closed") return doc.state !== "OPEN";
        if (v === "merged") return doc.state === "MERGED";
        if (v === "unmerged") return doc.state !== "MERGED";
        if (v === "draft") return doc.isDraft;
        return v === "pr";
      });
    case "draft":
      return any((v) => doc.isDraft === (v === "true"));
    case "author":
      return any((v) => isPerson(doc.author?.login, v));
    case "assignee":
      return any((v) => doc.assignees.some((a) => isPerson(a.login, v)));
    case "label":
      return any((v) => doc.labels.some((l) => lower(l.name) === v));
    case "milestone":
      return any((v) => lower(doc.milestone?.title ?? "") === v);
    case "no":
      return any((v) => {
        if (v === "label") return doc.labels.length === 0;
        if (v === "milestone") return doc.milestone === null;
        if (v === "assignee") return doc.assignees.length === 0;
        return v === "reviewer" && doc.reviewRequests.length + doc.latestReviews.length === 0;
      });
    case "repo":
      return any((v) => lower(doc.repo) === v);
    case "org":
    case "user":
      return any((v) => lower(doc.repo.split("/")[0] ?? "") === v);
    case "base":
      return any((v) => lower(doc.baseRefName) === v);
    case "head":
      return any((v) => lower(doc.headRefName) === v);
    case "review":
      return any((v) => {
        if (v === "none") return doc.latestReviews.length === 0;
        if (v === "required") return doc.reviewDecision === "review_required";
        return doc.reviewDecision === v;
      });
    case "review-requested":
      return any((v) =>
        doc.reviewRequests.some((r) =>
          r.kind === "team"
            ? lower(r.login) === v ||
              (v === "@me" && ctx.teams.some((t) => lower(t) === lower(r.login)))
            : isPerson(r.login, v),
        ),
      );
    case "reviewed-by":
      return any((v) => doc.latestReviews.some((r) => isPerson(r.author, v)));
    case "involves":
      return any(
        (v) =>
          isPerson(doc.author?.login, v) ||
          doc.assignees.some((a) => isPerson(a.login, v)) ||
          doc.reviewRequests.some((r) => isPerson(r.login, v)) ||
          doc.latestReviews.some((r) => isPerson(r.author, v)),
      );
    case "status":
    case "checks":
      return any((v) => doc.checks.state === v);
    case "created":
    case "updated": {
      const at = Date.parse(term.key === "created" ? doc.createdAt : doc.updatedAt);
      return any((v) => {
        const range = dateRange(v, ctx.now);
        return range !== null && at >= range.min && at <= range.max;
      });
    }
    case "in":
      return true;
    case "turn":
      return any((v) => v === "me" && ctx.turn.has(doc.id));
    case "size": {
      const lines = doc.additions + doc.deletions;
      return any((v) => {
        const named = SIZES[v];
        const range = named ? { min: named[0], max: named[1] } : parseRange(v, numberOf);
        return range !== null && lines >= range.min && lines <= range.max;
      });
    }
    case "acct":
      return any((v) => lower(record.reader) === bare(v));
    case "bot":
      return any((v) => (v === "true" ? record.bot !== null : record.bot?.bot === v));
    case "semver":
      return any((v) => ctx.bots.get(doc.id)?.semvers.includes(v) ?? false);
    case "cohort":
      return any((v) => ctx.bots.get(doc.id)?.cohort === v);
    case "sort":
      return true;
    default: {
      // Every qualifier is handled above; a new one fails to compile here.
      const unhandled: never = term.key;
      return unhandled;
    }
  }
}

/** A date (a whole day), date-time or relative age (`7d`, `12h`, `2w`: a moment) as a range. */
function dateRange(value: string, now: number): Range | null {
  return parseRange(value, (end) => {
    const relative = /^(\d+)([dhw])$/.exec(end);
    if (relative) {
      const unit = relative[2] === "h" ? DAY_MS / 24 : relative[2] === "w" ? 7 * DAY_MS : DAY_MS;
      const at = now - Number(relative[1]) * unit;
      return { min: at, max: at };
    }
    const at = Date.parse(end);
    if (Number.isNaN(at)) return null;
    return /^\d{4}-\d\d-\d\d$/.test(end) ? { min: at, max: at + DAY_MS - 1 } : { min: at, max: at };
  });
}

function numberOf(end: string): Range | null {
  const n = Number(end);
  return Number.isFinite(n) ? { min: n, max: n } : null;
}

/** Logins compare without case, a leading @, `app/` or a `[bot]` suffix. */
function bare(login: string): string {
  return lower(login)
    .replace(/^@/, "")
    .replace(/^app\//, "")
    .replace(/\[bot\]$/, "");
}

function lower(value: string): string {
  return value.toLowerCase();
}

const haystacks = new WeakMap<PrRecord["doc"], { all: string; title: string; body: string }>();

function haystack(record: PrRecord, scope: string[]): string {
  const { doc } = record;
  let cached = haystacks.get(doc);
  if (!cached) {
    const title = lower(doc.title);
    const body = lower(doc.body);
    cached = {
      title,
      body,
      all: [
        title,
        body,
        lower(doc.repo),
        `#${doc.number}`,
        lower(doc.headRefName),
        lower(doc.author?.login ?? ""),
      ].join("\n"),
    };
    haystacks.set(doc, cached);
  }
  if (scope.length === 0) return cached.all;
  return [
    scope.includes("title") ? cached.title : "",
    scope.includes("body") ? cached.body : "",
  ].join("\n");
}
