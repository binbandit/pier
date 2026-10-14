import { afterEach, expect, spyOn, test } from "bun:test";

import { GitHubClient } from "@/github/client";
import type { HydrateQuery } from "@/github/gql/graphql";
import { LiveGitHub } from "@/github/live";
import { ApproveMutation, ViewerQuery } from "@/github/ops";
import { memoryStores } from "@/store/db";

const releaseNotes = "Release notes: café 🚀\n".repeat(20_000);
const fetchGitHub = globalThis.fetch;
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).toReversed()) cleanup();
});

function clientWithServer(
  respond: (request: Request) => Response | Promise<Response>,
  received?: () => void,
) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: respond });
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (...[, init]: Parameters<typeof fetchGitHub>) => {
        const response = await fetchGitHub(server.url, init);
        received?.();
        return response;
      },
      { preconnect: fetchGitHub.preconnect },
    ),
  );
  const stores = memoryStores();
  cleanups.push(
    () => stores.cache.close(),
    () => stores.state.close(),
    () => server.stop(true),
    () => fetch.mockRestore(),
  );
  return new GitHubClient("reviewer", () => Promise.resolve("local-test-token"), stores.cache);
}

function streamed(body: string) {
  const bytes = new TextEncoder().encode(body);
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        // Use byte chunks that also split multibyte characters, with headers arriving first.
        await Bun.sleep(1);
        if (offset === bytes.length) return controller.close();
        const end = Math.min(offset + 16_383, bytes.length);
        controller.enqueue(bytes.subarray(offset, end));
        offset = end;
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
}

function hydrated(id: string): HydrateQuery["nodes"][number] {
  return {
    id,
    number: 1,
    title: "Update dependency",
    url: "https://github.com/example/repo/pull/1",
    body: releaseNotes,
    state: "OPEN",
    isDraft: false,
    createdAt: "2026-10-14T00:00:00Z",
    updatedAt: "2026-10-14T00:00:00Z",
    baseRefName: "main",
    headRefName: "dependency",
    baseRefOid: "base",
    headRefOid: "head",
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: null,
    author: null,
    repository: {
      id: "R_1",
      nameWithOwner: "example/repo",
      isPrivate: false,
      viewerPermission: "WRITE",
    },
    autoMergeRequest: null,
    mergeQueueEntry: null,
    labels: null,
    assignees: { nodes: [] },
    milestone: null,
    files: null,
    commits: { totalCount: 0, nodes: [] },
    lastCommit: { nodes: [] },
    reviewRequests: null,
    viewerLatestReview: null,
    latestOpinionatedReviews: null,
  };
}

test("large streamed GraphQL responses retain every PR and multibyte release note", async () => {
  const ids = ["PR_1", "PR_2", "PR_3"];
  const client = clientWithServer(() =>
    streamed(JSON.stringify({ data: { nodes: ids.map(hydrated) } })),
  );
  const result = await new LiveGitHub(client).hydrate(ids);
  expect(result.map(({ doc }) => doc.id)).toEqual(ids);
  expect(result.map(({ doc }) => doc.body)).toEqual(ids.map(() => releaseNotes));
});

test("a truncated streamed query retries smaller batches without losing PRs", async () => {
  const batches: string[][] = [];
  const client = clientWithServer(async (request) => {
    const { variables } = (await request.json()) as { variables: { ids: string[] } };
    batches.push(variables.ids);
    const body = JSON.stringify({ data: { nodes: variables.ids.map(hydrated) } });
    return streamed(variables.ids.length > 1 ? body.slice(0, -100) : body);
  });
  const result = await new LiveGitHub(client).hydrate(["PR_1", "PR_2"]);
  expect(batches).toEqual([["PR_1", "PR_2"], ["PR_1"], ["PR_2"]]);
  expect(result.map(({ doc }) => doc.id)).toEqual(["PR_1", "PR_2"]);
  expect(result.map(({ doc }) => doc.body)).toEqual([releaseNotes, releaseNotes]);
});

test("an invalid single-query response is a GitHub error and releases its request slot", async () => {
  let calls = 0;
  const client = clientWithServer(() => {
    calls++;
    return streamed(
      calls === 1
        ? '{"data":{"viewer":'
        : JSON.stringify({ data: { viewer: { login: "reviewer", avatarUrl: "avatar" } } }),
    );
  });
  const failure = await client.graphql(ViewerQuery, {}).catch((error: unknown) => error);
  expect(failure).toMatchObject({
    name: "GitHubError",
    kind: "server",
    status: 200,
  });
  expect(await client.graphql(ViewerQuery, {})).toEqual({
    viewer: { login: "reviewer", avatarUrl: "avatar" },
  });
});

test("a response that times out after its headers is a network error", async () => {
  const abort = new AbortController();
  const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(abort.signal);
  cleanups.push(() => timeout.mockRestore());
  const receivedHeaders = Promise.withResolvers<void>();
  const client = clientWithServer(
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"data":'));
          },
        }),
      ),
    () => receivedHeaders.resolve(),
  );
  const pending = client.graphql(ViewerQuery, {});
  // Wait for the HTTP response to reach the client before aborting the unread body.
  await receivedHeaders.promise;
  await Bun.sleep(0);
  abort.abort(new DOMException("The operation timed out", "TimeoutError"));
  const failure = await pending.catch((error: unknown) => error);
  expect(failure).toMatchObject({
    name: "GitHubError",
    kind: "network",
    status: 200,
  });
});

test("an invalid mutation response surfaces the error without replaying the write", async () => {
  let calls = 0;
  const client = clientWithServer(() => {
    calls++;
    return streamed('{"data":{"addPullRequestReview":');
  });
  const failure = await client
    .graphql(ApproveMutation, { prId: "PR_1", body: "", commit: "head" })
    .catch((error: unknown) => error);
  expect(failure).toMatchObject({ name: "GitHubError", kind: "server", status: 200 });
  expect(calls).toBe(1);
});
