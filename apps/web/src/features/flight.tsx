import { useQuery } from "@tanstack/react-query";

import { VirtualRows } from "@/components/rows";
import { openOnGitHub } from "@/features/actions";
import { shortRepo } from "@/lib/format";
import { q } from "@/lib/rpc";
import { useList } from "@/lib/use-list";
import { AccountAvatar } from "@/ui/avatar";
import { CHECK_TONE, Dot } from "@/ui/dot";
import { When } from "@/ui/when";
import type { FlightItem } from "@pier/core/wire";

// Everything that isn't your turn: approvals waiting on automation, your PRs waiting on others.
// Nothing here needs you; it's where you look to see that things are moving.

const ROW = 40;

export function Flight() {
  const { data: items = [], isPending } = useQuery(q("flight", {}));
  const list = useList<FlightItem>({
    id: "flight",
    items,
    keyOf: (i) => i.prId,
    rowHeight: ROW,
    onOpen: (item) => openOnGitHub(item.url),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-end gap-3 px-8 pb-3">
        <h1 className="text-title font-semibold text-strong">In flight</h1>
        <span className="pb-0.5 text-ui text-faint">{items.length > 0 ? items.length : ""}</span>
      </header>
      {!isPending && items.length === 0 ? (
        <p className="px-8 pt-16 text-prose text-muted">Nothing is waiting on anyone else.</p>
      ) : (
        <VirtualRows
          scrollRef={list.scrollRef}
          virtualizer={list.virtualizer}
          items={items}
          keyOf={(i) => i.prId}
          rowHeight={ROW}
          label="In flight"
          cursor={list.index}
          selectedKeys={list.selectedKeys}
          onSelect={list.move}
          onOpen={(item) => openOnGitHub(item.url)}
          render={(item) => (
            <div className="grid w-full max-w-[1320px] grid-cols-[16px_minmax(0,2fr)_minmax(120px,0.8fr)_minmax(0,1.4fr)_48px_20px] items-center gap-x-4">
              <Dot tone={CHECK_TONE[item.checks.state]} />
              <span className="truncate text-fg">{item.title}</span>
              <span className="truncate font-code text-meta text-faint">
                {shortRepo(item.repo)}#{item.number}
              </span>
              <span className="truncate text-meta text-muted">{item.waitingOn}</span>
              <span className="text-right text-meta text-faint">
                <When at={item.updatedAt} />
              </span>
              <AccountAvatar login={item.account} size={16} />
            </div>
          )}
        />
      )}
    </div>
  );
}
