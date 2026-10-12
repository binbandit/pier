import type { DiffFile } from "@pier/core/wire";

// `git diff` output into the same DiffFile shape GitHub's REST `diff-entry` gives, so the web app
// renders both alike. Paths come from the most specific header available: `rename from/to`, then
// `---`/`+++`, and only for header-only entries (binary, empty, mode-only) the `diff --git` line,
// whose two names are always identical in those cases.

type Section = { names: string; meta: string[]; hunks: string[] };

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  "\\": 92,
};

export function parseDiff(output: string): DiffFile[] {
  const sections: Section[] = [];
  const text = output.endsWith("\n") ? output.slice(0, -1) : output;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      sections.push({ names: line.slice("diff --git ".length), meta: [], hunks: [] });
      continue;
    }
    const section = sections.at(-1);
    if (!section) continue;
    // Hunk lines always start with " ", "+", "-", "\" or "@@", so none can pass for a header;
    // everything from the first "@@" to the next `diff --git` is patch.
    if (section.hunks.length > 0 || line.startsWith("@@")) section.hunks.push(line);
    else section.meta.push(line);
  }
  return sections.map(toFile);
}

function toFile({ names, meta, hunks }: Section): DiffFile {
  const name = (prefix: string) => {
    const line = meta.find((candidate) => candidate.startsWith(prefix));
    if (line === undefined) return null;
    // `---`/`+++` names gain a trailing tab when they contain a space; real tabs are always quoted.
    const value = line.slice(prefix.length).replace(/\t$/, "");
    return value.startsWith('"') ? unquote(value) : value;
  };
  const side = (prefix: "--- " | "+++ ") => {
    const value = name(prefix);
    return value === null || value === "/dev/null" ? null : value.slice("a/".length);
  };
  const renameFrom = name("rename from ");
  return {
    path: name("rename to ") ?? side("+++ ") ?? side("--- ") ?? headerPath(names),
    previousPath: renameFrom,
    status: statusOf(meta, renameFrom !== null),
    additions: hunks.filter((line) => line.startsWith("+")).length,
    deletions: hunks.filter((line) => line.startsWith("-")).length,
    // Empty, not null, for entries without line changes (pure renames, mode changes, empty files).
    patch: meta.some((line) => line.startsWith("Binary files ")) ? null : hunks.join("\n"),
  };
}

function statusOf(meta: string[], renamed: boolean): DiffFile["status"] {
  if (meta.some((line) => line.startsWith("new file mode "))) return "added";
  if (meta.some((line) => line.startsWith("deleted file mode "))) return "removed";
  return renamed ? "renamed" : "modified";
}

/** The path from `a/<path> b/<path>`, for entries where both sides name the same file. */
function headerPath(names: string): string {
  const quoted = /^"(?:[^"\\]|\\.)*"/.exec(names);
  if (quoted) return unquote(quoted[0]).slice("a/".length);
  return names.slice("a/".length, "a/".length + (names.length - "a/ b/".length) / 2);
}

/** Reverses git's C-style quoting, where octal escapes are raw bytes of UTF-8 text. */
function unquote(quoted: string): string {
  const bytes: number[] = [];
  for (const [, literal, escape = ""] of quoted
    .slice(1, -1)
    .matchAll(/([^\\]+)|\\([0-7]{3}|.)/gs)) {
    if (literal !== undefined) bytes.push(...encoder.encode(literal));
    else if (/^[0-7]{3}$/.test(escape)) bytes.push(Number.parseInt(escape, 8));
    else bytes.push(ESCAPES[escape] ?? escape.charCodeAt(0));
  }
  return decoder.decode(Uint8Array.from(bytes));
}
