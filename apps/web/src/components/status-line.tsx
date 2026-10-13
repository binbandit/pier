import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { activeCommands, useKeys } from "@/keys/registry";
import { useConnection } from "@/lib/events";
import { ago, plural } from "@/lib/format";
import { q } from "@/lib/rpc";
import { Avatar } from "@/ui/avatar";
import { Dot } from "@/ui/dot";
import { Keys } from "@/ui/kbd";

// The 28px line along the bottom: who you're acting as, how fresh the data is, what's queued to
// send, and which keys do something right now. While a chord is half-typed it lists what can
// follow, like which-key.

export function StatusLine() {
  const { data: status } = useQuery(q("status", {}));
  const connected = useConnection((s) => s.connected);
  const commands = useKeys((s) => s.commands);
  const pending = useKeys((s) => s.pending);
  const now = useNow(5_000);

  const active = activeCommands(commands);
  const continuations = pending
    ? active.flatMap((c) =>
        (c.keys ?? [])
          .filter((k) => k.startsWith(`${pending} `))
          .map((k) => ({ key: k.slice(pending.length + 1), title: c.title })),
      )
    : [];
  const hints = active.filter((c) => c.hint && c.keys?.[0]);

  const sync = status?.sync;
  const outbox = status?.outbox;
  const sending = (outbox?.queued ?? 0) + (outbox?.held ?? 0);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-5 border-t border-line px-4 text-meta text-faint">
      <span className="flex items-center gap-1.5">
        {status?.accounts.map((account) => (
          <Avatar
            key={account.login}
            login={account.login}
            url={account.avatarUrl}
            size={14}
            className={account.ok ? "" : "opacity-40"}
          />
        ))}
      </span>

      <span className="flex items-center gap-2">
        {!connected ? (
          <>
            <Dot tone="bad" />
            <span className="text-bad">Daemon offline</span>
          </>
        ) : sync?.state === "error" ? (
          <>
            <Dot tone="bad" />
            <span className="max-w-[40ch] truncate text-bad" title={sync.message ?? ""}>
              {sync.message}
            </span>
          </>
        ) : sync?.message ? (
          <>
            <Dot tone="auto" />
            <span>{sync.message}</span>
          </>
        ) : (
          <span>{sync?.lastSyncAt ? syncedText(sync.lastSyncAt, now) : "Starting"}</span>
        )}
      </span>

      {sending > 0 && (
        <span className="flex items-center gap-2 text-auto">
          <Dot tone="auto" />
          Sending {plural(sending, "write")}
        </span>
      )}
      {(outbox?.waiting ?? 0) > 0 && (
        <span className="text-auto">
          {plural(outbox?.waiting ?? 0, "approval")} waiting their turn
        </span>
      )}
      {(outbox?.failed ?? 0) > 0 && (
        <Link to="/log" className="text-bad hover:underline">
          {plural(outbox?.failed ?? 0, "write")} failed
        </Link>
      )}

      <span className="ml-auto flex items-center gap-4">
        {pending ? (
          <>
            <Keys sequence={pending} />
            {continuations.map((c) => (
              <span key={c.key} className="flex items-center gap-1.5">
                <Keys sequence={c.key} />
                <span className="text-muted">{c.title}</span>
              </span>
            ))}
          </>
        ) : (
          <>
            {hints.map((c) => (
              <span key={c.id} className="flex items-center gap-1.5">
                <Keys sequence={c.keys![0]!} />
                <span>{c.hint}</span>
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <Keys sequence="?" />
              <span>keys</span>
            </span>
          </>
        )}
      </span>
    </footer>
  );
}

function syncedText(iso: string, now: number): string {
  const age = ago(iso, now);
  return age === "now" ? "Synced just now" : `Synced ${age} ago`;
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
