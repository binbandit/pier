import type { DiffFile } from "@pier/core/wire";

// Reads a unified-diff patch into the lines each side can see, so pier can quote the code under
// a comment (for suggestions) and know which line numbers are commentable at all.

export type PatchLines = {
  /** New-file line number -> text, for lines present in the patch (added or context). */
  right: Map<number, string>;
  /** Old-file line number -> text, for lines present in the patch (removed or context). */
  left: Map<number, string>;
};

export function patchLines(file: DiffFile): PatchLines {
  const right = new Map<number, string>();
  const left = new Map<number, string>();
  let oldLine = 0;
  let newLine = 0;
  for (const line of (file.patch ?? "").split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (line.startsWith("\\")) continue;
    const marker = line[0];
    const text = line.slice(1);
    if (marker === "+") right.set(newLine++, text);
    else if (marker === "-") left.set(oldLine++, text);
    else if (marker === " " || line === "") {
      right.set(newLine++, text);
      left.set(oldLine++, text);
    }
  }
  return { right, left };
}

/** The code between two lines on one side, joined, or null if any line isn't in the patch. */
export function codeBetween(
  lines: PatchLines,
  side: "LEFT" | "RIGHT",
  start: number,
  end: number,
): string | null {
  const map = side === "RIGHT" ? lines.right : lines.left;
  const out: string[] = [];
  for (let n = Math.min(start, end); n <= Math.max(start, end); n++) {
    const text = map.get(n);
    if (text === undefined) return null;
    out.push(text);
  }
  return out.join("\n");
}

export type HunkRow = { kind: "added" | "removed" | "context"; number: number; text: string };

/** A hunk's lines in order, each numbered on its side (a removed line by the old file). */
export function hunkRows(hunk: string): HunkRow[] {
  const rows: HunkRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const line of hunk.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      continue;
    }
    if (line.startsWith("\\")) continue;
    const text = line.slice(1);
    if (line[0] === "+") rows.push({ kind: "added", number: newLine++, text });
    else if (line[0] === "-") rows.push({ kind: "removed", number: oldLine++, text });
    else {
      rows.push({ kind: "context", number: newLine++, text });
      oldLine++;
    }
  }
  return rows;
}
