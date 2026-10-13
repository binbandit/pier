// CODEOWNERS, read the way GitHub reads it: one rule per line (a path pattern, then its owners),
// and the last rule that matches a file decides who owns it. A rule with no owners says nobody
// does. Patterns follow .gitignore, minus `!` and `[ ]`, with one difference GitHub documents:
// `docs/*` covers the files directly in docs/, not ones in folders below it.

export type CodeOwnerRule = { pattern: string; owners: string[] };

export function parseCodeOwners(text: string): CodeOwnerRule[] {
  const rules: CodeOwnerRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // `#` starts a comment unless it's escaped.
    const line = raw.replace(/(^|[^\\])#.*$/, "$1").trim();
    if (!line) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    if (!pattern || pattern.startsWith("!") || pattern.includes("[")) continue;
    rules.push({ pattern: pattern.replaceAll("\\#", "#"), owners });
  }
  return rules;
}

/** Matches paths against a file's rules; build one per CODEOWNERS and reuse it. */
export function codeOwnersMatcher(rules: CodeOwnerRule[]): (path: string) => string[] {
  const compiled = rules.map((rule) => ({ test: toRegExp(rule.pattern), owners: rule.owners }));
  return (path) => {
    for (let i = compiled.length - 1; i >= 0; i--) {
      const rule = compiled[i];
      if (rule?.test.test(path)) return rule.owners;
    }
    return [];
  };
}

function toRegExp(pattern: string): RegExp {
  const directory = pattern.endsWith("/");
  const trimmed = pattern.replace(/^\//, "").replace(/\/$/, "");
  // A slash anywhere but the end ties the pattern to the repo root; otherwise it matches a name
  // at any depth.
  const anchored = pattern.startsWith("/") || trimmed.includes("/");
  const body = trimmed
    .split("/")
    .map((segment) =>
      segment === "**"
        ? "**"
        : segment
            .replace(/[.+^${}()|\\]/g, "\\$&")
            .replace(/\*+/g, (stars) => (stars.length > 1 ? ".*" : "[^/]*"))
            .replaceAll("?", "[^/]"),
    )
    .reduce((out, segment, i, all) => {
      if (segment !== "**") return out + (i > 0 && all[i - 1] !== "**" ? "/" : "") + segment;
      // `**` alone spans any number of folders, including none.
      return out + (i === 0 ? "(?:.*/)?" : i === all.length - 1 ? "/.*" : "/(?:.*/)?");
    }, "");
  // A pattern names a file, or a folder and everything in it; a trailing slash only a folder,
  // and a final `*` only what's directly there.
  const tail = trimmed.endsWith("/*") || trimmed === "*" ? "" : directory ? "/.*" : "(?:/.*)?";
  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${body}${tail}$`);
}
