import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { clsx } from "clsx";
import { GitBranch, RefreshCw } from "lucide-react";

import { errorText } from "@/features/actions";
import { formatNumber } from "@/lib/format";
import { q } from "@/lib/rpc";
import { useList } from "@/lib/use-list";
import { Avatar } from "@/ui/avatar";
import { DiffStat } from "@/ui/diff-stat";
import { CHECK_TONE, Dot } from "@/ui/dot";
import type { MergeQueueItem } from "@pier/core/wire";

const METHODS: Record<string, string> = {
  SQUASH: "Squash",
  MERGE: "Merge commit",
  REBASE: "Rebase",
};

export function MergeQueue() {
  const navigate = useNavigate();
  const { data = [], isPending, isFetching, error, refetch } = useQuery(q("mergeQueue", {}));
  const items = data.toSorted(
    (a, b) =>
      a.repo.localeCompare(b.repo) ||
      a.baseRefName.localeCompare(b.baseRefName) ||
      (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
      a.number - b.number,
  );
  const indexById = new Map(items.map((item, index) => [item.id, index]));
  const groups = Map.groupBy(items, (item) => `${item.repo}:${item.baseRefName}`);
  const queued = items.filter((item) => item.position !== null).length;
  const {
    scrollRef,
    index: currentIndex,
    move,
    selectedKeys,
  } = useList({
    id: "merge-queue",
    items,
    keyOf: (item) => item.id,
    rowHeight: 68,
    onOpen: (item) => {
      const [owner = "", repo = ""] = item.repo.split("/");
      void navigate({
        to: "/$owner/$repo/pull/$number",
        params: { owner, repo, number: item.number },
      });
    },
    scrollTo: (index, container) =>
      container.querySelectorAll("[data-queue-pr]")[index]?.scrollIntoView({ block: "nearest" }),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 px-8 pt-6 pb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-title font-semibold text-strong">Merge queue</h1>
          {!isPending && !error && (
            <span className="text-ui text-faint">{formatNumber(items.length)}</span>
          )}
          <button
            type="button"
            aria-label="Refresh merge queue"
            disabled={isFetching}
            onClick={() => void refetch()}
            className="ml-auto flex items-center gap-2 rounded-sm px-2 py-1 text-meta text-muted hover:bg-hover hover:text-strong disabled:opacity-50"
          >
            <RefreshCw aria-hidden size={14} className={isFetching ? "animate-spin" : undefined} />
            {isFetching ? "Updating" : "Refresh"}
          </button>
        </div>
        <p className="mt-2 text-meta text-faint">Tracked PRs queued or set to merge when ready.</p>
        {items.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted">
            <span className="whitespace-nowrap">{formatNumber(queued)} queued</span>
            {items.length > queued && (
              <span className="whitespace-nowrap">
                {formatNumber(items.length - queued)} merge when ready
              </span>
            )}
          </p>
        )}
      </header>
      {error && (
        <div
          role="alert"
          className="mx-8 mb-5 rounded-sm border border-bad/40 px-3 py-2 text-meta text-bad"
        >
          Could not load the merge queue. {errorText(error)}
        </div>
      )}
      {isPending ? (
        <p role="status" className="px-8 pt-10 text-ui text-faint">
          Loading merge queue
        </p>
      ) : !error && items.length === 0 ? (
        <div className="px-8 pt-10">
          <p className="text-prose text-muted">No tracked PRs are waiting to merge.</p>
          <p className="mt-2 max-w-[64ch] text-ui text-faint">
            Queued PRs and PRs set to merge when ready will appear here until they merge or leave
            the queue.
          </p>
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-8 overflow-y-auto px-8 pb-8">
          {[...groups].map(([key, members]) => {
            const first = members[0];
            if (!first) return null;
            const label = `${first.repo} into ${first.baseRefName}`;
            return (
              <section key={key} aria-label={label} className="max-w-[1320px]">
                <h2 className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui">
                  <span className="min-w-0 wrap-anywhere text-strong">{first.repo}</span>
                  <span className="flex min-w-0 items-center gap-1.5 font-code text-meta text-faint">
                    <GitBranch aria-hidden size={14} className="shrink-0" />
                    <span className="wrap-anywhere">{first.baseRefName}</span>
                  </span>
                  <span className="text-meta text-faint">{formatNumber(members.length)}</span>
                </h2>
                <ol className="divide-y divide-line border-y border-line">
                  {members.map((item) => {
                    const [owner = "", repo = ""] = item.repo.split("/");
                    const index = indexById.get(item.id) ?? 0;
                    return (
                      <li key={item.id}>
                        <Link
                          data-queue-pr
                          to="/$owner/$repo/pull/$number"
                          params={{ owner, repo, number: item.number }}
                          onFocus={() => move(index)}
                          className={clsx(
                            "flex min-h-[68px] items-center gap-3 rounded-sm px-3 py-3",
                            currentIndex === index
                              ? "bg-cursor"
                              : selectedKeys.includes(item.id)
                                ? "bg-selected"
                                : "hover:bg-hover",
                          )}
                        >
                          <span
                            aria-label={
                              item.position === null
                                ? "Merge when ready"
                                : `Queue position ${formatNumber(item.position)}`
                            }
                            className="w-8 shrink-0 text-center font-code text-ui text-faint"
                          >
                            {item.position === null ? "·" : formatNumber(item.position)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-ui text-strong" title={item.title}>
                              {item.title}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-faint">
                              <span className="font-code">#{item.number}</span>
                              <span className={item.position === null ? "text-auto" : "text-muted"}>
                                {item.position === null
                                  ? "Merge when ready"
                                  : humanise(item.queueState ?? "QUEUED")}
                              </span>
                              {item.autoMerge && (
                                <span>{METHODS[item.autoMerge] ?? humanise(item.autoMerge)}</span>
                              )}
                              <span className="flex items-center gap-1.5 whitespace-nowrap">
                                <Dot tone={CHECK_TONE[item.checks.state]} />
                                {checksLabel(item)}
                              </span>
                            </div>
                          </div>
                          <DiffStat
                            additions={item.additions}
                            deletions={item.deletions}
                            className="text-meta"
                          />
                          {item.author && (
                            <Avatar
                              login={item.author.login}
                              url={item.author.avatarUrl}
                              size={20}
                            />
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function humanise(value: string): string {
  const text = value.toLowerCase().replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function checksLabel(item: MergeQueueItem): string {
  const { checks } = item;
  if (checks.failing > 0) return `${formatNumber(checks.failing)} failed`;
  if (checks.pending > 0) return `${formatNumber(checks.pending)} running`;
  if (checks.state === "success") return "Checks passed";
  return checks.state === "none" ? "No checks" : humanise(checks.state);
}
