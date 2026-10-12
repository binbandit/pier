import { useCommands, useKeys } from "@/keys/registry";
import { useUi } from "@/stores/ui";
import { Keys } from "@/ui/kbd";

/** `?`: every shortcut that works on this screen, grouped. Generated from the registry, so it can't drift. */
export function Cheatsheet() {
  const close = useUi((s) => s.closePanel);
  const commands = useKeys((s) => s.commands);
  useCommands([
    { id: "cheatsheet.close", title: "Close", keys: ["escape", "?"], scope: "panel", run: close },
  ]);

  const usable = [...commands.values()].filter((c) => c.scope !== "panel" && c.keys?.length);
  const groups = Map.groupBy(usable, (c) => c.group ?? (c.hidden ? "Movement" : "This screen"));

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
        className="relative m-0 max-h-[76vh] w-[760px] overflow-y-auto rounded-md border border-line-strong bg-raise p-6 text-fg motion-safe:animate-[rise_120ms_var(--ease-out)]"
      >
        <h2 className="mb-5 text-section font-semibold text-strong">Keys</h2>
        <div className="grid grid-cols-2 gap-x-10 gap-y-6">
          {[...groups].map(([group, list]) => (
            <section key={group}>
              <h3 className="mb-2 text-meta text-faint">{group}</h3>
              <ul className="space-y-1.5">
                {list.map((c) => (
                  <li key={c.id} className="flex items-center gap-3">
                    <span className="flex-1 text-fg">{c.title}</span>
                    <span className="flex gap-1.5">
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
