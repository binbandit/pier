import { clsx } from "clsx";

import type { Cohort } from "@pier/core/wire";

// pier's signature: one tick per PR in a bump group, like lights along a pier at night.
// Solid ticks still need a decision (sage clear, amber look, rose stuck); hollow ticks are
// approved or on their way. During a sweep the ticks hollow out one by one as approvals land.

export type Tick = { id: string; cohort: Cohort; state: "open" | "sending" | "done" };

const MAX_TICKS = 48;

const SOLID: Record<Cohort, string> = { clear: "bg-ok", look: "bg-warn", stuck: "bg-bad" };
const OUTLINE: Record<Cohort, string> = {
  clear: "border-ok",
  look: "border-warn",
  stuck: "border-bad",
};

export function Ledger({
  ticks,
  size = "sm",
  label,
}: {
  ticks: Tick[];
  size?: "sm" | "lg";
  label: string;
}) {
  const shown = ticks.slice(0, MAX_TICKS);
  const extra = ticks.length - shown.length;
  return (
    <span title={label} className="inline-flex items-center gap-[3px]">
      <span className="sr-only">{label}</span>
      {shown.map((tick) => (
        <span
          key={tick.id}
          aria-hidden
          className={clsx(
            "inline-block shrink-0 rounded-[1px] border transition-[background-color,border-color,opacity] duration-200 ease-out",
            size === "sm" ? "h-3 w-[3px]" : "h-5 w-1",
            tick.state === "open" && [SOLID[tick.cohort], "border-transparent"],
            tick.state === "sending" && ["bg-transparent", OUTLINE[tick.cohort], "opacity-80"],
            tick.state === "done" && ["border-line-max bg-transparent"],
          )}
        />
      ))}
      {extra > 0 && <span className="ml-1 text-meta text-faint">+{extra}</span>}
    </span>
  );
}

/** Ticks for an inbox row, where only cohort counts are known. */
export function countTicks(counts: Record<Cohort, number>): Tick[] {
  return (["clear", "look", "stuck"] as const).flatMap((cohort) =>
    Array.from({ length: counts[cohort] }, (_, i) => ({
      id: `${cohort}-${i}`,
      cohort,
      state: "open" as const,
    })),
  );
}
