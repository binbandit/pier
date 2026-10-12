import { createFileRoute, notFound } from "@tanstack/react-router";

import { Inbox } from "@/features/inbox";
import type { Split } from "@pier/core/wire";

const SPLITS: readonly Split[] = ["review", "deps", "mine"];

function isSplit(value: string): value is Split {
  return SPLITS.some((split) => split === value);
}

export const Route = createFileRoute("/inbox/$split")({
  params: {
    parse: ({ split }) => {
      if (!isSplit(split)) throw notFound();
      return { split };
    },
    stringify: ({ split }) => ({ split }),
  },
  component: function InboxRoute() {
    const { split } = Route.useParams();
    return <Inbox key={split} split={split} />;
  },
});
