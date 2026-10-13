import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { githubPath } from "@/components/palette";
import { errorText } from "@/features/actions";
import { ago, since } from "@/lib/format";
import { rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import { Avatar } from "@/ui/avatar";
import { Dot, type Tone } from "@/ui/dot";
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

export function ActivityRail({ pr }: { pr: PrView }) {
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  // Like a chat: open at the newest, and follow new entries while you're reading the end.
  const list = useRef<HTMLOListElement>(null);
  const atEnd = useRef(true);
  const entries = pr.timeline.length;
  useEffect(() => {
    const el = list.current;
    if (el && entries > 0 && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <aside aria-label="Activity" className="flex w-[380px] shrink-0 flex-col border-l border-line">
      <h2 className="flex h-11 shrink-0 items-center border-b border-line px-5 text-ui font-medium text-strong">
        Activity
      </h2>
      <ol
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"
      >
        {pr.timeline.length === 0 && (
          <li className="text-meta text-faint">{pr.detailLoaded ? "Nothing yet." : "Loading"}</li>
        )}
        {pr.timeline.map((entry) => (
          <li key={entryKey(entry)}>
            <Entry prId={pr.id} entry={entry} />
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

function Entry({ prId, entry }: { prId: string; entry: TimelineEntry }) {
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
        <p className="flex items-baseline gap-2 text-meta">
          <span className="font-code text-faint">{entry.oid.slice(0, 7)}</span>
          <span className="truncate text-muted">{entry.headline}</span>
        </p>
      );
    case "force-push":
      return (
        <p className="text-meta text-faint">
          {entry.actor ?? "Someone"} force-pushed{" "}
          <span className="font-code">
            {entry.before?.slice(0, 7) ?? "?"} → {entry.after?.slice(0, 7) ?? "?"}
          </span>
          , {since(entry.at)}
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
          {entry.actor ?? "Someone"} {text}, {since(entry.at)}
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
      <span className="ml-auto text-faint">{ago(at)}</span>
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
