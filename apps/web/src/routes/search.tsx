import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { Search } from "@/features/search";

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : "",
  }),
  component: function SearchRoute() {
    const { q } = Route.useSearch();
    const navigate = useNavigate();
    return (
      <Search
        initial={q}
        onQuery={(query) => void navigate({ to: "/search", search: { q: query }, replace: true })}
      />
    );
  },
});
