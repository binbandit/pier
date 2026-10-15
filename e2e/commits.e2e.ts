import { expect, test } from "@playwright/test";

import type { Input } from "../packages/core/src/contract";
import type { PrDiff } from "../packages/core/src/wire";

test("clicking a commit shows its full message and only its changes", async ({
  page,
}, testInfo) => {
  await page.goto("/WastedHippie/sandbox-web/pull/7");
  const activity = page.getByRole("complementary", { name: "Activity", exact: true });
  await activity.getByRole("button", { name: /Address review feedback/ }).click();

  const changes = page.getByRole("region", { name: "Changes", exact: true });
  const message = changes.getByRole("region", { name: "Commit message" });
  await expect(message.getByRole("heading", { name: "Address review feedback" })).toBeVisible();
  await expect(message).toContainText("Apply the requested follow-up changes.");
  await expect(message).toContainText("Keep the rest of the pull request unchanged.");
  await expect(changes.getByRole("heading", { level: 2 })).toContainText("Commit 2 of 2");
  await expect(changes.locator("[data-file]")).toHaveCount(1);
  const routes = changes.locator('[data-file="src/routes/events.ts"]');
  await expect(routes).toBeVisible();
  await expect(changes.locator('[data-file="test/events.test.ts"]')).toHaveCount(0);
  await expect(
    routes.locator("diffs-container [data-line-type='change-addition']").first(),
  ).toBeVisible();
  await expect(routes.locator("diffs-container")).toContainText("rows.at(limit - 1)?.id ?? null");
  await expect.poll(async () => (await changes.boundingBox())?.y).toBeLessThan(60);
  await page.screenshot({ path: testInfo.outputPath("commit-details.png") });

  await changes.getByRole("button", { name: "Show all changes" }).click();
  await expect(message).toHaveCount(0);
  await expect(changes.locator("[data-file]")).toHaveCount(2);

  await activity.getByRole("button", { name: /Paginate events with cursors/ }).click();
  await expect(
    message.getByRole("heading", { name: "Paginate events with cursors" }),
  ).toBeVisible();
  await expect(message).not.toContainText("Apply the requested follow-up changes.");
  await expect(changes.getByRole("heading", { level: 2 })).toContainText("Commit 1 of 2");
  await expect(routes.locator("diffs-container")).toContainText("rows[limit - 1].id");
  await expect(changes.locator("[data-file]")).toHaveCount(2);
  await changes.getByRole("button", { name: "Show all changes" }).click();

  // The same action is reachable without the activity rail, including on narrower windows.
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.getByRole("button", { name: /^Activity/ }).click();
  await changes.getByRole("button", { name: "Choose commits" }).click();
  const picker = page.getByRole("region", { name: "Choose changes" });
  await picker.getByRole("button", { name: /Address review feedback/ }).click();
  await expect(message).toBeVisible();
  await expect(changes.locator("[data-file]")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("commit-details-narrow.png") });
});

test("a commit message stays visible while its changes load and after a retry", async ({
  page,
}) => {
  const gate = Promise.withResolvers<void>();
  let fail = true;
  await page.route("**/api/rpc/prDiff", async (route) => {
    const input = route.request().postDataJSON() as Input<"prDiff">;
    if (input.range !== "commits" || !fail) {
      await route.continue();
      return;
    }
    await gate.promise;
    await route.fulfill({ status: 503, json: { error: "GitHub is temporarily unavailable" } });
  });
  await page.goto("/WastedHippie/sandbox-web/pull/7");
  await page
    .getByRole("complementary", { name: "Activity", exact: true })
    .getByRole("button", { name: /Address review feedback/ })
    .click();
  const changes = page.getByRole("region", { name: "Changes", exact: true });
  await expect(changes.getByRole("status")).toHaveText("Loading changes…");
  await expect(changes.getByRole("region", { name: "Commit message" })).toContainText(
    "Apply the requested follow-up changes.",
  );
  await expect(changes.locator("[data-file]")).toHaveCount(0);
  gate.resolve();
  await expect(changes.getByRole("alert")).toContainText("GitHub is temporarily unavailable");
  fail = false;
  await changes.getByRole("button", { name: "Try again" }).click();
  await expect(changes.getByRole("alert")).toHaveCount(0);
  await expect(changes.locator("[data-file]")).toHaveCount(1);
});

test("empty commits keep their message and explain the absence of changes", async ({ page }) => {
  await page.route("**/api/rpc/prDiff", async (route) => {
    const input = route.request().postDataJSON() as Input<"prDiff">;
    if (input.range !== "commits") {
      await route.continue();
      return;
    }
    const diff: PrDiff = {
      range: "commits",
      files: [],
      fallback: null,
      fromOid: input.from,
      toOid: input.to,
    };
    await route.fulfill({ json: diff });
  });
  await page.goto("/WastedHippie/sandbox-web/pull/7");
  await page
    .getByRole("complementary", { name: "Activity", exact: true })
    .getByRole("button", { name: /Address review feedback/ })
    .click();
  const changes = page.getByRole("region", { name: "Changes", exact: true });
  await expect(changes.getByRole("region", { name: "Commit message" })).toBeVisible();
  await expect(changes.getByText("This commit has no file changes.")).toBeVisible();
  await expect(changes.locator("[data-file]")).toHaveCount(0);
});
