import { describe, expect, test } from "bun:test";

import { SuggestionError, applySplices, hunkLines } from "@/domain/suggestions";
import { suggestionIn } from "@pier/core/suggestion";

const splice = (start: number, end: number, lines: string[], expected: string[] | null = null) => ({
  start,
  end,
  lines,
  expected,
  label: `a.ts:${start}`,
});

describe("suggestion blocks", () => {
  test("one block is the suggestion; none or two aren't one", () => {
    expect(suggestionIn("Try this:\n```suggestion\nconst x = 1;\n```\nThoughts?")).toEqual([
      "const x = 1;",
    ]);
    expect(suggestionIn("````suggestion\n```js\n````")).toEqual(["```js"]);
    expect(suggestionIn("```suggestion\r\n```")).toEqual([]);
    expect(suggestionIn("```js\nconst x = 1;\n```")).toBeNull();
    expect(suggestionIn("```suggestion\na\n```\n```suggestion\nb\n```")).toBeNull();
  });
});

describe("applying suggestions", () => {
  test("splices bottom up, so each suggestion lands on the lines it was written on", () => {
    const text = "one\ntwo\nthree\nfour\n";
    expect(applySplices(text, [splice(1, 1, ["ONE", "ONE+"]), splice(3, 4, ["3-4"])])).toBe(
      "ONE\nONE+\ntwo\n3-4\n",
    );
  });

  test("keeps CRLF, a byte-order mark and a missing final newline", () => {
    expect(applySplices("﻿a\r\nb\r\nc", [splice(3, 3, ["C", "D"])])).toBe("﻿a\r\nb\r\nC\r\nD");
  });

  test("an empty suggestion deletes the lines", () => {
    expect(applySplices("a\nb\nc\n", [splice(2, 2, [])])).toBe("a\nc\n");
  });

  test("overlapping suggestions, gone lines and changed code are refused", () => {
    const text = "a\nb\nc\n";
    expect(() => applySplices(text, [splice(1, 2, ["x"]), splice(2, 3, ["y"])])).toThrow(
      SuggestionError,
    );
    expect(() => applySplices(text, [splice(3, 4, ["x"])])).toThrow("doesn't have any more");
    expect(() => applySplices(text, [splice(2, 2, ["x"], ["B"])])).toThrow("changed since");
    expect(applySplices(text, [splice(2, 2, ["x"], ["b"])])).toBe("a\nx\nc\n");
  });

  test("the lines a comment was written on come from the end of its hunk", () => {
    const hunk = "@@ -1,3 +1,4 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;";
    expect(hunkLines(hunk, 2)).toEqual(["const b = 3;", "const c = 4;"]);
    expect(hunkLines(hunk, 9)).toBeNull();
    // GitHub leaves a CRLF file's last hunk line with its \r.
    expect(hunkLines("@@ -1,2 +1,2 @@\r\n first\r\n+second\r", 1)).toEqual(["second"]);
  });
});
