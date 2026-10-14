import { clsx } from "clsx";

import { shortRepo } from "@/lib/format";
import { Avatar } from "@/ui/avatar";
import { CHECK_TONE, Dot } from "@/ui/dot";
import { When } from "@/ui/when";
import type { PrItem } from "@pier/core/wire";

// One PR as a list row: checks, title, where it is, why it's listed, size, age and author.
// Merged and closed PRs (in search results) read a step quieter, as finished work does.

export function PrLine({ item }: { item: PrItem }) {
  const finished = item.state !== "OPEN";
  return (
    <div className="grid w-full max-w-[1320px] grid-cols-[16px_minmax(0,2fr)_minmax(120px,0.8fr)_minmax(0,1.2fr)_88px_48px_20px] items-center gap-x-4">
      <Dot tone={CHECK_TONE[item.checks.state]} label={`checks ${item.checks.state}`} />
      <span className={clsx("truncate", item.isDraft || finished ? "text-muted" : "text-strong")}>
        {item.isDraft && <span className="mr-2 text-faint">Draft</span>}
        {item.title}
      </span>
      <span title={item.repo} className="truncate font-code text-meta text-faint">
        {shortRepo(item.repo)}#{item.number}
      </span>
      <span className={clsx("truncate text-meta", finished ? "text-faint" : "text-muted")}>
        {item.reason}
      </span>
      <span className="text-right font-code text-meta">
        <span className="text-ok">+{item.additions}</span>{" "}
        <span className="text-bad">−{item.deletions}</span>
      </span>
      <span className="text-right text-meta text-faint">
        <When at={item.updatedAt} />
      </span>
      {item.author ? (
        <Avatar login={item.author.login} url={item.author.avatarUrl} size={16} />
      ) : (
        <span />
      )}
    </div>
  );
}
