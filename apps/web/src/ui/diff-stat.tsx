import { clsx } from "clsx";

import { formatNumber } from "@/lib/format";

export function DiffStat({
  additions,
  deletions,
  className,
}: {
  additions: number;
  deletions: number;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-baseline gap-2 font-code whitespace-nowrap",
        className,
      )}
    >
      <span className="text-ok">+{formatNumber(additions)}</span>
      <span className="text-bad">−{formatNumber(deletions)}</span>
    </span>
  );
}
