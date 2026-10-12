import { createFileRoute, notFound } from "@tanstack/react-router";

import { PrCanvas } from "@/features/pr";

// Same path as github.com, so swapping the host on any PR link opens it here.
export const Route = createFileRoute("/$owner/$repo/pull/$number")({
  params: {
    parse: ({ owner, repo, number }) => {
      const n = Number(number);
      if (!Number.isInteger(n) || n <= 0) throw notFound();
      return { owner, repo, number: n };
    },
    stringify: ({ owner, repo, number }) => ({ owner, repo, number: String(number) }),
  },
  component: function PullRoute() {
    const { owner, repo, number } = Route.useParams();
    return (
      <PrCanvas key={`${owner}/${repo}#${number}`} repo={`${owner}/${repo}`} number={number} />
    );
  },
});
