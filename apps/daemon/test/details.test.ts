import { expect, test } from "bun:test";

import { Details } from "@/domain/details";
import type { PrDetail } from "@/github/pr-detail";
import { memoryStores } from "@/store/db";

const detail = (n: number) => ({ timeline: [], marker: n }) as unknown as PrDetail;

test("only recent details stay in memory, and older ones still read back", () => {
  const db = memoryStores().cache;
  const details = new Details(db);
  for (let n = 0; n < 250; n++) details.set(`PR_${n}`, "you", detail(n), "2026-10-14T00:00:00Z");

  const inMemory = (details as unknown as { entries: Map<string, unknown> }).entries;
  expect(inMemory.size).toBe(200);
  expect(inMemory.has("PR_0:you")).toBe(false);
  expect(details.get("PR_0", "you")?.detail).toEqual(detail(0));
  // Reading it made it recent again.
  expect(inMemory.has("PR_0:you")).toBe(true);
});
