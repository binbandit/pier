import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { errorText } from "@/features/actions";
import { useCommands } from "@/keys/registry";
import { rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import { Dock } from "@/ui/dock";
import { Keys } from "@/ui/kbd";
import type { PrView } from "@pier/core/wire";

// Renaming a PR, raised with `s e`: the title in a box, Enter saves, Esc leaves it as it was.

export function TitlePanel({ pr, onClose }: { pr: PrView; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [title, setTitle] = useState(pr.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);

  const save = async () => {
    const next = title.trim();
    onClose();
    if (!next || next === pr.title) return;
    const send = (value: string) => rpc("editPr", { prId: pr.id, title: value });
    try {
      await send(next);
      void client.invalidateQueries();
      toast({ text: "Renamed", tone: "ok", undo: () => void send(pr.title) }, 6_000);
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };

  useCommands([
    {
      id: "title.close",
      title: "Cancel",
      keys: ["escape"],
      scope: "panel",
      inInputs: true,
      run: onClose,
    },
    {
      id: "title.save",
      title: "Save",
      keys: ["enter"],
      scope: "panel",
      inInputs: true,
      run: () => void save(),
    },
  ]);

  return (
    <Dock label="Edit title">
      <div className="max-w-[900px]">
        <div className="mb-2 flex items-baseline gap-4">
          <h2 className="text-ui font-medium text-strong">Title</h2>
          <span className="ml-auto flex items-center gap-4 text-meta text-faint">
            <span className="flex items-center gap-1.5">
              <Keys sequence="enter" /> save
            </span>
            <span className="flex items-center gap-1.5">
              <Keys sequence="escape" /> cancel
            </span>
          </span>
        </div>
        <input
          ref={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Title"
          disabled={!pr.canEdit}
          className="h-10 w-full rounded-sm border border-line-strong bg-canvas px-3 text-ui text-strong outline-none"
        />
        {!pr.canEdit && (
          <p className="mt-2 text-meta text-faint">
            Only the author and people who can write to the repo can rename it.
          </p>
        )}
      </div>
    </Dock>
  );
}
