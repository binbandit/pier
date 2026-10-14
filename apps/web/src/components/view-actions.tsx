import { ContextMenu } from "@base-ui/react/context-menu";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { type ReactElement, useLayoutEffect, useRef, useState } from "react";

import { errorText } from "@/features/actions";
import { useCommands } from "@/keys/registry";
import { rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import type { SavedView } from "@pier/core/wire";

export function ViewActions({
  view,
  active,
  children,
}: {
  view: SavedView;
  active: boolean;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [keyboardAnchor, setKeyboardAnchor] = useState(false);
  const trigger = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  const naming = name !== null;

  useLayoutEffect(() => {
    if (naming) {
      input.current?.focus();
      input.current?.select();
    }
  }, [naming]);

  const cancel = () => {
    if (pending) return;
    setName(null);
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };

  // A menu or name editor owns the keys while it's open, just like pier's other panels.
  useCommands(
    open || naming
      ? [
          {
            id: `view.${view.id}.cancel`,
            title: "Cancel view action",
            keys: ["escape"],
            scope: "panel",
            inInputs: true,
            hidden: true,
            run: cancel,
          },
        ]
      : [],
  );

  const rename = async () => {
    const trimmed = name?.trim();
    if (!trimmed || pending) return;
    if (trimmed === view.name) {
      cancel();
      return;
    }
    setPending(true);
    try {
      await rpc("saveView", { id: view.id, name: trimmed, query: view.query });
      await client.invalidateQueries({ queryKey: ["views"] });
      setName(null);
      toast({ text: `Renamed to ${trimmed}`, tone: "ok" });
      requestAnimationFrame(() => trigger.current?.focus());
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (pending) return;
    setPending(true);
    try {
      await rpc("deleteView", { id: view.id });
      if (active) await navigate({ to: "/search", search: { q: view.query } });
      await client.invalidateQueries({ queryKey: ["views"] });
      toast({ text: `Deleted ${view.name}`, tone: "ok" });
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    } finally {
      setPending(false);
    }
  };

  return (
    <ContextMenu.Root open={open} onOpenChange={setOpen}>
      {naming ? (
        <form
          className="flex h-8 items-center gap-1 rounded-sm border border-line-max bg-canvas px-1"
          aria-label="Rename view"
          onSubmit={(event) => {
            event.preventDefault();
            void rename();
          }}
        >
          <input
            ref={input}
            aria-label="View name"
            title="Enter to save, Escape to cancel"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") cancel();
            }}
            readOnly={pending}
            className="min-w-0 flex-1 bg-transparent px-1 text-ui text-strong outline-none"
          />
          <button
            type="submit"
            aria-label="Save view name"
            disabled={pending || !name.trim()}
            className="rounded-sm p-1 text-muted hover:bg-hover hover:text-strong disabled:opacity-40"
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            aria-label="Cancel rename"
            disabled={pending}
            onClick={cancel}
            className="rounded-sm p-1 text-muted hover:bg-hover hover:text-strong disabled:opacity-40"
          >
            <X size={14} />
          </button>
        </form>
      ) : (
        <ContextMenu.Trigger
          ref={trigger}
          render={children}
          aria-haspopup="menu"
          aria-expanded={open}
          onContextMenu={() => setKeyboardAnchor(false)}
          onKeyDown={(event) => {
            if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
            event.preventDefault();
            event.stopPropagation();
            setKeyboardAnchor(true);
            setOpen(true);
          }}
        />
      )}
      <ContextMenu.Portal>
        <ContextMenu.Positioner
          anchor={keyboardAnchor ? trigger : undefined}
          sideOffset={4}
          className="z-50"
        >
          <ContextMenu.Popup
            aria-label={`Actions for ${view.name}`}
            finalFocus={naming ? input : trigger}
            onKeyDown={(event) => event.stopPropagation()}
            className="min-w-40 rounded-md border border-line-strong bg-raise p-1 shadow-xl outline-none"
          >
            <ContextMenu.Item
              disabled={pending}
              onClick={() => setName(view.name)}
              className="flex cursor-default items-center gap-2 rounded-sm px-3 py-1.5 text-ui text-fg outline-none data-disabled:opacity-40 data-highlighted:bg-cursor"
            >
              <Pencil size={14} aria-hidden /> Rename
            </ContextMenu.Item>
            <ContextMenu.Item
              disabled={pending}
              onClick={() => void remove()}
              className="flex cursor-default items-center gap-2 rounded-sm px-3 py-1.5 text-ui text-bad outline-none data-disabled:opacity-40 data-highlighted:bg-cursor"
            >
              <Trash2 size={14} aria-hidden /> Delete
            </ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
