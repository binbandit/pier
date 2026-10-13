import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { shortRepo } from "@/lib/format";
import { q } from "@/lib/rpc";
import { usePrefs } from "@/stores/prefs";
import type { PrItem, QueueItem } from "@pier/core/wire";

// What reaches you outside the window: the dock badge counts PRs where it's your turn (Review and
// Mine; bumps are chores to batch, not interruptions), and with notifications on, a PR that
// becomes your turn while pier is in the background says so.

/** At most this many notifications at once; a burst after a long sleep is a glance at pier. */
const BURST = 3;

export function useTurnSignals(): void {
  const navigate = useNavigate();
  const notify = usePrefs((s) => s.notify);
  const { data: review } = useQuery(q("inbox", { split: "review" }));
  const { data: mine } = useQuery(q("inbox", { split: "mine" }));
  // Null until the first answer, so what's already waiting at start-up doesn't notify.
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!review || !mine) return;
    const turns = [...review, ...mine].filter(
      (item: QueueItem): item is PrItem => item.kind === "pr",
    );
    void (turns.length > 0 ? navigator.setAppBadge?.(turns.length) : navigator.clearAppBadge?.())
      // Outside an installed window there's no badge to set.
      ?.catch(() => undefined);

    const before = seen.current;
    seen.current = new Set(turns.map((item) => item.id));
    if (!before || !notify || document.hasFocus() || Notification.permission !== "granted") return;
    for (const item of turns.filter((t) => !before.has(t.id)).slice(0, BURST)) {
      const note = new Notification(`${shortRepo(item.repo)}#${item.number}: ${item.reason}`, {
        body: item.title,
        tag: item.id,
        icon: "/icon-192.png",
      });
      note.addEventListener("click", () => {
        window.focus();
        const [owner = "", repo = ""] = item.repo.split("/");
        void navigate({
          to: "/$owner/$repo/pull/$number",
          params: { owner, repo, number: item.number },
        });
        note.close();
      });
    }
  }, [review, mine, notify, navigate]);
}

/** Asks for permission (the browser asks once) and turns notifications on if it's given. */
export async function enableNotifications(): Promise<boolean> {
  const permission = await Notification.requestPermission();
  usePrefs.getState().setNotify(permission === "granted");
  return permission === "granted";
}
