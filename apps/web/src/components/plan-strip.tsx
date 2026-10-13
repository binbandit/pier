import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorText } from "@/features/actions";
import { useCommands } from "@/keys/registry";
import { duration, plural } from "@/lib/format";
import { rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import { Dock } from "@/ui/dock";
import { Keys } from "@/ui/kbd";
import type { PlanPreview } from "@pier/core/wire";

// The confirmation that rises out of the status line before any write. It says exactly what will
// be sent, as whom, what's skipped and why, and what it costs against GitHub's hourly limit.
// Enter sends, Esc backs out; nothing reaches GitHub until Enter.

const VERBS = {
  approve: "Approve",
  rebase: "Ask Dependabot to rebase",
  recreate: "Ask Dependabot to recreate",
} as const;

const SENDING = {
  approve: "Approving",
  rebase: "Asking Dependabot to rebase",
  recreate: "Asking Dependabot to recreate",
} as const;

export function PlanStrip({ preview, label }: { preview: PlanPreview; label: string }) {
  const client = useQueryClient();
  const close = useUi((s) => s.closePanel);
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);

  const acting = preview.steps.filter((s) => !s.skip);
  const skipped = preview.steps.filter((s) => s.skip);
  const reasons = Map.groupBy(skipped, (s) => s.skip ?? "");

  const undo = async (commandIds: string[]) => {
    const { cancelled } = await rpc("cancelCommands", { commandIds });
    toast({
      text:
        cancelled > 0
          ? `Cancelled ${plural(cancelled, "write")}`
          : "Already sent; nothing to cancel",
      tone: "neutral",
    });
    void client.invalidateQueries();
  };

  const send = async () => {
    if (busy || acting.length === 0) return;
    setBusy(true);
    try {
      const { commandIds } = await rpc("commitPlan", { planId: preview.planId });
      close();
      void client.invalidateQueries();
      toast(
        {
          // One write waits out the undo window; more go out paced, a second apart.
          text: `${SENDING[preview.action]} ${plural(commandIds.length, "PR")}${commandIds.length === 1 ? " in 5s" : ""}`,
          tone: "ok",
          undo: () => void undo(commandIds),
        },
        commandIds.length === 1 ? 5_000 : 10_000,
      );
    } catch (error) {
      setBusy(false);
      toast({ text: errorText(error), tone: "bad" });
    }
  };

  useCommands([
    {
      id: "plan.send",
      title: "Send",
      keys: ["enter", "mod+enter"],
      scope: "panel",
      hint: "send",
      inInputs: true,
      run: () => void send(),
    },
    {
      id: "plan.cancel",
      title: "Cancel",
      keys: ["escape"],
      scope: "panel",
      hint: "cancel",
      inInputs: true,
      run: close,
    },
    {
      id: "plan.skipped",
      title: "Show skipped",
      keys: ["s"],
      scope: "panel",
      run: () => setShowSkipped((v) => !v),
    },
  ]);

  return (
    <Dock label="Confirm writes">
      <div className="flex items-baseline gap-6">
        <h2 className="text-ui font-medium text-strong">
          {acting.length === 0
            ? "Nothing to send"
            : `${VERBS[preview.action]} ${plural(acting.length, "PR")}`}
          <span className="ml-2 font-normal text-muted">{label}</span>
        </h2>
        {acting.length > 0 && (
          <p className="text-meta text-muted">
            {preview.perAccount
              .map(
                (a) =>
                  `${plural(a.writes, "write")} as ${a.account}, ${hourShare(a.hourShare)} of this hour`,
              )
              .join("; ")}
            . About {duration(preview.etaSeconds)}.
          </p>
        )}
        <span className="ml-auto flex items-center gap-4 text-meta text-faint">
          <span className="flex items-center gap-1.5">
            <Keys sequence="enter" /> {busy ? "Sending" : "Send"}
          </span>
          <span className="flex items-center gap-1.5">
            <Keys sequence="escape" /> Cancel
          </span>
        </span>
      </div>

      {preview.warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-meta text-warn">
          {preview.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {skipped.length > 0 && (
        <div className="mt-2 text-meta text-faint">
          <button
            type="button"
            onClick={() => setShowSkipped((v) => !v)}
            className="hover:text-muted"
          >
            Skipping {plural(skipped.length, "PR")}:{" "}
            {[...reasons].map(([reason, steps]) => `${reason} (${steps.length})`).join(", ")}
          </button>
          {showSkipped && (
            <ul className="mt-1 max-h-32 overflow-y-auto">
              {skipped.map((s) => (
                <li key={s.prId} className="flex gap-3">
                  <span className="font-code text-muted">
                    {s.repo}#{s.number}
                  </span>
                  <span>{s.skip}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dock>
  );
}

// Any write takes some of the hour, so a small share reads "under 1%", never "0%".
function hourShare(share: number): string {
  const percent = Math.round(share * 100);
  return percent === 0 && share > 0 ? "under 1%" : `${percent}%`;
}
