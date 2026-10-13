import { describe, expect, test } from "bun:test";

import { summarizeGates } from "@/domain/gates";
import { type BotEval, pickRepresentative } from "@/domain/views";
import type { GateResult } from "@pier/core/wire";

type Shape = { lock: string; adds: number; dels: number };

const pr = (id: string, shape: Shape, opts: { bumps?: number; cohort?: string } = {}) =>
  ({
    record: {
      doc: {
        id,
        files: [
          { path: "package.json", additions: shape.adds, deletions: shape.dels },
          { path: shape.lock, additions: 9, deletions: 9 },
        ],
      },
      files: [],
      bot: { bumps: [{ ecosystem: "npm" }] },
    },
    bumps: Array.from({ length: opts.bumps ?? 1 }, () => ({ ecosystem: "npm" })),
    placement: { cohort: opts.cohort ?? "clear" },
  }) as unknown as BotEval;

const npm: Shape = { lock: "package-lock.json", adds: 1, dels: 1 };
const pnpm: Shape = { lock: "pnpm-lock.yaml", adds: 1, dels: 1 };

describe("group representative", () => {
  test("is the most common shape among PRs carrying only this bump", () => {
    const grouped = pr("grouped", { lock: "package-lock.json", adds: 4, dels: 4 }, { bumps: 4 });
    const evals = [grouped, pr("a", pnpm), pr("b", npm, { cohort: "look" }), pr("c", npm)];
    expect(pickRepresentative(evals).record.doc.id).toBe("c");
  });

  test("falls back to grouped PRs when every PR carries other bumps too", () => {
    const evals = [pr("x", npm, { bumps: 2 }), pr("y", npm, { bumps: 3 })];
    expect(pickRepresentative(evals).record.doc.id).toBe("x");
  });
});

const checks = (detail: string, status: GateResult["status"] = "fail"): GateResult[] => [
  { gate: "checks", status, detail },
];
const summary = (rows: GateResult[][]) => summarizeGates(rows).find((g) => g.gate === "checks");

describe("gate summary across a group", () => {
  test("one failing PR reads as that PR's reason", () => {
    expect(summary([checks("No checks reported"), checks("3 passing", "pass")])?.detail).toBe(
      "No checks reported",
    );
  });

  test("many failing PRs give the count and the distinct reasons, most common first", () => {
    const rows = [
      checks("1 check failing"),
      checks("No checks reported"),
      checks("No checks reported"),
      checks("2 checks failing"),
    ];
    expect(summary(rows)?.detail).toBe("4 PRs: No checks reported; 1 check failing; and more");
    expect(summary([checks("No checks reported"), checks("No checks reported")])?.detail).toBe(
      "No checks reported (2 PRs)",
    );
  });
});
