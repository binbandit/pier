import { expect, test } from "@playwright/test";

import type { PrView } from "../packages/core/src/wire";

test("Pierre's file tree navigates folders and keeps review metadata current", async ({ page }) => {
  await page.route("**/api/rpc/pr", async (route) => {
    const response = await route.fetch({
      headers: { ...route.request().headers(), "sec-fetch-site": "same-origin" },
    });
    const pr = (await response.json()) as PrView;
    const extra = Array.from({ length: 12 }, (_, i) => ({
      path: `src/generated/item-${String(i).padStart(2, "0")}.ts`,
      previousPath: null,
      status: "added" as const,
      additions: 1,
      deletions: 0,
      patch: "@@ -0,0 +1 @@\n+export const value = 1;",
    }));
    pr.files = [...(pr.files ?? []), ...extra];
    pr.changedFiles = pr.files.length;
    pr.lastReviewedOid = pr.headRefOid;
    await route.fulfill({ response, json: pr });
  });
  await page.goto("/WastedHippie/sandbox-web/pull/7");
  const nav = page.getByRole("navigation", { name: "Files", exact: true });
  await expect(nav.locator("file-tree-container")).toBeVisible();
  const row = (path: string) => nav.locator(`[role="treeitem"][data-item-path="${path}"]`);
  const generated = row("src/generated/");
  await generated.focus();
  await generated.press("ArrowLeft");
  await expect(generated).toHaveAttribute("aria-expanded", "false");
  await expect(row("src/generated/item-00.ts")).toBeHidden();
  await generated.press("ArrowRight");
  await expect(row("src/generated/item-00.ts")).toBeVisible();

  const search = nav.getByRole("textbox");
  await search.fill("item-11");
  await expect(row("src/generated/item-11.ts")).toBeVisible();
  await expect(row("src/generated/item-00.ts")).toBeHidden();
  await search.press("Escape");
  await expect(row("src/generated/item-00.ts")).toBeVisible();
  await expect(page).toHaveURL(/sandbox-web\/pull\/7$/);

  const routes = row("src/routes/events.ts");
  await routes.click();
  const file = page.locator('[data-file="src/routes/events.ts"]');
  await expect(file.locator("header")).toBeInViewport();
  await expect(routes).toHaveAttribute("aria-selected", "true");
  const viewed = file.getByRole("checkbox", { name: "Viewed" });
  const wasViewed = await viewed.isChecked();
  await expect(
    routes.getByTitle(wasViewed ? "Viewed · 1 thread" : "1 thread", { exact: true }),
  ).toBeVisible();
  await viewed.click();
  await expect(viewed).toHaveJSProperty("checked", !wasViewed);
  await expect(
    routes.getByTitle(wasViewed ? "1 thread" : "Viewed · 1 thread", { exact: true }),
  ).toBeVisible();
  await viewed.click();
  await expect(viewed).toHaveJSProperty("checked", wasViewed);
  await expect(
    routes.getByTitle(wasViewed ? "Viewed · 1 thread" : "1 thread", { exact: true }),
  ).toBeVisible();

  // The diff's next-file command also selects and reveals the corresponding tree row.
  await page.keyboard.press("]");
  const selected = nav.locator('[role="treeitem"][aria-selected="true"][data-item-type="file"]');
  await expect(selected).not.toHaveAttribute("data-item-path", "src/routes/events.ts");
  await expect(selected).toBeInViewport();
});

test("large file trees virtualize rows and jump to a distant file", async ({ page }) => {
  await page.goto("/WastedHippie/sandbox-api/pull/8");
  const nav = page.getByRole("navigation", { name: "Files", exact: true });
  await expect(nav).toContainText("400 viewed");
  const rows = nav.getByRole("treeitem");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeLessThan(100);
  const tree = nav.locator("[data-file-tree-virtualized-scroll]");
  await tree.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const last = nav.locator('[role="treeitem"][data-item-path="services/svc-399/start.ts"]');
  await expect(last).toBeVisible();
  await last.click();
  await expect(page.locator('[data-file="services/svc-399/start.ts"] header')).toBeInViewport();
  await expect(last).toHaveAttribute("aria-selected", "true");
});
