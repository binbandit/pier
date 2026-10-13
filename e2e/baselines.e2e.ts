import { expect, type Page, test } from "@playwright/test";

// Screenshots of the main surfaces, compared pixel for pixel with the ones kept beside this file.
// After a deliberate change, take new ones: `bun run build`, then
// `bunx playwright test -c e2e/playwright.config.ts e2e/baselines.e2e.ts --update-snapshots`.
// They run before the flows (files run in name order), on the fake world as it starts. Day
// contrast is pinned and relative times are masked, so only a real change to how pier looks fails.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "pier.prefs",
      JSON.stringify({ state: { split: false, contrast: "day", notify: false }, version: 0 }),
    );
  });
});

/** The whole window, once every diff on it is drawn. */
async function matches(page: Page, name: string) {
  await expect(page.getByText(/^Synced/)).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveScreenshot(name, {
    mask: [page.locator("time")],
    animations: "disabled",
    caret: "hide",
    // Near-exact colours: the default tolerance lets a grey move several shades unnoticed; this
    // allows only the shade or two that anti-aliased corners vary by between runs.
    threshold: 0.01,
  });
}

test("the design tokens", async ({ page }) => {
  await page.goto("/tokens");
  await expect(page.locator("diffs-container [data-line]").first()).toBeVisible();
  await matches(page, "tokens.png");
});

test("the Review inbox", async ({ page }) => {
  await page.goto("/inbox/review");
  await expect(
    page.getByRole("list", { name: "Review" }).getByRole("listitem").first(),
  ).toBeVisible();
  await matches(page, "review.png");
});

test("a bump group, once its releases are looked up", async ({ page }) => {
  await page.goto("/deps/npm:lodash@4.17.21");
  await expect(page.getByRole("heading", { name: /^Clear/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("diffs-container [data-line]").first()).toBeVisible();
  await matches(page, "group.png");
});

test("a PR with a failing check and a moved file", async ({ page }) => {
  await page.goto("/WastedHippie/sandbox-web/pull/8");
  await expect(page.getByRole("heading", { name: "Document local setup and tests" })).toBeVisible();
  await expect(page.getByText("Run npm test")).toBeVisible();
  await expect(page.locator("diffs-container [data-line]").first()).toBeVisible();
  await matches(page, "pr.png");
});
