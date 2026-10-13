import { useQuery } from "@tanstack/react-query";

import { ago, shortRepo } from "@/lib/format";
import { q } from "@/lib/rpc";
import { Dot, type Tone } from "@/ui/dot";
import type { LogEntry, OutboxState } from "@pier/core/wire";

// Every write pier has made or is about to make, newest first. When something fails, this is
// where it says what GitHub answered.

const STATE: Record<OutboxState, { text: string; tone: Tone }> = {
  waiting: { text: "Waiting its turn", tone: "auto" },
  held: { text: "Waiting to send", tone: "auto" },
  queued: { text: "Queued", tone: "auto" },
  claimed: { text: "Sending", tone: "auto" },
  acked: { text: "Sent", tone: "ok" },
  unknown: { text: "Checking", tone: "warn" },
  failed: { text: "Failed", tone: "bad" },
  cancelled: { text: "Cancelled", tone: "faint" },
};

const KIND: Record<LogEntry["kind"], string> = {
  approve: "Approve",
  "bot-command": "Bot command",
  review: "Review",
  reply: "Reply",
  comment: "Comment",
  resolve: "Resolve thread",
  unresolve: "Reopen thread",
  viewed: "Mark viewed",
  unviewed: "Mark unviewed",
};

export function Log() {
  const { data: entries = [] } = useQuery(q("log", { limit: 300 }));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-end gap-3 px-8 pb-3">
        <h1 className="text-title font-semibold text-strong">Log</h1>
      </header>
      {entries.length === 0 ? (
        <p className="px-8 pt-16 text-prose text-muted">Nothing has been sent yet.</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
          {entries.map((entry) => (
            <li
              key={entry.commandId}
              className="grid grid-cols-[16px_110px_96px_minmax(0,1fr)_minmax(0,1.2fr)_48px] items-baseline gap-x-4 border-b border-line py-2.5 text-meta"
            >
              <Dot tone={STATE[entry.state].tone} />
              <span className="text-muted">{STATE[entry.state].text}</span>
              <span className="text-faint">{KIND[entry.kind]}</span>
              <span className="truncate">
                <span className="font-code text-fg">
                  {shortRepo(entry.target.repo)}#{entry.target.number}
                </span>
                <span className="ml-2 text-faint">{entry.target.title}</span>
              </span>
              <span className={entry.state === "failed" ? "text-bad" : "text-faint"}>
                {entry.detail ?? `as ${entry.account}`}
              </span>
              <span className="text-right text-faint">{ago(entry.updatedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
