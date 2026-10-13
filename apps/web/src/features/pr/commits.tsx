import { clsx } from "clsx";
import { BadgeCheck, BadgeX } from "lucide-react";
import { useState } from "react";

import { useCommands } from "@/keys/registry";
import { Dock } from "@/ui/dock";
import { CHECK_TONE, Dot } from "@/ui/dot";
import { Keys } from "@/ui/kbd";
import { When } from "@/ui/when";
import type { CommitView, DiffView, PrView } from "@pier/core/wire";

// Which changes to look at, raised with `p`: everything, what changed since your review, one
// commit, or a run of them. ↑/↓ move, Shift+↑/↓ stretch over several commits, Enter shows them.

type Row = { kind: "all" } | { kind: "since-review" } | { kind: "commit"; commit: CommitView };

export function CommitPicker({
  pr,
  view,
  onPick,
  onClose,
}: {
  pr: PrView;
  view: DiffView;
  onPick: (view: DiffView) => void;
  onClose: () => void;
}) {
  const reviewed = pr.lastReviewedOid !== null && pr.lastReviewedOid !== pr.headRefOid;
  const rows: Row[] = [
    { kind: "all" },
    ...(reviewed ? [{ kind: "since-review" } as const] : []),
    ...pr.commits.map((commit) => ({ kind: "commit" as const, commit })),
  ];
  const firstCommit = rows.length - pr.commits.length;
  const keyAt = (index: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    return row?.kind === "commit" ? row.commit.oid : (row?.kind ?? "all");
  };
  const indexOf = (key: string | null) =>
    rows.findIndex((row) => (row.kind === "commit" ? row.commit.oid : row.kind) === key);

  // The cursor starts on what's showing; a run of commits keeps its other end as the anchor. Both
  // hold a row's key, not its place: rows come and go while this is open (a push adds a commit,
  // a review you send takes "Since your review" away), and the cursor has to stay on its row.
  const [cursorKey, setCursorKey] = useState(() =>
    view.range === "commits" ? view.to : view.range,
  );
  const [anchorKey, setAnchorKey] = useState(() =>
    view.range === "commits" && view.from !== view.to ? view.from : null,
  );
  const cursor = Math.max(0, indexOf(cursorKey));
  const anchor = indexOf(anchorKey);
  const [low = cursor, high = cursor] =
    anchor === -1 ? [cursor, cursor] : [anchor, cursor].toSorted((a, b) => a - b);

  const move = (to: number) => {
    setCursorKey(keyAt(to));
    setAnchorKey(null);
  };
  /** Stretches the run of commits from where it started; commits are the only rows that stretch. */
  const extend = (to: number) => {
    if (cursor < firstCommit) {
      move(to);
      return;
    }
    setAnchorKey(anchor === -1 ? keyAt(cursor) : anchorKey);
    setCursorKey(keyAt(Math.max(firstCommit, to)));
  };
  const pick = (first: number, last: number) => {
    const row = rows[last];
    if (!row) return;
    if (row.kind !== "commit") {
      onPick({ range: row.kind });
      return;
    }
    const from = rows[first];
    onPick({
      range: "commits",
      from: from?.kind === "commit" ? from.commit.oid : row.commit.oid,
      to: row.commit.oid,
    });
  };

  useCommands([
    { id: "commits.close", title: "Cancel", keys: ["escape"], scope: "panel", run: onClose },
    {
      id: "commits.pick",
      title: "Show these changes",
      keys: ["enter"],
      scope: "panel",
      run: () => pick(low, high),
    },
    {
      id: "commits.down",
      title: "Next",
      keys: ["arrowdown", "j"],
      scope: "panel",
      run: () => move(cursor + 1),
    },
    {
      id: "commits.up",
      title: "Previous",
      keys: ["arrowup", "k"],
      scope: "panel",
      run: () => move(cursor - 1),
    },
    {
      id: "commits.extend-down",
      title: "Take in the next commit",
      keys: ["shift+arrowdown", "shift+j"],
      scope: "panel",
      run: () => extend(cursor + 1),
    },
    {
      id: "commits.extend-up",
      title: "Take in the previous commit",
      keys: ["shift+arrowup", "shift+k"],
      scope: "panel",
      run: () => extend(cursor - 1),
    },
  ]);

  return (
    <Dock label="Choose changes">
      <div className="max-w-[900px]">
        <div className="mb-2 flex items-baseline gap-4">
          <h2 className="text-ui font-medium text-strong">Show changes from</h2>
          <span className="ml-auto flex items-center gap-4 text-meta text-faint">
            <span className="flex items-center gap-1.5">
              <Keys sequence="shift+arrowdown" /> several commits
            </span>
            <span className="flex items-center gap-1.5">
              <Keys sequence="enter" /> show
            </span>
            <span className="flex items-center gap-1.5">
              <Keys sequence="escape" /> cancel
            </span>
          </span>
        </div>
        <ul aria-label="Changes to show" className="max-h-[44vh] overflow-y-auto">
          {rows.map((row, i) => {
            const chosen = i >= low && i <= high;
            return (
              <li key={row.kind === "commit" ? row.commit.oid : row.kind}>
                {i === firstCommit && i > 0 && (
                  <p className="mt-2 mb-1 px-3 text-meta text-faint">
                    {pr.commits.length === 1
                      ? "The commit"
                      : pr.commitsTotal > pr.commits.length
                        ? `The last ${pr.commits.length} of ${pr.commitsTotal} commits`
                        : `${pr.commits.length} commits`}
                  </p>
                )}
                <button
                  type="button"
                  aria-current={i === cursor || undefined}
                  onClick={(event) => {
                    // Shift-click stretches a run of commits, like Shift+↑/↓.
                    if (event.shiftKey && row.kind === "commit" && cursor >= firstCommit)
                      pick(Math.min(cursor, i), Math.max(cursor, i));
                    else pick(i, i);
                  }}
                  className={clsx(
                    "flex h-8 w-full items-center gap-3 rounded-sm px-3 text-left text-ui",
                    i === cursor ? "bg-cursor text-strong" : chosen ? "bg-selected" : "text-fg",
                  )}
                >
                  {row.kind === "commit" ? (
                    <CommitRow commit={row.commit} />
                  ) : row.kind === "all" ? (
                    <>
                      <span className="w-[88px] shrink-0" />
                      <span>Everything</span>
                      <span className="text-meta text-faint">
                        {pr.commits.length === 1 ? "the commit" : `all ${pr.commitsTotal} commits`}{" "}
                        against {pr.baseRefName}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="w-[88px] shrink-0" />
                      <span>Since your review</span>
                      <span className="font-code text-meta text-faint">
                        {pr.lastReviewedOid?.slice(0, 7)} to {pr.headRefOid.slice(0, 7)}
                      </span>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Dock>
  );
}

function CommitRow({ commit }: { commit: CommitView }) {
  return (
    <>
      <span className="flex w-[88px] shrink-0 items-center gap-2 font-code text-meta text-faint">
        <Dot tone={CHECK_TONE[commit.checks]} label={`Checks: ${commit.checks}`} />
        {commit.oid.slice(0, 7)}
      </span>
      <span className="min-w-0 truncate">{commit.headline}</span>
      {commit.verified === true && (
        <BadgeCheck aria-label="Verified" size={14} className="shrink-0 text-ok" />
      )}
      {commit.verified === false && (
        <BadgeX aria-label="Signature didn't verify" size={14} className="shrink-0 text-warn" />
      )}
      <span className="ml-auto shrink-0 text-meta text-faint">
        {commit.author ?? "unknown"} <When at={commit.at} />
      </span>
    </>
  );
}

/** What the Changes heading says about the view, and the commits it covers. */
export function describeView(view: DiffView, pr: Pick<PrView, "commits" | "commitsTotal">): string {
  if (view.range === "all") return "Changes";
  if (view.range === "since-review") return "Since your review";
  // Only the last commits are listed; number them by their place in the whole PR.
  const skipped = pr.commitsTotal - pr.commits.length;
  const from = skipped + pr.commits.findIndex((c) => c.oid === view.from) + 1;
  const to = skipped + pr.commits.findIndex((c) => c.oid === view.to) + 1;
  return from === to
    ? `Commit ${to} of ${pr.commitsTotal}`
    : `Commits ${from} to ${to} of ${pr.commitsTotal}`;
}
