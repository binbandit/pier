import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { ago, shortRepo } from "@/lib/format";
import { q, rpc } from "@/lib/rpc";
import { Dot, type Tone } from "@/ui/dot";
import type { LogEntry, OutboxState } from "@pier/core/wire";

// Every write pier has made or is about to make, newest first. When something fails, this is
// where it says what GitHub answered; once it's been seen here, the status line stops counting it.

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
  "notification-done": "Clear notification",
  "rerun-failed": "Re-run failed jobs",
  merge: "Merge",
  "auto-merge": "Auto-merge",
  "update-branch": "Update branch",
  labels: "Labels",
  assignees: "Assignees",
  reviewers: "Reviewers",
  milestone: "Milestone",
  draft: "Draft / ready",
  close: "Close",
  reopen: "Reopen",
  react: "Reaction",
  "edit-comment": "Edit",
  "delete-comment": "Delete comment",
  minimize: "Hide comment",
  "edit-pr": "Edit PR",
  "dismiss-review": "Dismiss review",
  lock: "Lock",
  "rerun-all": "Re-run all jobs",
  "rerun-job": "Re-run job",
  "cancel-run": "Cancel run",
  "approve-run": "Approve workflow",
  "approve-deployment": "Approve deployment",
  enqueue: "Merge queue",
  dequeue: "Leave merge queue",
  "delete-branch": "Delete branch",
  "restore-branch": "Restore branch",
  revert: "Revert",
  suggestions: "Suggestions",
  subscription: "Notifications",
  "notification-read": "Mark read",
};

export function Log() {
  const { data: entries = [] } = useQuery(q("log", { limit: 300 }));
  // Any entry changing (a failure arriving while you're here) counts as seen too.
  const latest = entries.reduce((max, e) => (e.updatedAt > max ? e.updatedAt : max), "");
  useEffect(() => {
    if (latest) void rpc("seenLog", {});
  }, [latest]);
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
