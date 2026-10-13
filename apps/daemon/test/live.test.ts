import { describe, expect, test } from "bun:test";

import { GitHubError, type GitHubTransport } from "@/github/client";
import { LiveGitHub } from "@/github/live";

// A transport whose GraphQL "times out" (502) whenever a batch is larger than `limit`.
function flakyTransport(limit: number) {
  const batches: number[] = [];
  const transport: GitHubTransport = {
    login: "binbandit",
    rates: () => ({ graphql: null, core: null }),
    rest: () => Promise.reject(new Error("not used")),
    location: () => Promise.resolve(null),
    graphql: <R>(_doc: unknown, variables: unknown): Promise<R> => {
      const ids = (variables as { ids: string[] }).ids;
      batches.push(ids.length);
      if (ids.length > limit)
        return Promise.reject(new GitHubError("502 Bad Gateway", "server", 502));
      return Promise.resolve({ nodes: [] } as R);
    },
  };
  return { transport, batches };
}

describe("batch timeouts", () => {
  test("a batch GitHub times out on is halved until it fits", async () => {
    const { transport, batches } = flakyTransport(6);
    const ids = Array.from({ length: 25 }, (_, i) => `PR_${i}`);
    await new LiveGitHub(transport).hydrate(ids);
    expect(batches[0]).toBe(25);
    expect(batches.filter((size) => size <= 6).reduce((a, b) => a + b, 0)).toBe(25);
  });

  test("a single PR that still fails surfaces the error", async () => {
    const { transport } = flakyTransport(0);
    const sweep = new LiveGitHub(transport).sweep(["PR_1", "PR_2"]);
    expect(sweep).rejects.toThrow("502");
    await sweep.catch(() => undefined);
  });
});
