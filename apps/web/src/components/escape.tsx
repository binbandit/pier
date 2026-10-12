import { useState } from "react";

import { useCommands } from "@/keys/registry";
import { rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import { Keys } from "@/ui/kbd";

// Shift+O: the escape hatch to github.com. One key says why, so missing features show up in the
// log instead of being forgotten. `?pier=0` tells the link-capture extension to let it through.

const REASONS = [
  "Something pier can't do yet",
  "Checking pier against GitHub",
  "Something else",
] as const;

export function EscapeHatch({ url }: { url: string }) {
  const close = useUi((s) => s.closePanel);
  const [note, setNote] = useState("");

  const go = (reason: string) => {
    const target = new URL(url);
    target.searchParams.set("pier", "0");
    void rpc("logEscape", { url, reason: note ? `${reason}: ${note}` : reason });
    window.open(target.toString(), "_blank", "noopener,noreferrer");
    close();
  };

  useCommands([
    {
      id: "escape.close",
      title: "Cancel",
      keys: ["escape"],
      scope: "panel",
      inInputs: true,
      run: close,
    },
    ...REASONS.map((reason, i) => ({
      id: `escape.${i + 1}`,
      title: reason,
      keys: [`${i + 1}`],
      scope: "panel" as const,
      run: () => go(reason),
    })),
    {
      id: "escape.go",
      title: "Open",
      keys: ["enter"],
      scope: "panel",
      inInputs: true,
      run: () => go(note ? "Note" : REASONS[0]),
    },
  ]);

  return (
    <section
      aria-label="Open on GitHub"
      className="border-t border-line-strong bg-raise px-6 py-4 motion-safe:animate-[rise_120ms_var(--ease-out)]"
    >
      <div className="flex items-baseline gap-6">
        <h2 className="text-ui font-medium text-strong">Open on github.com</h2>
        <span className="truncate font-code text-meta text-faint">
          {url.replace("https://github.com/", "")}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-5 text-meta text-muted">
        {REASONS.map((reason, i) => (
          <button
            key={reason}
            type="button"
            onClick={() => go(reason)}
            className="flex items-center gap-1.5 hover:text-fg"
          >
            <Keys sequence={`${i + 1}`} /> {reason}
          </button>
        ))}
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Or say what's missing, then Enter"
          className="h-7 min-w-[280px] flex-1 rounded-sm border border-line-strong bg-transparent px-2 text-meta text-fg outline-none placeholder:text-faint focus:border-accent"
        />
      </div>
    </section>
  );
}
