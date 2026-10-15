import { expect, type Page, test } from "@playwright/test";

import type { MergeQueueItem } from "../packages/core/src/wire";

const PR: MergeQueueItem = {
  kind: "pr",
  activity: "updated",
  id: "queue-web-8",
  repo: "WastedHippie/sandbox-web",
  number: 8,
  title: "Document local setup and tests",
  url: "https://github.com/WastedHippie/sandbox-web/pull/8",
  state: "OPEN",
  author: null,
  additions: 1_234_567,
  deletions: 987_654,
  changedFiles: 2,
  isDraft: false,
  checks: { state: "pending", total: 4, failing: 0, pending: 1 },
  reviewDecision: "approved",
  reason: "Waiting to merge",
  updatedAt: "2026-10-14T01:00:00Z",
  account: "WastedHippie",
  baseRefName: "main",
  position: 2,
  queueState: "QUEUED",
  autoMerge: "SQUASH",
};

const ITEMS: MergeQueueItem[] = [
  PR,
  {
    ...PR,
    id: "queue-api",
    repo: "WastedHippie/sandbox-api",
    number: 6,
    title: "Show a skeleton while ProjectCard loads",
    position: 1,
    queueState: "AWAITING_CHECKS",
  },
  {
    ...PR,
    id: "queue-first",
    number: 7,
    title: "Paginate events with cursors",
    position: 1,
    queueState: "MERGEABLE",
    checks: { state: "success", total: 4, failing: 0, pending: 0 },
  },
  {
    ...PR,
    id: "auto-merge",
    number: 9,
    title: "Merge after the remaining checks pass",
    position: null,
    queueState: null,
    autoMerge: "REBASE",
  },
];

async function queueResponse(page: Page, items: MergeQueueItem[]) {
  await page.route("**/api/rpc/mergeQueue", (route) => route.fulfill({ json: items }));
}

test("the sidebar opens a merge queue grouped by repository and ordered by position", async ({
  page,
}) => {
  await queueResponse(page, ITEMS);
  await page.goto("/inbox/review");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Merge queue", exact: true })
    .click();
  await expect(page).toHaveURL(/\/merge-queue$/);
  await expect(page.getByRole("heading", { name: "Merge queue", exact: true })).toBeVisible();
  const webQueue = page.getByRole("region", { name: "WastedHippie/sandbox-web into main" });
  await expect(webQueue.getByRole("listitem")).toHaveCount(3);
  await expect(webQueue.getByRole("listitem").nth(0)).toContainText("Paginate events with cursors");
  await expect(webQueue.getByRole("listitem").nth(1)).toContainText(
    "Document local setup and tests",
  );
  await expect(
    webQueue.getByRole("listitem").nth(1).getByText("Updated", { exact: true }),
  ).toBeVisible();
  await expect(webQueue.getByRole("listitem").nth(2)).toContainText("Merge when ready");
  await expect(webQueue).toContainText("+1,234,567");
  await expect(
    page.getByRole("region", { name: "WastedHippie/sandbox-api into main" }),
  ).toContainText("Awaiting checks");
  await page.setViewportSize({ width: 1100, height: 850 });
  expect(await webQueue.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("merge-queue.png") });
  await webQueue.getByRole("link", { name: /Document local setup and tests/ }).click();
  await expect(page).toHaveURL(/\/WastedHippie\/sandbox-web\/pull\/8$/);
  await expect(page.getByRole("heading", { name: "Document local setup and tests" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Pull request sections" })
    .getByRole("button", { name: "Merge", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Merge", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("g");
  await page.keyboard.press("q");
  await expect(page.getByRole("heading", { name: "Merge queue", exact: true })).toBeVisible();
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/WastedHippie\/sandbox-web\/pull\/7$/);
});

test("an empty queue explains its scope and refresh retrieves newly queued PRs", async ({
  page,
}) => {
  let items: MergeQueueItem[] = [];
  await page.route("**/api/rpc/mergeQueue", (route) => route.fulfill({ json: items }));
  await page.goto("/merge-queue");
  await expect(page.getByText("No tracked PRs are waiting to merge.")).toBeVisible();
  items = ITEMS;
  await page.getByRole("button", { name: "Refresh merge queue" }).click();
  await expect(page.getByRole("link", { name: /Document local setup and tests/ })).toBeVisible();
});

test("a failed queue request can be retried without presenting an empty queue", async ({
  page,
}) => {
  let failed = true;
  await page.route("**/api/rpc/mergeQueue", (route) =>
    route.fulfill(
      failed ? { status: 503, json: { error: "Queue temporarily unavailable" } } : { json: ITEMS },
    ),
  );
  await page.goto("/merge-queue");
  await expect(page.getByRole("alert")).toContainText("Queue temporarily unavailable");
  await expect(page.getByText("No tracked PRs are waiting to merge.")).toBeHidden();
  failed = false;
  await page.getByRole("button", { name: "Refresh merge queue" }).click();
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(page.getByRole("link", { name: /Document local setup and tests/ })).toBeVisible();
});

test("the queue stays in a loading state until its first response", async ({ page }) => {
  const { promise: ready, resolve: release } = Promise.withResolvers<void>();
  await page.route("**/api/rpc/mergeQueue", async (route) => {
    await ready;
    await route.fulfill({ json: ITEMS });
  });
  await page.goto("/merge-queue");
  await expect(
    page.getByRole("status").getByText("Loading merge queue", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No tracked PRs are waiting to merge.")).toBeHidden();
  release();
  await expect(page.getByRole("link", { name: /Document local setup and tests/ })).toBeVisible();
});
