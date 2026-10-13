import { useNavigate } from "@tanstack/react-router";
import { clsx } from "clsx";
import { useState } from "react";

import { type Command, activeCommands, useCommands, useKeys } from "@/keys/registry";
import { useUi } from "@/stores/ui";
import { Keys } from "@/ui/kbd";

// Cmd+K: every command by name, plus "paste any github.com PR link and press Enter". Pier's URLs
// mirror GitHub's paths, so a pasted link opens the same PR here.

type Entry = {
  id: string;
  title: string;
  detail?: string | undefined;
  keys?: string | undefined;
  run: () => void;
};

export function Palette() {
  const close = useUi((s) => s.closePanel);
  const navigate = useNavigate();
  const commands = useKeys((s) => s.commands);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  // Commands from the surface underneath the palette, not the palette's own.
  const available = activeCommands(
    new Map([...commands].filter(([, c]) => c.scope !== "panel")),
  ).filter((c) => !c.hidden);
  const entries: Entry[] = [];
  const link = githubLink(query);
  if (link)
    entries.push({
      id: "open-link",
      title: `Open ${link.path.slice(1)}${link.hash ? " at the linked lines" : ""}`,
      run: () => void navigate({ to: link.path, hash: link.hash }),
    });
  entries.push(
    ...rank(available, query).map((c) => ({
      id: c.id,
      title: c.title,
      detail: c.group,
      keys: c.keys?.[0],
      run: c.run,
    })),
  );
  const index = Math.min(cursor, Math.max(0, entries.length - 1));

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    close();
    // Let the palette unmount (and release its keys) before the command runs.
    queueMicrotask(entry.run);
  };

  useCommands([
    {
      id: "palette.close",
      title: "Close",
      keys: ["escape"],
      scope: "panel",
      inInputs: true,
      run: close,
    },
    {
      id: "palette.down",
      title: "Next",
      keys: ["arrowdown", "ctrl+n"],
      scope: "panel",
      inInputs: true,
      run: () => setCursor(index + 1),
    },
    {
      id: "palette.up",
      title: "Previous",
      keys: ["arrowup", "ctrl+p"],
      scope: "panel",
      inInputs: true,
      run: () => setCursor(Math.max(0, index - 1)),
    },
    {
      id: "palette.run",
      title: "Run",
      keys: ["enter"],
      scope: "panel",
      inInputs: true,
      run: () => choose(entries[index]),
    },
  ]);

  return (
    <div className="fixed inset-0 z-50 flex justify-center pt-[14vh]">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={close}
        className="absolute inset-0 cursor-default bg-canvas/60"
      />
      <dialog
        open
        aria-label="Command palette"
        className="relative m-0 flex max-h-[60vh] w-[640px] flex-col overflow-hidden rounded-md border border-line-strong bg-raise text-fg motion-safe:animate-[rise_120ms_var(--ease-out)]"
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          placeholder="Type a command, or paste a GitHub link"
          className="h-12 border-b border-line bg-transparent px-4 text-ui text-strong outline-none placeholder:text-faint"
        />
        <ul className="overflow-y-auto py-1">
          {entries.length === 0 && (
            <li className="px-4 py-3 text-faint">No command matches “{query}”</li>
          )}
          {entries.map((entry, i) => (
            <li key={entry.id}>
              <button
                type="button"
                onMouseMove={() => setCursor(i)}
                onClick={() => choose(entry)}
                className={clsx(
                  "flex h-9 w-full items-center gap-3 px-4 text-left",
                  i === index ? "bg-cursor text-strong" : "text-fg",
                )}
              >
                <span className="flex-1 truncate">{entry.title}</span>
                {entry.detail && <span className="text-meta text-faint">{entry.detail}</span>}
                {entry.keys && <Keys sequence={entry.keys} />}
              </button>
            </li>
          ))}
        </ul>
      </dialog>
    </div>
  );
}

/** `https://github.com/o/r/pull/12/files#x` → `/o/r/pull/12`. */
export function githubPath(text: string): string | null {
  return githubLink(text)?.path ?? null;
}

/** A github.com PR link as a pier path, keeping a line anchor (`#diff-…R12`) when it has one. */
export function githubLink(text: string): { path: string; hash: string } | null {
  const m =
    /^\s*(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)[^#\s]*(?:#(\S*))?/i.exec(
      text,
    );
  return m ? { path: `/${m[1]}/${m[2]}/pull/${m[3]}`, hash: m[4] ?? "" } : null;
}

/** Subsequence match, preferring matches at word starts and earlier positions. */
function rank(commands: Command[], query: string): Command[] {
  const needle = query.trim().toLowerCase();
  if (!needle)
    return commands.toSorted(
      (a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.title.localeCompare(b.title),
    );
  const scored = commands.flatMap((command) => {
    const hay = command.title.toLowerCase();
    let score = 0;
    let from = 0;
    for (const char of needle) {
      const at = hay.indexOf(char, from);
      if (at === -1) return [];
      score += at === 0 || hay[at - 1] === " " ? 3 : at === from ? 2 : 1;
      from = at + 1;
    }
    return [{ command, score: score - from * 0.01 }];
  });
  return scored.toSorted((a, b) => b.score - a.score).map((s) => s.command);
}
