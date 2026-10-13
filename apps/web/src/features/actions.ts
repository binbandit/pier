import type { QueryClient } from "@tanstack/react-query";

import { rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import type { ActionKind } from "@pier/core/wire";

// Actions shared across surfaces. Writes always go through a plan the user sees first; nothing
// here sends anything to GitHub directly.

export async function propose(
  action: ActionKind,
  prIds: string[],
  label: string,
  groupKey?: string,
): Promise<void> {
  if (prIds.length === 0) {
    useUi.getState().toast({ text: "Nothing to act on here", tone: "neutral" });
    return;
  }
  try {
    const preview = await rpc(
      "planAction",
      groupKey ? { action, prIds, groupKey } : { action, prIds },
    );
    useUi.getState().openPanel({ kind: "plan", preview, label });
  } catch (error) {
    useUi.getState().toast({ text: errorText(error), tone: "bad" });
  }
}

export async function markDone(client: QueryClient, keys: string[], label: string): Promise<void> {
  const { commandIds } = await rpc("markDone", { keys });
  void client.invalidateQueries({ queryKey: ["inbox"] });
  useUi.getState().toast({
    text: label,
    tone: "neutral",
    undo: () => {
      // Undo also stops the GitHub notifications being cleared (they're held until the toast goes).
      if (commandIds.length > 0) void rpc("cancelCommands", { commandIds });
      void rpc("undoDone", { keys }).then(() => client.invalidateQueries({ queryKey: ["inbox"] }));
    },
  });
}

export function openOnGitHub(url: string): void {
  useUi.getState().openPanel({ kind: "escape", url });
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
