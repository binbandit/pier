// Unified diffs the way GitHub's REST `patch` field shows them: hunks only (no file headers),
// three lines of context, and git's habit of leaving a count of 1 out of hunk headers.
// Also answers the questions GitHub asks of a review comment: is this line part of the diff,
// and which hunk does the thread quote.

export type Patch = { patch: string; additions: number; deletions: number };

type Kind = " " | "-" | "+";
type Op = { kind: Kind; text: string };

const CONTEXT = 3;
// Above this many cells the LCS table gets expensive; such files are diffed as a full rewrite.
const MAX_TABLE = 4_000_000;

export function unifiedDiff(before: string, after: string): Patch {
  const ops = diffOps(lines(before), lines(after));
  const changes = ops.flatMap((op, i) => (op.kind === " " ? [] : [i]));
  const hunks: string[] = [];
  let next = 0;
  while (next < changes.length) {
    const first = changes[next] ?? 0;
    let last = first;
    // Changes closer than two contexts apart share a hunk, as in `git diff`.
    while (next < changes.length && (changes[next] ?? 0) - last <= CONTEXT * 2) {
      last = changes[next] ?? last;
      next++;
    }
    hunks.push(hunk(ops, Math.max(0, first - CONTEXT), Math.min(ops.length, last + CONTEXT + 1)));
  }
  return {
    patch: hunks.join("\n"),
    additions: ops.filter((op) => op.kind === "+").length,
    deletions: ops.filter((op) => op.kind === "-").length,
  };
}

/** Additions and deletions in a patch written by hand (bot PRs build theirs directly). */
export function countPatch(patch: string): Patch {
  const body = patch.split("\n").filter((line) => !line.startsWith("@@"));
  return {
    patch,
    additions: body.filter((line) => line.startsWith("+")).length,
    deletions: body.filter((line) => line.startsWith("-")).length,
  };
}

export type PatchLine = { kind: Kind; oldLine: number | null; newLine: number | null };

/** Every line of a patch with its old- and new-side line numbers, grouped by hunk. */
export function patchHunks(patch: string): { header: string; lines: PatchLine[] }[] {
  const hunks: { header: string; lines: PatchLine[] }[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const text of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      hunks.push({ header: text, lines: [] });
      continue;
    }
    const current = hunks.at(-1);
    const kind = text[0];
    if (!current || (kind !== " " && kind !== "+" && kind !== "-")) continue;
    current.lines.push({
      kind,
      oldLine: kind === "+" ? null : oldLine,
      newLine: kind === "-" ? null : newLine,
    });
    if (kind !== "+") oldLine++;
    if (kind !== "-") newLine++;
  }
  return hunks;
}

/**
 * The hunk a review thread quotes: from the hunk header down to the commented line, or null when
 * the line isn't part of the diff (GitHub rejects those comments).
 */
export function diffHunkAt(patch: string, side: "LEFT" | "RIGHT", line: number): string | null {
  const raw = patch.split("\n");
  let offset = 0;
  for (const { lines: hunkLines } of patchHunks(patch)) {
    const index = hunkLines.findIndex((l) =>
      side === "RIGHT" ? l.newLine === line : l.oldLine === line,
    );
    if (index !== -1) return raw.slice(offset, offset + index + 2).join("\n");
    offset += hunkLines.length + 1;
  }
  return null;
}

// ---------------------------------------------------------------------------

function lines(text: string): string[] {
  return text === "" ? [] : text.replace(/\n$/, "").split("\n");
}

function hunk(ops: Op[], from: number, to: number): string {
  const before = ops.slice(0, from);
  const body = ops.slice(from, to);
  const oldBefore = before.filter((op) => op.kind !== "+").length;
  const newBefore = before.filter((op) => op.kind !== "-").length;
  const oldCount = body.filter((op) => op.kind !== "+").length;
  const newCount = body.filter((op) => op.kind !== "-").length;
  const header = `@@ -${range(oldBefore, oldCount)} +${range(newBefore, newCount)} @@`;
  return [header, ...body.map((op) => `${op.kind}${op.text}`)].join("\n");
}

/** git's hunk range: "5" for one line, "5,3" for several, "4,0" for an insertion after line 4. */
function range(before: number, count: number): string {
  if (count === 1) return `${before + 1}`;
  return `${count === 0 ? before : before + 1},${count}`;
}

function diffOps(a: string[], b: string[]): Op[] {
  // Shared head and tail never need the table, which keeps big, mostly-equal files cheap.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return [
    ...a.slice(0, start).map((text): Op => ({ kind: " ", text })),
    ...middleOps(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map((text): Op => ({ kind: " ", text })),
  ];
}

function middleOps(a: string[], b: string[]): Op[] {
  const removed = a.map((text): Op => ({ kind: "-", text }));
  const added = b.map((text): Op => ({ kind: "+", text }));
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_TABLE)
    return [...removed, ...added];

  // table[i][j] = length of the longest common subsequence of a[i..] and b[j..].
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  const at = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", text: a[i++] ?? "" });
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) ops.push({ kind: "-", text: a[i++] ?? "" });
    else ops.push({ kind: "+", text: b[j++] ?? "" });
  }
  return [...ops, ...removed.slice(i), ...added.slice(j)];
}
