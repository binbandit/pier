import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { errorText } from "@/features/actions";
import { useCommands } from "@/keys/registry";
import { rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import { Dock } from "@/ui/dock";
import { Keys } from "@/ui/kbd";
import type { PrView } from "@pier/core/wire";

// Reverting a merged PR, raised with `s v`: GitHub opens a new PR that takes this one back out.
// Enter opens it, and pier goes to it once GitHub says which number it got.

export function RevertPanel({ pr, onClose }: { pr: PrView; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useUi((s) => s.toast);
  const [title, setTitle] = useState(`Revert "${pr.title}"`);
  const [opening, setOpening] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const open = async () => {
    if (opening || !title.trim()) return;
    setOpening(true);
    try {
      const {
        commandIds: [commandId],
      } = await rpc("revert", { prId: pr.id, title: title.trim() });
      if (!commandId) return;
      // The write goes through the outbox; wait for GitHub's answer to know the new number.
      for (let i = 0; i < 40; i++) {
        const outcome = await rpc("commandResult", { commandId });
        if (outcome?.state === "acked" && isRevert(outcome.result)) {
          const [owner = "", repo = ""] = pr.repo.split("/");
          onClose();
          void navigate({
            to: "/$owner/$repo/pull/$number",
            params: { owner, repo, number: outcome.result.number },
          });
          return;
        }
        if (outcome?.state === "failed" || outcome?.state === "cancelled") {
          throw new Error(outcome.detail ?? "GitHub didn't open the revert");
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error("The revert is taking a while; it'll show up under Mine when it opens");
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
      setOpening(false);
    }
  };

  useCommands([
    {
      id: "revert.close",
      title: "Cancel",
      keys: ["escape"],
      scope: "panel",
      inInputs: true,
      run: onClose,
    },
    {
      id: "revert.open",
      title: "Open the revert PR",
      keys: ["enter"],
      scope: "panel",
      inInputs: true,
      run: () => void open(),
    },
  ]);

  return (
    <Dock label="Revert">
      <div className="max-w-[900px]">
        <div className="mb-2 flex items-baseline gap-4">
          <h2 className="text-ui font-medium text-strong">Revert this PR</h2>
          <span className="text-meta text-faint">
            Opens a new PR that takes {pr.repo.split("/")[1]}#{pr.number}'s changes back out of{" "}
            {pr.baseRefName}.
          </span>
          <span className="ml-auto flex items-center gap-4 text-meta text-faint">
            <span className="flex items-center gap-1.5">
              <Keys sequence="enter" /> {opening ? "opening" : "open it"}
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
          aria-label="Title of the revert PR"
          disabled={opening}
          className="h-10 w-full rounded-sm border border-line-strong bg-canvas px-3 text-ui text-strong outline-none"
        />
      </div>
    </Dock>
  );
}

function isRevert(result: unknown): result is { number: number; url: string } {
  return (
    typeof result === "object" &&
    result !== null &&
    "number" in result &&
    typeof result.number === "number"
  );
}
