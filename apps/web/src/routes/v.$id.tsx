import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { Search } from "@/features/search";
import { q } from "@/lib/rpc";

export const Route = createFileRoute("/v/$id")({
  component: function ViewRoute() {
    const { id } = Route.useParams();
    const { data: views, isPending } = useQuery(q("views", {}));
    const view = views?.find((v) => v.id === id);
    if (isPending) return null;
    if (!view) {
      return <p className="px-8 pt-16 text-prose text-muted">There's no view called “{id}”.</p>;
    }
    return <Search key={view.id} initial={view.query} view={view} />;
  },
});
