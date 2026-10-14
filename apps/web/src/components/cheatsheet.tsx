import { useState } from "react";

import { displayKeys, useCommands, useKeys } from "@/keys/registry";
import { useUi } from "@/stores/ui";
import { Keys } from "@/ui/kbd";

/** `?`: every shortcut that works on this screen, grouped. Generated from the registry, so it can't drift. */
export function Cheatsheet() {
  const close = useUi((s) => s.closePanel);
  const commands = useKeys((s) => s.commands);
  const [query, setQuery] = useState("");
  useCommands([
    {
      id: "cheatsheet.close",
      title: "Close",
      keys: ["escape"],
      scope: "panel",
      inInputs: true,
      run: close,
    },
    { id: "cheatsheet.toggle", title: "Close", keys: ["?"], scope: "panel", run: close },
  ]);

  const terms = query.trim().toLowerCase().split(/\s+/);
  const usable = [...commands.values()].filter((c) => c.scope !== "panel" && c.keys?.length);
  const groups = Map.groupBy(usable, (c) => c.group ?? (c.hidden ? "Movement" : "This screen"));
  const matches = [...groups].flatMap(([group, list]) => {
    const matching = list.filter((command) => {
      const text = [
        command.title,
        group,
        ...(command.keys ?? []),
        ...(command.keys ?? []).flatMap(displayKeys),
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((term) => text.includes(term));
    });
    return matching.length ? [{ group, list: matching }] : [];
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={close}
        className="absolute inset-0 cursor-default bg-canvas/70"
      />
      <dialog
        open
        aria-label="Keyboard shortcuts"
        className="relative m-0 flex max-h-[76vh] w-[760px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-md border border-line-strong bg-raise text-fg motion-safe:animate-[rise_120ms_var(--ease-out)]"
      >
        <div className="shrink-0 border-b border-line p-6 pb-4">
          <h2 className="mb-4 text-section font-semibold text-strong">Keys</h2>
          <input
            autoFocus
            aria-label="Search shortcuts"
            placeholder="Search commands, sections or keys"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 w-full rounded-sm border border-line-strong bg-canvas px-3 text-ui text-strong outline-none placeholder:text-faint focus:border-accent"
          />
        </div>
        <div className="grid min-h-0 grid-cols-1 gap-x-10 gap-y-6 overflow-y-auto p-6 sm:grid-cols-2">
          {matches.length === 0 && (
            <p role="status" className="col-span-full text-faint">
              No shortcuts match “{query.trim()}”
            </p>
          )}
          {matches.map(({ group, list }) => (
            <section key={group}>
              <h3 className="mb-2 text-meta text-faint">{group}</h3>
              <ul className="space-y-1.5">
                {list.map((c) => (
                  <li key={c.id} className="flex items-center gap-3">
                    <span className="flex-1 text-fg">{c.title}</span>
                    <span className="flex shrink-0 gap-1.5">
                      {c.keys?.slice(0, 2).map((k) => (
                        <Keys key={k} sequence={k} />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </dialog>
    </div>
  );
}
