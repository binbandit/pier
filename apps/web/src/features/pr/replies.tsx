import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";

import { errorText } from "@/features/actions";
import { useCommands } from "@/keys/registry";
import { q, rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import { Keys } from "@/ui/kbd";

// Replies you write often, from any comment box with Ctrl+. (GitHub's key): type to narrow,
// Enter puts one in at the cursor. What you've written can be kept as a new one, and your
// GitHub saved replies brought over (that needs the read:user scope).

type Row =
  | { kind: "reply"; id: string; title: string; body: string }
  | { kind: "save" }
  | { kind: "import" };

export function SavedReplies({
  written,
  onInsert,
  onClose,
}: {
  /** What's in the box now, offered to keep as a reply. */
  written: string;
  onInsert: (body: string) => void;
  onClose: () => void;
}) {
  const toast = useUi((s) => s.toast);
  const { data: replies = [] } = useQuery(q("replies", {}));
  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const needle = filter.trim().toLowerCase();
  const rows: Row[] = [
    ...replies
      .filter((r) => !needle || `${r.title} ${r.body}`.toLowerCase().includes(needle))
      .map((r) => ({ kind: "reply" as const, ...r })),
    ...(written.trim() ? [{ kind: "save" as const }] : []),
    { kind: "import" as const },
  ];
  const index = Math.min(cursor, rows.length - 1);

  const choose = async (row: Row | undefined) => {
    if (!row) return;
    try {
      if (row.kind === "reply") {
        onInsert(row.body);
        return;
      }
      if (row.kind === "save") {
        // Its first line names it; the list shows titles.
        const title = written.trim().split("\n")[0]?.slice(0, 60) ?? "Reply";
        await rpc("saveReply", { title, body: written.trim() });
        toast({ text: `Saved “${title}” as a reply`, tone: "ok" });
        onClose();
        return;
      }
      const { added } = await rpc("importReplies", {});
      toast({
        text:
          added > 0 ? `Brought ${added} saved replies over from GitHub` : "Nothing new on GitHub",
        tone: "ok",
      });
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };

  const remove = async () => {
    const row = rows[index];
    if (row?.kind !== "reply") return;
    await rpc("deleteReply", { id: row.id });
    toast({ text: `Deleted “${row.title}”`, tone: "neutral" });
  };

  useCommands([
    {
      id: "replies.close",
      title: "Close saved replies",
      keys: ["escape"],
      scope: "panel",
      inInputs: true,
      run: onClose,
    },
    {
      id: "replies.choose",
      title: "Use this reply",
      keys: ["enter"],
      scope: "panel",
      inInputs: true,
      run: () => void choose(rows[index]),
    },
    {
      id: "replies.down",
      title: "Next",
      keys: ["arrowdown"],
      scope: "panel",
      inInputs: true,
      run: () => setCursor(Math.min(index + 1, rows.length - 1)),
    },
    {
      id: "replies.up",
      title: "Previous",
      keys: ["arrowup"],
      scope: "panel",
      inInputs: true,
      run: () => setCursor(Math.max(0, index - 1)),
    },
    {
      id: "replies.delete",
      title: "Delete this saved reply",
      keys: ["mod+backspace"],
      scope: "panel",
      inInputs: true,
      run: () => void remove(),
    },
  ]);

  return (
    <div className="border-t border-line px-3 py-2 font-ui">
      <div className="mb-1 flex items-center gap-3 text-meta text-faint">
        <input
          ref={input}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setCursor(0);
          }}
          aria-label="Find a saved reply"
          placeholder="Saved replies"
          className="h-7 min-w-0 flex-1 bg-transparent text-ui text-strong outline-none placeholder:text-faint"
        />
        <span className="flex items-center gap-1.5">
          <Keys sequence="enter" /> use
        </span>
        <span className="flex items-center gap-1.5">
          <Keys sequence="mod+backspace" /> delete
        </span>
      </div>
      <ul aria-label="Saved replies" className="max-h-[220px] overflow-y-auto">
        {rows.map((row, i) => (
          <li key={row.kind === "reply" ? row.id : row.kind}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void choose(row)}
              className={clsx(
                "flex h-8 w-full items-center gap-3 rounded-sm px-2 text-left text-meta",
                i === index ? "bg-cursor text-strong" : "text-fg",
              )}
            >
              {row.kind === "reply" ? (
                <>
                  <span className="shrink-0">{row.title}</span>
                  <span className="min-w-0 truncate text-faint">{row.body}</span>
                </>
              ) : row.kind === "save" ? (
                <span className="text-muted">Save what you've written as a reply</span>
              ) : (
                <span className="text-muted">Bring your saved replies over from GitHub</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
