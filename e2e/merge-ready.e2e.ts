import { expect, type Page, test } from "@playwright/test";

import type { Runway } from "../packages/core/src/wire";

const path = "/WastedHippie/sandbox-web/pull/8";

async function openMerge(page: Page) {
  await page.goto(path);
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  const panel = page.getByRole("region", { name: "Merge", exact: true });
  await expect(panel).toContainText("It needs an approving review");
  return panel;
}

test("merge when ready saves the method and message, survives reload, and can be cancelled", async ({
  page,
}) => {
  const panel = await openMerge(page);
  await panel.getByRole("button", { name: /Squash$/ }).click();
  await panel.getByRole("textbox", { name: "Commit title" }).fill("Document local development");
  await panel
    .getByRole("textbox", { name: "Commit message" })
    .fill("Keep setup instructions current.");
  await panel.getByRole("button", { name: /Merge when ready$/ }).click();
  await expect(panel.getByRole("button", { name: /Cancel auto-merge$/ })).toBeEnabled();
  await expect(panel).toContainText("Auto-merge is on (squash)");

  await page.reload();
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(panel.getByRole("button", { name: /Cancel auto-merge$/ })).toBeEnabled();
  await expect(panel.getByRole("textbox", { name: "Commit title" })).toHaveValue(
    "Document local development",
  );
  await expect(panel.getByRole("textbox", { name: "Commit message" })).toHaveValue(
    "Keep setup instructions current.",
  );
  await panel.getByRole("button", { name: /Cancel auto-merge$/ }).click();
  await expect(panel.getByRole("button", { name: /Merge when ready$/ })).toBeEnabled();

  // The existing shortcut follows the same acknowledged write path in both directions.
  await page.keyboard.press("a");
  await expect(panel.getByRole("button", { name: /Cancel auto-merge$/ })).toBeEnabled();
  await page.keyboard.press("a");
  await expect(panel.getByRole("button", { name: /Merge when ready$/ })).toBeEnabled();
  await page.reload();
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(panel.getByRole("button", { name: /Merge when ready$/ })).toBeEnabled();
  await expect(panel).not.toContainText("Auto-merge is on");
});

test("unavailable auto-merge is disabled, including its keyboard shortcut", async ({ page }) => {
  let writes = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/rpc/setAutoMerge")) writes++;
  });
  await page.route("**/api/rpc/runway", async (route) => {
    const response = await route.fetch({
      headers: { ...route.request().headers(), "sec-fetch-site": "same-origin" },
    });
    const runway = (await response.json()) as Runway;
    await route.fulfill({
      response,
      json: { ...runway, canAutoMerge: false, canCancelAutoMerge: false },
    });
  });
  const panel = await openMerge(page);
  await expect(panel.getByRole("button", { name: /Merge when ready$/ })).toBeDisabled();
  await page.keyboard.press("a");
  await expect(panel).not.toContainText("Auto-merge is on");
  expect(writes).toBe(0);
});

test("a rejected auto-merge write reports the error and leaves the action available", async ({
  page,
}) => {
  await page.route("**/api/rpc/setAutoMerge", (route) =>
    route.fulfill({ json: { commandIds: ["failed-auto-merge"] } }),
  );
  await page.route("**/api/rpc/commandResult", (route) =>
    route.fulfill({
      json: { state: "failed", detail: "GitHub rejected auto-merge for this PR", result: null },
    }),
  );
  const panel = await openMerge(page);
  await panel.getByRole("button", { name: /Merge when ready$/ }).click();
  await expect(panel.getByRole("alert")).toHaveText("GitHub rejected auto-merge for this PR");
  await expect(panel.getByRole("button", { name: /Merge when ready$/ })).toBeEnabled();
  await expect(panel).not.toContainText("Auto-merge is on");
});

for (const action of ["remove", "jump"] as const) {
  test(`queue ${action} waits for acknowledgement and can retry a rejected write`, async ({
    page,
  }) => {
    let writes = 0;
    let reads = 0;
    let outcome: "queued" | "failed" | "acked" = "queued";
    let acknowledged = false;
    const key = action === "remove" ? "x" : "j";
    const success =
      action === "remove"
        ? "Taken out of the merge queue"
        : "Jumped to the front of the merge queue";
    await page.route("**/api/rpc/runway", async (route) => {
      const response = await route.fetch({
        headers: { ...route.request().headers(), "sec-fetch-site": "same-origin" },
      });
      const runway = (await response.json()) as Runway;
      await route.fulfill({
        response,
        json: {
          ...runway,
          queued: true,
          ready: action === "jump",
          canAutoMerge: false,
          blockers: action === "jump" ? [] : runway.blockers,
          mergeQueue:
            action === "remove"
              ? acknowledged
                ? null
                : { position: 2, state: "QUEUED" }
              : acknowledged
                ? { position: 1, state: "QUEUED" }
                : null,
        },
      });
    });
    await page.route("**/api/rpc/queue", async (route) => {
      writes++;
      expect(route.request().postDataJSON()).toMatchObject({ action });
      await route.fulfill({ json: { commandIds: [`queue-${writes}`] } });
    });
    await page.route("**/api/rpc/commandResult", async (route) => {
      reads++;
      acknowledged = outcome === "acked";
      await route.fulfill({
        json: {
          state: outcome,
          detail: outcome === "failed" ? "GitHub refused this queue change" : null,
          result: null,
        },
      });
    });
    await page.goto(path);
    await page.getByRole("button", { name: "Merge", exact: true }).click();
    const panel = page.getByRole("region", { name: "Merge", exact: true });
    await expect(panel).toContainText(action === "remove" ? "position 2" : "Ready to merge");
    await page.keyboard.press(key);
    await expect.poll(() => reads).toBeGreaterThan(0);
    await expect(
      panel.getByRole("button", { name: action === "remove" ? /Removing/ : /Moving/ }),
    ).toBeDisabled();
    await expect(page.getByRole("status").getByText(success, { exact: true })).toBeHidden();
    await page.keyboard.press(key);
    await page.keyboard.press(key);
    expect(writes).toBe(1);
    outcome = "failed";
    await expect(panel.getByRole("alert")).toHaveText("GitHub refused this queue change");
    await expect(page.getByRole("status").getByText(success, { exact: true })).toBeHidden();

    outcome = "acked";
    await panel
      .getByRole("button", { name: action === "remove" ? /Leave queue/ : /Jump the queue/ })
      .click();
    await expect(page.getByRole("status").getByText(success, { exact: true })).toBeVisible();
    await expect(panel.getByRole("alert")).toBeHidden();
    expect(writes).toBe(2);
    if (action === "remove") await expect(panel).not.toContainText("In the merge queue");
    else await expect(panel).toContainText("position 1");
  });
}
