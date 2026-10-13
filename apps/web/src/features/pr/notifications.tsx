import { useQueryClient } from "@tanstack/react-query";

import { Picker } from "@/components/picker";
import { errorText } from "@/features/actions";
import { rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import type { PrView, Subscription } from "@pier/core/wire";

// How GitHub notifies you about this PR, picked with `s n`; `!` stops or starts watching it
// straight away. As on github.com, a PR you stop watching still reaches you if you're mentioned
// or join in again.

const OPTIONS: { key: Subscription; label: string; detail: string }[] = [
  { key: "SUBSCRIBED", label: "Watching", detail: "every comment and push" },
  { key: "UNSUBSCRIBED", label: "Not watching", detail: "only if you're mentioned or join in" },
];

export function NotificationsPicker({ pr, onClose }: { pr: PrView; onClose: () => void }) {
  const set = useSubscription(pr);
  return (
    <Picker
      title="Notifications"
      options={OPTIONS}
      selected={[pr.subscription ?? "UNSUBSCRIBED"]}
      single
      clearable={false}
      keepOrder
      onSave={({ add: [chosen] }) => {
        const option = OPTIONS.find((o) => o.key === chosen);
        if (option) void set(option.key);
      }}
      onClose={onClose}
    />
  );
}

/** Sets the PR's notifications, with a toast that puts them back. */
export function useSubscription(pr: PrView) {
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  return async (subscription: Subscription) => {
    const before = pr.subscription ?? "UNSUBSCRIBED";
    try {
      await rpc("setSubscription", { prId: pr.id, subscription });
      void client.invalidateQueries({ queryKey: ["pr"] });
      const name = OPTIONS.find((o) => o.key === subscription)?.label ?? subscription;
      toast(
        {
          text: `${name}: ${pr.repo.split("/")[1]}#${pr.number}`,
          tone: "ok",
          undo: () => void rpc("setSubscription", { prId: pr.id, subscription: before }),
        },
        6_000,
      );
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };
}
