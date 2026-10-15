import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { errorText } from "@/features/actions";
import { useCommands } from "@/keys/registry";
import { githubPath } from "@/lib/permalink";
import { rpc } from "@/lib/rpc";
import { usePrefs } from "@/stores/prefs";
import { useUi } from "@/stores/ui";
import { Avatar } from "@/ui/avatar";
import { Dot, type Tone } from "@/ui/dot";
import { Keys } from "@/ui/kbd";
import { When } from "@/ui/when";
import type { PrView, TimelineEntry } from "@pier/core/wire";

import { Composer } from "./composer";
import { Writing } from "./writing";

// The conversation and history beside the code, newest at the bottom like a chat, with a box to
// add to it. Inline threads live in the diff; this is everything else.

const REVIEW_STATE: Record<string, { text: string; tone: Tone }> = {
  APPROVED: { text: "approved", tone: "ok" },
  CHANGES_REQUESTED: { text: "requested changes", tone: "bad" },
  COMMENTED: { text: "reviewed", tone: "info" },
  DISMISSED: { text: "review dismissed", tone: "faint" },
};

export function ActivityRail({
  pr,
  selectedCommit,
  onCommit,
}: {
  pr: PrView;
  selectedCommit: string | null;
  onCommit: (oid: string) => void;
}) {
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  const showUpdates = usePrefs((s) => s.showHistoryUpdates);
  const toggleUpdates = usePrefs((s) => s.toggleHistoryUpdates);
  const timeline = showUpdates
    ? pr.timeline
    : pr.timeline.filter((entry) => entry.kind === "comment" || entry.kind === "review");
  const toggleLabel = showUpdates ? "Hide history updates" : "Show history updates";
  useCommands([
    {
      id: "pr.history-updates",
      title: toggleLabel,
      keys: ["h"],
      scope: "surface",
      group: "View",
      run: toggleUpdates,
    },
  ]);
  // Like a chat: open at the newest, and follow new entries while you're reading the end.
  const list = useRef<HTMLOListElement>(null);
  const atEnd = useRef(true);
  const entries = timeline.length;
  useEffect(() => {
    const el = list.current;
    if (el && entries > 0 && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <aside aria-label="Activity" className="flex w-[380px] shrink-0 flex-col border-l border-line">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line px-5">
        <h2 className="text-ui font-medium text-strong">Activity</h2>
        <button
          type="button"
          aria-label={toggleLabel}
          aria-keyshortcuts="h"
          onClick={toggleUpdates}
          title={`${toggleLabel} (H): commits, pushes and other updates`}
          className="flex h-7 items-center gap-2 rounded-sm px-1 text-meta text-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
        >
          {showUpdates ? "Hide updates" : "Show updates"} <Keys sequence="h" />
        </button>
      </div>
      <ol
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"
      >
        {timeline.length === 0 && (
          <li className="text-meta text-faint">
            {!pr.detailLoaded
              ? "Loading"
              : !showUpdates && pr.timeline.length > 0
                ? "No comments or reviews yet. History updates are hidden."
                : "Nothing yet."}
          </li>
        )}
        {timeline.map((entry) => (
          <li key={entryKey(entry)}>
            <Entry prId={pr.id} entry={entry} selectedCommit={selectedCommit} onCommit={onCommit} />
          </li>
        ))}
      </ol>
      <div className="shrink-0 border-t border-line p-3">
        <Composer
          id="conversation"
          placeholder="Add to the conversation"
          submitLabel="Comment"
          minRows={2}
          onSubmit={async (body) => {
            try {
              await rpc("comment", { prId: pr.id, body });
              void client.invalidateQueries({ queryKey: ["pr"] });
            } catch (error) {
              toast({ text: errorText(error), tone: "bad" });
            }
          }}
        />
      </div>
    </aside>
  );
}

function Entry({
  prId,
  entry,
  selectedCommit,
  onCommit,
}: {
  prId: string;
  entry: TimelineEntry;
  selectedCommit: string | null;
  onCommit: (oid: string) => void;
}) {
  switch (entry.kind) {
    case "comment":
      return (
        <Writing
          prId={prId}
          id={entry.id}
          writing={entry}
          html={entry.bodyHTML}
          quoteInto="conversation"
          header={
            <Byline
              login={entry.author?.login ?? "ghost"}
              avatarUrl={entry.author?.avatarUrl}
              at={entry.at}
            >
              {entry.edited && <span className="text-faint">edited</span>}
            </Byline>
          }
        />
      );
    case "review": {
      const state = REVIEW_STATE[entry.state] ?? {
        text: entry.state.toLowerCase(),
        tone: "faint" as Tone,
      };
      return (
        <Writing
          prId={prId}
          id={entry.id}
          writing={entry}
          html={entry.bodyHTML || null}
          quoteInto="conversation"
          canDismiss={entry.canDismiss}
          header={
            <Byline
              login={entry.author?.login ?? "ghost"}
              avatarUrl={entry.author?.avatarUrl}
              at={entry.at}
            >
              <span className="flex items-center gap-1.5">
                <Dot tone={state.tone} />
                {state.text}
              </span>
            </Byline>
          }
        />
      );
    }
    case "commit":
      return (
        <button
          type="button"
          aria-pressed={selectedCommit === entry.oid}
          onClick={() => onCommit(entry.oid)}
          title={`View commit ${entry.oid.slice(0, 7)}: ${entry.headline}`}
          className="-mx-2 flex w-[calc(100%+16px)] items-baseline gap-2 rounded-sm px-2 py-1 text-left text-meta text-muted hover:bg-hover hover:text-strong focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-selected aria-pressed:text-strong"
        >
          <span className="shrink-0 font-code text-faint">{entry.oid.slice(0, 7)}</span>
          <span className="min-w-0 truncate">{entry.headline}</span>
        </button>
      );
    case "force-push":
      return (
        <p className="text-meta text-faint">
          {entry.actor ?? "Someone"} force-pushed{" "}
          <span className="font-code">
            {entry.before?.slice(0, 7) ?? "?"} → {entry.after?.slice(0, 7) ?? "?"}
          </span>
          , <When at={entry.at} suffix />
        </p>
      );
    default: {
      // A referenced PR opens here in pier; an issue (or anything else) opens on GitHub.
      const inPier = entry.url ? githubPath(entry.url) : null;
      const text = entry.url ? (
        inPier ? (
          <Link to={inPier} className="hover:text-fg hover:underline">
            {entry.text}
          </Link>
        ) : (
          <a
            href={entry.url}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-fg hover:underline"
          >
            {entry.text}
          </a>
        )
      ) : (
        entry.text
      );
      return (
        <p className="text-meta text-faint">
          {entry.actor ?? "Someone"} {text}, <When at={entry.at} suffix />
        </p>
      );
    }
  }
}

function Byline({
  login,
  avatarUrl,
  at,
  children,
}: {
  login: string;
  avatarUrl?: string | undefined;
  at: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-meta">
      <Avatar login={login} url={avatarUrl ?? null} size={16} />
      <span className="text-fg">{login}</span>
      {children && <span className="text-muted">{children}</span>}
      <span className="ml-auto text-faint">
        <When at={at} />
      </span>
    </div>
  );
}

function entryKey(entry: TimelineEntry): string {
  if (entry.kind === "comment" || entry.kind === "review") return entry.id;
  if (entry.kind === "commit") return entry.oid;
  // Two events can share a timestamp (one review request to two people), so include the text.
  return entry.kind === "event"
    ? `event-${entry.at}-${entry.actor ?? ""}-${entry.text}`
    : `${entry.kind}-${entry.at}-${entry.after ?? ""}`;
}
