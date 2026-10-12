import { createFileRoute } from "@tanstack/react-router";

import { GroupCanvas } from "@/features/group";

// Group keys look like `npm:lodash@4.17.21` or `github-actions:actions/checkout@7`, so they
// arrive as a splat rather than a single path segment.
export const Route = createFileRoute("/deps/$")({
  component: function GroupRoute() {
    const { _splat } = Route.useParams();
    return <GroupCanvas key={_splat} groupKey={_splat ?? ""} />;
  },
});
