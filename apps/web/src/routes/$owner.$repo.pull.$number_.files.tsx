import { createFileRoute, redirect } from "@tanstack/react-router";

// github.com/o/r/pull/12/files#diff-…R10: the PR, opened at the linked lines.
export const Route = createFileRoute("/$owner/$repo/pull/$number_/files")({
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/$owner/$repo/pull/$number",
      params: { owner: params.owner, repo: params.repo, number: Number(params.number) },
      hash: location.hash,
    });
  },
});
