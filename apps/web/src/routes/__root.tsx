import { Outlet, createRootRoute } from "@tanstack/react-router";

import { Shell } from "@/components/shell";

export const Route = createRootRoute({
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
  notFoundComponent: () => (
    <p className="px-8 pt-16 text-prose text-muted">There's nothing at this address.</p>
  ),
});
