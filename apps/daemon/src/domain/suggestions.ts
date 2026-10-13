// Applying review suggestions to a file's text the way GitHub's "Commit suggestions" does: each
// one replaces the lines its comment is on. Splices go bottom up so earlier line numbers stay
// put, and the file keeps its byte-order mark and each line's own ending (CRLF stays CRLF, a
// missing final newline stays missing).

import { Refusal } from "./refusal";

export class SuggestionError extends Refusal {}

export type Splice = {
  /** First and last line the comment is on, 1-based, in the file at the head. */
  start: number;
  end: number;
  lines: string[];
  /** What those lines held when the suggestion was written; null when it isn't known. */
  expected: string[] | null;
  /** How the suggestion is named in errors ("src/a.ts:12"). */
  label: string;
};

export function applySplices(text: string, splices: Splice[]): string {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  // Each line with its own ending; the last may have none.
  const parts = text.slice(bom.length).match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const lines = parts.map((part) => {
    const ending = /\r?\n$/.exec(part)?.[0] ?? "";
    return { text: part.slice(0, part.length - ending.length), ending };
  });
  const eol = lines.find((line) => line.ending)?.ending ?? "\n";

  const ordered = splices.toSorted((a, b) => a.start - b.start);
  for (const [i, splice] of ordered.entries()) {
    if (splice.start < 1 || splice.end < splice.start || splice.end > lines.length) {
      throw new SuggestionError(`${splice.label} is on lines the file doesn't have any more`);
    }
    const previous = ordered[i - 1];
    if (previous && splice.start <= previous.end) {
      throw new SuggestionError(`${previous.label} and ${splice.label} change the same lines`);
    }
    const current = lines.slice(splice.start - 1, splice.end).map((line) => line.text);
    if (splice.expected && splice.expected.join("\n") !== current.join("\n")) {
      throw new SuggestionError(`The code under ${splice.label} changed since it was suggested`);
    }
  }

  for (const splice of ordered.toReversed()) {
    const last = lines[splice.end - 1];
    const replacement = splice.lines.map((line, i) => ({
      text: line,
      // The last new line ends the way the last replaced one did; the rest with the file's ending.
      ending: i === splice.lines.length - 1 ? (last?.ending ?? eol) : eol,
    }));
    lines.splice(splice.start - 1, splice.end - splice.start + 1, ...replacement);
  }
  return bom + lines.map((line) => line.text + line.ending).join("");
}

/** The new-code lines a review comment was written on, from the end of its diff hunk. */
export function hunkLines(diffHunk: string, count: number): string[] | null {
  const right = diffHunk
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line !== "" && !/^(@@|-|\\)/.test(line))
    // A CRLF file's last hunk line keeps its \r; the file's lines are compared without endings.
    .map((line) => line.slice(1).replace(/\r$/, ""));
  return right.length >= count ? right.slice(-count) : null;
}
