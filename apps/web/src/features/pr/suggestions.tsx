import { useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";

import { errorText } from "@/features/actions";
import { useCommands } from "@/keys/registry";
import { plural } from "@/lib/format";
import { rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import { Dock } from "@/ui/dock";
import { Keys } from "@/ui/kbd";
import { suggestionIn } from "@pier/core/suggestion";
import type { PrView, Thread, ThreadComment } from "@pier/core/wire";

// Committing review suggestions, raised with Shift+S or a comment's "Apply suggestion": every
// suggestion that can still apply, the ones to commit checked, and one commit for all of them.
// It waits five seconds before going, so `z` can take it back.

export type Applicable = { thread: Thread; comment: ThreadComment; lines: string[] };

/** The suggestions on this PR that can go in as written: on the latest code, open, unchanged. */
export function applicableSuggestions(pr: PrView): Applicable[] {
  if (!pr.canApplySuggestions) return [];
  return pr.threads.flatMap((thread) =>
    thread.resolved || thread.outdated || thread.line === null || thread.side !== "RIGHT"
      ? []
      : thread.comments.flatMap((comment) => {
          const lines = suggestionIn(comment.body);
          return lines ? [{ thread, comment, lines }] : [];
        }),
  );
}

export function SuggestionsPanel({
  pr,
  initial,
  onClose,
}: {
  pr: PrView;
  initial: string[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  const suggestions = applicableSuggestions(pr);
  const [chosen, setChosen] = useState(() => new Set(initial));
  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      suggestions.findIndex((s) => initial.includes(s.comment.id)),
    ),
  );
  const [headline, setHeadline] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const message = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) message.current?.focus();
  }, [editing]);

  const picked = suggestions.filter((s) => chosen.has(s.comment.id));
  const title =
    headline ??
    (picked.length > 1
      ? "Apply suggestions from code review"
      : "Apply suggestion from code review");

  const toggle = (id: string) =>
    setChosen((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    // Nothing checked means the one under the cursor.
    const ids =
      picked.length > 0
        ? picked.map((s) => s.comment.id)
        : [suggestions[cursor]?.comment.id].filter((id) => id !== undefined);
    if (sending || ids.length === 0 || !title.trim()) return;
    setSending(true);
    try {
      const { commandIds } = await rpc("applySuggestions", {
        prId: pr.id,
        headOid: pr.headRefOid,
        commentIds: ids,
        headline: title.trim(),
        body: "",
      });
      void client.invalidateQueries();
      toast(
        {
          text: `Applying ${plural(ids.length, "suggestion")} in 5s`,
          tone: "ok",
          undo: () => void rpc("cancelCommands", { commandIds }),
        },
        5_000,
      );
      onClose();
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
      setSending(false);
    }
  };

  useCommands([
    {
      id: "suggestions.close",
      title: "Cancel",
      keys: ["escape"],
      scope: "panel",
      inInputs: true,
      run: () => (editing ? setEditing(false) : onClose()),
    },
    {
      id: "suggestions.apply",
      title: "Commit the checked suggestions",
      keys: ["enter"],
      scope: "panel",
      inInputs: true,
      run: () => void apply(),
    },
    {
      id: "suggestions.toggle",
      title: "Check or uncheck",
      keys: ["space", "x"],
      scope: "panel",
      run: () => {
        const id = suggestions[cursor]?.comment.id;
        if (id) toggle(id);
      },
    },
    {
      id: "suggestions.down",
      title: "Next",
      keys: ["arrowdown", "j"],
      scope: "panel",
      run: () => setCursor(Math.min(cursor + 1, suggestions.length - 1)),
    },
    {
      id: "suggestions.up",
      title: "Previous",
      keys: ["arrowup", "k"],
      scope: "panel",
      run: () => setCursor(Math.max(0, cursor - 1)),
    },
    {
      id: "suggestions.message",
      title: "Edit the commit message",
      keys: ["e"],
      scope: "panel",
      run: () => setEditing(true),
    },
  ]);

  return (
    <Dock label="Apply suggestions">
      <div className="max-w-[900px]">
        <div className="mb-2 flex items-baseline gap-4">
          <h2 className="text-ui font-medium text-strong">Apply suggestions</h2>
          <span className="text-meta text-faint">
            One commit on {pr.headRefName}, as {pr.account}
          </span>
          <span className="ml-auto flex items-center gap-4 text-meta text-faint">
            <span className="flex items-center gap-1.5">
              <Keys sequence="space" /> check
            </span>
            <span className="flex items-center gap-1.5">
              <Keys sequence="enter" />{" "}
              {sending ? "applying" : `commit ${plural(Math.max(1, picked.length), "suggestion")}`}
            </span>
            <span className="flex items-center gap-1.5">
              <Keys sequence="escape" /> cancel
            </span>
          </span>
        </div>

        {suggestions.length === 0 ? (
          <p className="py-2 text-meta text-faint">
            No suggestions can apply: they're resolved, or on code that has changed since.
          </p>
        ) : (
          <ul aria-label="Suggestions" className="max-h-[36vh] overflow-y-auto">
            {suggestions.map((s, i) => {
              const on = chosen.has(s.comment.id);
              const start = s.thread.startLine ?? s.thread.line;
              return (
                <li key={s.comment.id}>
                  <button
                    type="button"
                    aria-current={i === cursor || undefined}
                    aria-pressed={on}
                    onClick={() => {
                      setCursor(i);
                      toggle(s.comment.id);
                    }}
                    className={clsx(
                      "flex h-8 w-full items-center gap-3 rounded-sm px-3 text-left text-meta",
                      i === cursor ? "bg-cursor text-strong" : "text-fg",
                    )}
                  >
                    <span
                      aria-hidden
                      className={clsx(
                        "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border text-[10px] leading-none",
                        on ? "border-accent bg-accent text-canvas" : "border-line-max",
                      )}
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span className="shrink-0 font-code text-muted">
                      {s.thread.path}:
                      {start === s.thread.line ? start : `${start}-${s.thread.line}`}
                    </span>
                    <span className="min-w-0 truncate font-code text-faint">
                      {s.lines.length === 0 ? "removes the lines" : s.lines.join(" ⏎ ").trim()}
                    </span>
                    <span className="ml-auto shrink-0 text-faint">{s.comment.author?.login}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-2 flex items-center gap-3 border-t border-line pt-2 text-meta">
          <span className="shrink-0 text-faint">Commit message</span>
          {editing ? (
            <input
              ref={message}
              value={title}
              onChange={(e) => setHeadline(e.target.value)}
              aria-label="Commit message"
              className="h-8 min-w-0 flex-1 rounded-sm border border-line-strong bg-canvas px-2 text-ui text-strong outline-none"
            />
          ) : (
            <>
              <span className="min-w-0 truncate text-fg">{title}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-faint">
                <Keys sequence="e" /> edit
              </span>
            </>
          )}
        </div>
      </div>
    </Dock>
  );
}
