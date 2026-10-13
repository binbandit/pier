import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { clsx } from "clsx";

import { Ledger, countTicks } from "@/components/ledger";
import { VirtualRows } from "@/components/rows";
import { markDone, openOnGitHub, propose } from "@/features/actions";
import type { Command } from "@/keys/registry";
import { ago, plural, shortRepo } from "@/lib/format";
import { q, rpc } from "@/lib/rpc";
import { useList } from "@/lib/use-list";
import { AccountAvatar, Avatar } from "@/ui/avatar";
import { Dot, type Tone } from "@/ui/dot";
import { Keys } from "@/ui/kbd";
import type { GroupItem, PrItem, QueueItem, Split } from "@pier/core/wire";

const TITLES: Record<Split, string> = { review: "Review", deps: "Deps", mine: "Mine" };
const NEXT: Record<Split, Split> = { review: "deps", deps: "mine", mine: "review" };
const EMPTY: Record<Split, string> = {
  review: "Nothing is waiting on your review.",
  deps: "No dependency bumps need you.",
  mine: "None of your PRs need you right now.",
};
const ROW = 40;
const ECOSYSTEM_LABELS: Partial<Record<GroupItem["ecosystem"], string>> = {
  "github-actions": "actions",
  gomod: "go",
};

export function Inbox({ split }: { split: Split }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data: items = [], isPending } = useQuery(q("inbox", { split }));
  const { data: counts } = useQuery(q("counts", {}));
  const { data: status } = useQuery(q("status", {}));
  // An empty list during the first sync means "not loaded yet", not "nothing to do".
  const loading = isPending || (items.length === 0 && status?.sync.state === "syncing");

  const open = (item: QueueItem) => {
    if (item.kind === "group") void navigate({ to: "/deps/$", params: { _splat: item.key } });
    else {
      const [owner = "", repo = ""] = item.repo.split("/");
      void navigate({
        to: "/$owner/$repo/pull/$number",
        params: { owner, repo, number: item.number },
      });
    }
  };

  const list = useList<QueueItem>({
    id: `inbox-${split}`,
    items,
    keyOf: itemKey,
    rowHeight: ROW,
    onOpen: open,
    commands: (current, selected): Command[] => {
      const targets = selected.length > 0 ? selected : current ? [current] : [];
      return [
        {
          id: "inbox.approve",
          title: split === "deps" ? "Approve the clear cohort" : "Approve",
          keys: ["a"],
          scope: "surface",
          hint: "approve",
          group: "Decide",
          run: () => void approve(targets),
        },
        {
          id: "inbox.done",
          title: "Done",
          keys: ["e"],
          scope: "surface",
          hint: "done",
          group: "Decide",
          run: () => {
            if (targets.length === 0) return;
            void markDone(
              client,
              targets.map(doneKey),
              `Done: ${targets.length === 1 ? label(targets[0]!) : plural(targets.length, "item")}`,
            );
          },
        },
        {
          id: "inbox.github",
          title: "Open on github.com",
          keys: ["shift+o"],
          scope: "surface",
          group: "Go to",
          run: () => current && void githubUrl(current).then((url) => url && openOnGitHub(url)),
        },
        {
          id: "inbox.next-split",
          title: `Go to ${TITLES[NEXT[split]]}`,
          keys: ["tab"],
          scope: "surface",
          group: "Go to",
          run: () => void navigate({ to: "/inbox/$split", params: { split: NEXT[split] } }),
        },
      ];
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-end gap-3 px-8 pb-3">
        <h1 className="text-title font-semibold text-strong">{TITLES[split]}</h1>
        <span className="pb-0.5 text-ui text-faint">{items.length > 0 ? items.length : ""}</span>
        {list.selected.length > 0 && (
          <span className="ml-4 pb-0.5 text-meta text-accent">{list.selected.length} selected</span>
        )}
      </header>

      {!isPending && items.length === 0 ? (
        <div className="px-8 pt-16">
          <p className="text-prose text-muted">
            {loading
              ? "Reading your PRs from GitHub. They appear here as they load."
              : EMPTY[split]}
          </p>
          {counts && counts[NEXT[split]] > 0 && (
            <p className="mt-3 flex items-center gap-2 text-ui text-faint">
              <Keys sequence="tab" /> {TITLES[NEXT[split]]} has {counts[NEXT[split]]}
            </p>
          )}
        </div>
      ) : (
        <VirtualRows
          scrollRef={list.scrollRef}
          virtualizer={list.virtualizer}
          items={items}
          keyOf={itemKey}
          rowHeight={ROW}
          label={TITLES[split]}
          cursor={list.index}
          selectedKeys={list.selectedKeys}
          onSelect={list.move}
          onOpen={open}
          render={(item) =>
            item.kind === "group" ? <GroupLine item={item} /> : <PrLine item={item} />
          }
        />
      )}
    </div>
  );
}

function GroupLine({ item }: { item: GroupItem }) {
  const allCovered =
    item.covered > 0 &&
    item.covered === item.cohorts.clear + item.cohorts.look + item.cohorts.stuck;
  const tone: Tone = item.cohorts.clear > 0 ? "ok" : item.cohorts.look > 0 ? "warn" : "bad";
  const from =
    item.fromVersions.length === 1 ? item.fromVersions[0] : `${item.fromVersions.length} versions`;
  return (
    <div className="grid w-full max-w-[1320px] grid-cols-[16px_minmax(160px,1.3fr)_minmax(180px,1fr)_100px_minmax(120px,200px)_80px_48px_20px] items-center gap-x-4">
      <Dot tone={tone} />
      <span className="truncate font-code text-code text-strong">{item.pkg}</span>
      <span className="truncate font-code text-meta text-muted">
        {from} <span className="text-faint">→</span> {item.to}
      </span>
      <span className="flex gap-2 text-meta">
        <span className="text-faint">{ECOSYSTEM_LABELS[item.ecosystem] ?? item.ecosystem}</span>
        <span
          className={
            item.semver === "major"
              ? "text-warn"
              : item.semver === "unknown"
                ? "text-faint"
                : "text-muted"
          }
        >
          {item.semver}
        </span>
      </span>
      {allCovered ? (
        <span className="text-meta text-auto">{item.covered} covered</span>
      ) : (
        <Ledger
          ticks={countTicks(item.cohorts)}
          label={`${item.cohorts.clear} clear, ${item.cohorts.look} look, ${item.cohorts.stuck} stuck`}
        />
      )}
      <span className="text-right text-meta text-muted">{plural(item.repoCount, "repo")}</span>
      <span className="text-right text-meta text-faint">{ago(item.updatedAt)}</span>
      <span className="flex justify-end -space-x-1">
        {item.accounts.slice(0, 2).map((login) => (
          <AccountAvatar key={login} login={login} size={16} />
        ))}
      </span>
    </div>
  );
}

const CHECK_TONES: Record<PrItem["checks"]["state"], Tone> = {
  success: "ok",
  failure: "bad",
  pending: "warn",
  none: "faint",
};

function PrLine({ item }: { item: PrItem }) {
  return (
    <div className="grid w-full max-w-[1320px] grid-cols-[16px_minmax(0,2fr)_minmax(120px,0.8fr)_minmax(0,1.2fr)_88px_48px_20px] items-center gap-x-4">
      <Dot tone={CHECK_TONES[item.checks.state]} label={`checks ${item.checks.state}`} />
      <span className={clsx("truncate", item.isDraft ? "text-muted" : "text-strong")}>
        {item.isDraft && <span className="mr-2 text-faint">Draft</span>}
        {item.title}
      </span>
      <span className="truncate font-code text-meta text-faint">
        {shortRepo(item.repo)}#{item.number}
      </span>
      <span className="truncate text-meta text-muted">{item.reason}</span>
      <span className="text-right font-code text-meta">
        <span className="text-ok">+{item.additions}</span>{" "}
        <span className="text-bad">−{item.deletions}</span>
      </span>
      <span className="text-right text-meta text-faint">{ago(item.updatedAt)}</span>
      {item.author ? (
        <Avatar login={item.author.login} url={item.author.avatarUrl} size={16} />
      ) : (
        <span />
      )}
    </div>
  );
}

function itemKey(item: QueueItem): string {
  return item.kind === "group" ? `group:${item.key}` : `pr:${item.id}`;
}

const doneKey = itemKey;

function label(item: QueueItem): string {
  return item.kind === "group"
    ? `${item.pkg} ${item.to}`
    : `${shortRepo(item.repo)}#${item.number}`;
}

/** Approve: for a bump group, its clear cohort; for a PR, the PR. Always via a plan. */
async function approve(targets: QueueItem[]): Promise<void> {
  if (targets.length === 0) return;
  const groups = targets.filter((t): t is GroupItem => t.kind === "group");
  const prs = targets.filter((t): t is PrItem => t.kind === "pr");
  const views = await Promise.all(groups.map((g) => rpc("group", { key: g.key })));
  const fromGroups = views.flatMap(
    (view) =>
      view?.rows
        .filter((r) => r.cohort === "clear" && !r.approvedByYou && !r.pending)
        .map((r) => r.prId) ?? [],
  );
  const prIds = [...fromGroups, ...prs.map((p) => p.id)];
  const only = targets.length === 1 ? targets[0] : undefined;
  const text = only
    ? only.kind === "group"
      ? `${only.pkg} ${only.to}, clear cohort`
      : `${shortRepo(only.repo)}#${only.number}`
    : plural(targets.length, "item");
  await propose("approve", prIds, text, only?.kind === "group" ? only.key : undefined);
}

async function githubUrl(item: QueueItem): Promise<string | null> {
  if (item.kind === "pr") return item.url;
  const view = await rpc("group", { key: item.key });
  return view?.rows[0]?.url ?? null;
}
