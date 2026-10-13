import type { FakePr, FakeWorld } from "./world";

// GitHub's issue search, as far as pier uses it: qualifiers, `-` negation, parenthesised OR
// groups and free text. Anything it doesn't understand throws, so a new query pier starts
// sending fails loudly here instead of silently matching nothing.

export type Matcher = (pr: FakePr) => boolean;

type Token = { kind: "word" | "open" | "close" | "or"; text: string };

export function compileQuery(query: string, me: string, world: FakeWorld): Matcher {
  const tokens = tokenize(query);
  let index = 0;

  const orExpr = (): Matcher => {
    const parts = [andExpr()];
    while (tokens[index]?.kind === "or") {
      index++;
      parts.push(andExpr());
    }
    return parts.length === 1 ? (parts[0] ?? always) : (pr) => parts.some((part) => part(pr));
  };
  const andExpr = (): Matcher => {
    const parts: Matcher[] = [];
    for (let token = tokens[index]; token && token.kind !== "or"; token = tokens[index]) {
      if (token.kind === "close") break;
      index++;
      if (token.kind === "open") {
        parts.push(orExpr());
        if (tokens[index]?.kind !== "close") throw new Error(`unbalanced parentheses in: ${query}`);
        index++;
      } else parts.push(term(token.text, me, world));
    }
    return (pr) => parts.every((part) => part(pr));
  };

  const matcher = orExpr();
  if (index < tokens.length) throw new Error(`unbalanced parentheses in: ${query}`);
  return matcher;
}

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  for (const match of query.matchAll(/\(|\)|[^\s()"]*"[^"]*"|[^\s()]+/g)) {
    const text = match[0];
    if (text === "(") tokens.push({ kind: "open", text });
    else if (text === ")") tokens.push({ kind: "close", text });
    else if (text === "OR") tokens.push({ kind: "or", text });
    else if (text !== "AND") tokens.push({ kind: "word", text });
  }
  return tokens;
}

const always: Matcher = () => true;

function term(text: string, me: string, world: FakeWorld): Matcher {
  const negated = text.startsWith("-") && text.length > 1;
  const raw = negated ? text.slice(1) : text;
  const colon = raw.indexOf(":");
  const matcher =
    colon === -1
      ? freeText(raw)
      : qualifier(raw.slice(0, colon).toLowerCase(), unquote(raw.slice(colon + 1)), me, world);
  return negated ? (pr) => !matcher(pr) : matcher;
}

function qualifier(key: string, value: string, me: string, world: FakeWorld): Matcher {
  const lower = value.toLowerCase();
  // Logins are case-insensitive; resolve to the stored spelling once.
  const wanted = value === "@me" ? me : normalize(value);
  const login = [...world.users.keys()].find((l) => l.toLowerCase() === wanted.toLowerCase());
  const who = login ?? wanted;
  switch (key) {
    case "is":
      return isQualifier(lower);
    case "state":
      return (pr) => (lower === "open" ? pr.state === "OPEN" : pr.state !== "OPEN");
    case "archived":
      return (pr) => pr.repo.archived === (lower === "true");
    case "draft":
      return (pr) => pr.isDraft === (lower === "true");
    case "user":
    case "org":
    case "owner":
      return (pr) => pr.repo.owner.toLowerCase() === lower;
    case "repo":
      return (pr) => pr.repo.fullName.toLowerCase() === lower;
    case "author":
      return (pr) => normalize(pr.author) === normalize(who);
    case "involves":
      return (pr) => world.involves(pr, who);
    case "mentions":
      return (pr) => pr.mentions.has(who);
    case "commenter":
      return (pr) =>
        pr.comments.some((c) => c.author === who) ||
        pr.threads.some((t) => t.comments.some((c) => c.author === who));
    case "review-requested":
      return (pr) => world.reviewRequested(pr, who);
    case "user-review-requested":
      return (pr) => pr.requested.has(who);
    case "team-review-requested":
      return (pr) => [...pr.requested].some((r) => r.toLowerCase() === lower);
    case "reviewed-by":
      return (pr) => world.reviewedBy(pr, who);
    case "label":
      return (pr) => pr.labels.some((l) => l.name.toLowerCase() === lower);
    case "base":
      return (pr) => pr.baseRefName === value;
    case "head":
      return (pr) => pr.headRefName === value;
    case "review":
      return reviewQualifier(lower, world);
    case "status":
      return (pr) => world.rollup(pr) === lower;
    case "updated":
      return datePredicate(value, (pr) => pr.updatedAt);
    case "created":
      return datePredicate(value, (pr) => pr.createdAt);
    case "sort":
    case "in":
      return always;
    default:
      throw new Error(`fake search doesn't understand "${key}:${value}"`);
  }
}

function isQualifier(value: string): Matcher {
  switch (value) {
    case "pr":
      return always;
    case "issue":
      return () => false;
    case "open":
      return (pr) => pr.state === "OPEN";
    case "closed":
      return (pr) => pr.state !== "OPEN";
    case "merged":
      return (pr) => pr.state === "MERGED";
    case "unmerged":
      return (pr) => pr.state !== "MERGED";
    case "draft":
      return (pr) => pr.isDraft;
    case "public":
      return (pr) => !pr.repo.isPrivate;
    case "private":
      return (pr) => pr.repo.isPrivate;
    default:
      throw new Error(`fake search doesn't understand "is:${value}"`);
  }
}

function reviewQualifier(value: string, world: FakeWorld): Matcher {
  switch (value) {
    case "none":
      return (pr) => !pr.reviews.some((r) => r.state !== "PENDING");
    case "required":
      return (pr) => world.reviewDecision(pr) === "review_required";
    case "approved":
      return (pr) => world.reviewDecision(pr) === "approved";
    case "changes_requested":
      return (pr) => world.reviewDecision(pr) === "changes_requested";
    default:
      throw new Error(`fake search doesn't understand "review:${value}"`);
  }
}

const DAY_MS = 86_400_000;

/**
 * `>=2026-10-01`, `<2026-10-01T12:00:00Z`, `2026-09-01..2026-10-01`, `2026-10-01..*`, or a bare
 * date. Date-only bounds cover their whole UTC day, as on GitHub.
 */
function datePredicate(value: string, field: (pr: FakePr) => string): Matcher {
  const range = rangeOf(value);
  return (pr) => {
    const at = Date.parse(field(pr));
    return at >= range.from && at < range.to;
  };
}

function rangeOf(value: string): { from: number; to: number } {
  const op = /^(>=|<=|>|<)(.+)$/.exec(value);
  if (op?.[1] && op[2]) {
    const bound = parseBound(op[2]);
    switch (op[1]) {
      case ">=":
        return { from: bound.start, to: Infinity };
      case ">":
        return { from: bound.end, to: Infinity };
      case "<=":
        return { from: -Infinity, to: bound.end };
      default:
        return { from: -Infinity, to: bound.start };
    }
  }
  const [from = "*", to] = value.split("..");
  if (to === undefined) {
    const bound = parseBound(from);
    return { from: bound.start, to: bound.end };
  }
  return {
    from: from === "*" ? -Infinity : parseBound(from).start,
    to: to === "*" ? Infinity : parseBound(to).end,
  };
}

/** A date covers its day; an instant is a single point (`end` is just past it). */
function parseBound(text: string): { start: number; end: number } {
  const start = Date.parse(text);
  if (Number.isNaN(start)) throw new Error(`fake search can't read the date "${text}"`);
  return { start, end: /T/.test(text) ? start + 1 : start + DAY_MS };
}

function freeText(word: string): Matcher {
  const needle = unquote(word).toLowerCase();
  return (pr) => pr.title.toLowerCase().includes(needle) || pr.body.toLowerCase().includes(needle);
}

/** `app/dependabot`, `dependabot[bot]` and `dependabot` all name the same author. */
function normalize(login: string): string {
  return login
    .toLowerCase()
    .replace(/^app\//, "")
    .replace(/\[bot\]$/, "");
}

function unquote(text: string): string {
  return text.replace(/^"|"$/g, "");
}
