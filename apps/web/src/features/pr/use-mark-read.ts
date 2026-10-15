import { useEffect } from "react";

import { rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import type { PrView } from "@pier/core/wire";

/** Prefetches and background tabs must leave unseen activity alone. */
export function useMarkPrRead(pr: PrView) {
  const { id, account, activityCursor } = pr;
  const toast = useUi((s) => s.toast);
  useEffect(() => {
    let marked = false;
    let pending = false;
    const mark = () => {
      if (!activityCursor || document.visibilityState !== "visible" || marked || pending) return;
      pending = true;
      void rpc("markPrRead", { prId: id, account, cursor: activityCursor })
        .then(() => {
          marked = true;
          return undefined;
        })
        .catch(() =>
          toast({ text: "Couldn't mark this PR as read. Reopen it to try again.", tone: "bad" }),
        )
        .finally(() => {
          pending = false;
        });
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [id, account, activityCursor, toast]);
}
