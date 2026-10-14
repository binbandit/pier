import { expect, test } from "@playwright/test";

test("other reviewers' inline comments and replies are visible beside code", async ({ page }) => {
  await page.goto("/WastedHippie/sandbox-web/pull/7");
  await expect(page.getByRole("heading", { name: "Paginate events with cursors" })).toBeVisible();
  await page.keyboard.press("p");
  await page
    .getByRole("region", { name: "Choose changes" })
    .getByRole("button", { name: /Everything/ })
    .click();
  const file = page.locator('[data-file="src/routes/events.ts"]');
  await file.scrollIntoViewIfNeeded();
  const viewed = file.getByRole("checkbox", { name: "Viewed" });
  if (await viewed.isChecked()) {
    await viewed.click();
    await expect(viewed).not.toBeChecked();
  }
  const thread = file.locator("diffs-container [data-thread]").first();
  await expect(thread).toContainText("Should this handle the empty case?");
  await expect(thread).toContainText("sage-smudge");
  await expect(thread).toContainText("Kept it as is for now; happy to follow up separately.");
  await expect(thread.getByRole("button", { name: "Reply", exact: true })).toBeVisible();
});

test("comments and suggestions from other reviewers appear inline on your own PR", async ({
  page,
}) => {
  await page.goto("/WastedHippie/sandbox-web/pull/9");
  await expect(page.getByRole("heading", { name: "Paginate events with cursors" })).toBeVisible();
  const file = page.locator('[data-file="src/routes/events.ts"]');
  await file.scrollIntoViewIfNeeded();
  const threads = file.locator("diffs-container [data-thread]");
  const question = threads.filter({
    hasText: "What happens if the upstream call times out halfway through?",
  });
  await expect(question).toContainText("sage-smudge");
  await expect(question).toBeVisible();
  const suggestion = threads.filter({ hasText: "Smaller pages keep this fast:" });
  await expect(suggestion).toContainText("WastedHippie");
  await expect(suggestion).toBeVisible();
});
