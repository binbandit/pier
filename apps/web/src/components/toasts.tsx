import { clsx } from "clsx";

import { useCommands } from "@/keys/registry";
import { useUi } from "@/stores/ui";
import { Keys } from "@/ui/kbd";

/** Confirmations sit just above the status line. `z` undoes the newest one that can be undone. */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const undoable = toasts.findLast((t) => t.undo);

  useCommands(
    undoable
      ? [
          {
            id: "toast.undo",
            title: "Undo",
            keys: ["z", "mod+z"],
            scope: "global",
            group: "General",
            run: () => {
              undoable.undo?.();
              dismiss(undoable.id);
            },
          },
        ]
      : [],
  );

  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-10 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            "pointer-events-auto flex items-center gap-4 rounded-md border border-line-strong bg-raise px-4 py-2.5 text-ui motion-safe:animate-[rise_120ms_var(--ease-out)]",
            t.tone === "bad" ? "text-bad" : t.tone === "ok" ? "text-fg" : "text-muted",
          )}
        >
          <span className="max-w-[56ch]">{t.text}</span>
          {t.undo && (
            <button
              type="button"
              className="flex items-center gap-1.5 text-meta text-muted hover:text-fg"
              onClick={() => {
                t.undo?.();
                dismiss(t.id);
              }}
            >
              <Keys sequence="z" /> Undo
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
