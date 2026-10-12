import { useQuery } from "@tanstack/react-query";
import { Navigate, createFileRoute } from "@tanstack/react-router";

import { q } from "@/lib/rpc";

// The inbox opens on the first split that has something in it, human reviews first.
function Home() {
  const { data: counts } = useQuery(q("counts", {}));
  if (!counts) return null;
  const split =
    counts.review > 0 ? "review" : counts.deps > 0 ? "deps" : counts.mine > 0 ? "mine" : "review";
  return <Navigate to="/inbox/$split" params={{ split }} replace />;
}

export const Route = createFileRoute("/")({ component: Home });
