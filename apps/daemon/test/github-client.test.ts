import { afterEach, expect, spyOn, test } from "bun:test";

import { createHandlers } from "@/api/handlers";
import { createApp } from "@/app";
import { GitHubClient } from "@/github/client";
import type { HydrateQuery } from "@/github/gql/graphql";
import { LiveGitHub } from "@/github/live";
import { ApproveMutation, ViewerQuery } from "@/github/ops";
import { serve } from "@/http/server";
import { memoryStores } from "@/store/db";
import type { AppStatus } from "@pier/core/wire";

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

test("sync recovers from null batch data and serves the fetched PRs in its status", async () => {
  const batches: string[][] = [];
  const client = clientWithServer(async (request) => {
    if (request.method === "GET") return Response.json([]);
    const { variables } = (await request.json()) as { variables: { ids: string[] } };
    batches.push(variables.ids);
    return Response.json(
      variables.ids.length > 1
        ? {
            data: { nodes: null },
            errors: [{ type: "INTERNAL", message: "Something went wrong", path: ["nodes"] }],
          }
        : { data: { nodes: variables.ids.map(hydrated) } },
    );
  });
  const stores = memoryStores();
  const app = createApp({
    stores,
    accounts: [{ login: client.login, scopes: ["repo", "read:org"], active: true }],
    ports: new Map([[client.login, new LiveGitHub(client)]]),
    defaults: { scopes: [] },
  });
  const server = serve({
    handlers: createHandlers(app),
    events: app.events,
    webDir: null,
    dev: false,
    port: 0,
    rawDiff: () => Promise.resolve(null),
  });
  cleanups.push(
    () => stores.cache.close(),
    () => stores.state.close(),
    () => server.stop(true),
    () => app.stop(),
  );
  const settled = Promise.withResolvers<void>();
  app.sync.onStatus(() => {
    const status = app.sync.getStatus();
    if (status.state === "error" || status.pending === 0) settled.resolve();
  });
  for (const id of ["PR_1", "PR_2"]) app.sync.markDirty(id, client.login);
  app.sync.start();
  await settled.promise;

  const response = await fetchGitHub(new URL("/api/rpc/status", server.url), {
    method: "POST",
    // The server's guard uses its configured port; the listener chooses a free one for this test.
    headers: {
      host: "127.0.0.1:0",
      origin: "http://127.0.0.1:0",
      "sec-fetch-site": "same-origin",
      "x-pier": "1",
      "content-type": "application/json",
    },
    body: "{}",
  });
  expect(response.status).toBe(200);
  const status = (await response.json()) as AppStatus;
  expect(status.sync).toMatchObject({ state: "idle", trackedPrs: 2, message: null });
  expect(batches).toEqual([["PR_1", "PR_2"], ["PR_1"], ["PR_2"]]);
  expect(app.model.get("PR_1")?.doc.body).toBe(releaseNotes);
  expect(app.model.get("PR_2")?.doc.body).toBe(releaseNotes);
});

test.each([
  { type: "INTERNAL", message: "Something went wrong" },
  { message: "Resource limits were exceeded" },
])("a partial sweep retries failed batches: $message", async (error) => {
  const batches: string[][] = [];
  const client = clientWithServer(async (request) => {
    const { variables } = (await request.json()) as { variables: { ids: string[] } };
    batches.push(variables.ids);
    return Response.json(
      variables.ids.length > 1
        ? {
            data: { nodes: [hydrated("PR_1"), null] },
            errors: [{ ...error, path: ["nodes", 1] }],
          }
        : { data: { nodes: variables.ids.map(hydrated) } },
    );
  });
  expect((await new LiveGitHub(client).sweep(["PR_1", "PR_2"])).map((pr) => pr.id)).toEqual([
    "PR_1",
    "PR_2",
  ]);
  expect(batches).toEqual([["PR_1", "PR_2"], ["PR_1"], ["PR_2"]]);
});

test("a deleted node does not discard the readable PRs in its batch", async () => {
  const client = clientWithServer(() =>
    Response.json({
      data: { nodes: [hydrated("PR_1"), null] },
      errors: [{ type: "NOT_FOUND", message: "Could not resolve to a node", path: ["nodes", 1] }],
    }),
  );
  const result = await new LiveGitHub(client).hydrate(["PR_1", "PR_deleted"]);
  expect(result.map(({ doc }) => doc.id)).toEqual(["PR_1"]);
});

test("a failed search reports GitHub's reason instead of dereferencing null", async () => {
  const client = clientWithServer(() =>
    Response.json({
      data: { search: null },
      errors: [{ type: "FORBIDDEN", message: "Search access denied", path: ["search"] }],
    }),
  );
  const failure = await new LiveGitHub(client).search("is:pr").catch((error: unknown) => error);
  expect(failure).toMatchObject({
    name: "GitHubError",
    kind: "graphql",
    message: "Search access denied",
  });
});

test.each(
  [null, [], "unavailable"].map((payload) => ({ label: JSON.stringify(payload), payload })),
)("an invalid GraphQL envelope $label is a retryable error", async ({ payload }) => {
  const client = clientWithServer(() => Response.json(payload));
  const failure = await client.graphql(ViewerQuery, {}).catch((error: unknown) => error);
  expect(failure).toMatchObject({ name: "GitHubError", kind: "server", status: 200 });
});

test("rate limits take priority over partial server errors and do not split the batch", async () => {
  let calls = 0;
  const client = clientWithServer(() => {
    calls++;
    return Response.json({
      data: { nodes: null },
      errors: [
        { type: "INTERNAL", message: "Something went wrong", path: ["nodes"] },
        { type: "RATE_LIMITED", message: "API rate limit exceeded" },
      ],
    });
  });
  const failure = await new LiveGitHub(client)
    .hydrate(["PR_1", "PR_2"])
    .catch((error: unknown) => error);
  expect(failure).toMatchObject({ name: "GitHubError", kind: "rate-limit", status: 200 });
  expect(calls).toBe(1);
});

test("a missing field inside a PR is reported instead of accepting an incomplete document", async () => {
  const client = clientWithServer(() =>
    Response.json({
      data: { nodes: [{ ...hydrated("PR_1"), repository: null }] },
      errors: [
        { type: "NOT_FOUND", message: "Repository unavailable", path: ["nodes", 0, "repository"] },
      ],
    }),
  );
  const failure = await new LiveGitHub(client).hydrate(["PR_1"]).catch((error: unknown) => error);
  expect(failure).toMatchObject({
    name: "GitHubError",
    kind: "graphql",
    message: "Repository unavailable",
  });
});

test("a deleted single PR still returns no detail", async () => {
  const client = clientWithServer(() =>
    Response.json({
      data: { node: null },
      errors: [{ type: "NOT_FOUND", message: "Could not resolve to a node", path: ["node"] }],
    }),
  );
  expect(await new LiveGitHub(client).detail("PR_deleted")).toBeNull();
});

test("partial mutation errors are reported without replaying the write", async () => {
  let calls = 0;
  const client = clientWithServer(() => {
    calls++;
    return Response.json({
      data: { addPullRequestReview: null },
      errors: [{ type: "INTERNAL", message: "Something went wrong" }],
    });
  });
  const failure = await client
    .graphql(ApproveMutation, { prId: "PR_1", body: "", commit: "head" })
    .catch((error: unknown) => error);
  expect(failure).toMatchObject({ name: "GitHubError", kind: "server", status: 200 });
  expect(calls).toBe(1);
});
