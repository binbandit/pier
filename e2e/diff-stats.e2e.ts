import { expect, test } from "@playwright/test";

import type { QueueItem } from "../packages/core/src/wire";

test("large additions and deletions stay grouped on one line in PR lists", async ({ page }) => {
  await page.route("**/api/rpc/inbox", async (route) => {
    const response = await route.fetch({
      headers: { ...route.request().headers(), "sec-fetch-site": "same-origin" },
    });
    const items = (await response.json()) as QueueItem[];
    await route.fulfill({
      response,
      json: items.map((item, index) =>
        index === 0 && item.kind === "pr"
          ? { ...item, additions: 1_234_567, deletions: 234_567 }
          : item,
      ),
    });
  });
  await page.goto("/inbox/review");
  const row = page.getByRole("list", { name: "Review" }).getByRole("listitem").first();
  await expect(row).toBeVisible();
  const added = row.locator(".text-ok");
  const deleted = row.locator(".text-bad");
  for (const width of [1600, 1100]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(added).toHaveText("+1,234,567");
    await expect(deleted).toHaveText("−234,567");
    const addBox = await added.boundingBox();
    const deleteBox = await deleted.boundingBox();
    expect(addBox).not.toBeNull();
    expect(deleteBox).not.toBeNull();
    expect(addBox!.y).toBe(deleteBox!.y);
    expect(addBox!.x + addBox!.width).toBeLessThan(deleteBox!.x);
    expect(deleteBox!.x + deleteBox!.width).toBeLessThan(width);
    const repository = row.locator("span.font-code[title]");
    const nextRepository = page
      .getByRole("list", { name: "Review" })
      .getByRole("listitem")
      .nth(1)
      .locator("span.font-code[title]");
    expect((await repository.boundingBox())!.x).toBe((await nextRepository.boundingBox())!.x);
  }
});
