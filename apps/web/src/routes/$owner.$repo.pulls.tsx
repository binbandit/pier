import { createFileRoute } from "@tanstack/react-router";

import { Search } from "@/features/search";

// github.com/owner/repo/pulls, here: the repo's open PRs, as a search you can narrow.
export const Route = createFileRoute("/$owner/$repo/pulls")({
  component: function RepoPullsRoute() {
    const { owner, repo } = Route.useParams();
    return (
      <Search
        key={`${owner}/${repo}`}
        initial={`repo:${owner}/${repo} is:open`}
        heading={`${owner}/${repo}`}
      />
    );
  },
});
