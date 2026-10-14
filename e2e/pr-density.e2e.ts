import { expect, type Page, test } from "@playwright/test";

import type { ChecksView, Person, PrView } from "../packages/core/src/wire";

// Keep this fixture separate from the human PR whose CI is re-run by flows.e2e.ts.
const PR_PATH = "/WastedHippie/sandbox-api/pull/2";
const PR_TITLE = "chore(deps): bump golang from 1.24.4-alpine to 1.25.2-alpine";

async function densePr(page: Page, longDescription = false) {
  await page.route("**/api/rpc/assignable", async (route) => {
    const response = await route.fetch({
      headers: { ...route.request().headers(), "sec-fetch-site": "same-origin" },
    });
    const people = (await response.json()) as Person[];
    const avatarUrl = people[0]?.avatarUrl;
    if (!avatarUrl) throw new Error("Sandbox users must have local avatars");
    people.push(
      ...Array.from({ length: 23 }, (_, i) => ({ login: `reviewer-${i + 1}`, avatarUrl })),
    );
    await route.fulfill({ response, json: people });
  });
  await page.route("https://avatars.githubusercontent.com/**", (route) => route.abort());
  await page.route("**/api/rpc/pr", async (route) => {
    const response = await route.fetch({
      headers: { ...route.request().headers(), "sec-fetch-site": "same-origin" },
    });
    const pr = (await response.json()) as PrView;
    pr.additions = 1_234_567;
    pr.deletions = 987_654;
    pr.reviewers = Array.from({ length: 24 }, (_, i) => ({
      login: i === 23 ? "platform/reliability-and-observability-team" : `reviewer-${i + 1}`,
      kind: i === 23 ? "team" : "user",
      state: i === 0 ? "CHANGES_REQUESTED" : i < 4 ? "APPROVED" : "requested",
      codeOwner: i % 3 === 0,
    }));
    if (longDescription) {
      pr.body = "Release checklist\n\n" + "A detailed migration note.\n\n".repeat(100);
      pr.bodyHTML = "<p>Release checklist</p>" + "<p>A detailed migration note.</p>".repeat(100);
    }
    await route.fulfill({ response, json: pr });
  });
  await page.route("**/api/rpc/checks", async (route) => {
    const response = await route.fetch({
      headers: { ...route.request().headers(), "sec-fetch-site": "same-origin" },
    });
    const checks = (await response.json()) as ChecksView;
    checks.runs.push(
      ...Array.from({ length: 40 - checks.runs.length }, (_, i) => ({
        id: 100_000 + i,
        name: `Integration suite ${String(i + 1).padStart(2, "0")}`,
        state: "success" as const,
        kind: "status" as const,
        jobId: null,
        runId: null,
        url: `https://github.com/WastedHippie/sandbox-api/actions/runs/${100_000 + i}`,
        summary: "All tests passed",
        startedAt: null,
        completedAt: null,
        annotations: 0,
        workflow: "Continuous integration",
        event: null,
      })),
    );
    await route.fulfill({ response, json: checks });
  });
  await page.goto(PR_PATH);
  await expect(page.getByRole("heading", { name: PR_TITLE })).toBeVisible();
}

test("large check lists collapse without hiding their status or losing access to logs", async ({
  page,
}) => {
  await densePr(page);
  await page.screenshot({ path: test.info().outputPath("dense-pr.png") });
  const checks = page.getByRole("region", { name: "Checks", exact: true });
  const toggle = checks.getByRole("button", { name: "Show checks", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(checks).toContainText("40");
  await expect(checks).toContainText("1 failed");
  await expect(checks.getByText("Integration suite 01", { exact: false })).toBeHidden();

  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(checks.getByRole("button", { name: "Hide checks", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(checks.getByText("Process completed with exit code 1.")).toBeVisible();
  await expect(checks.getByRole("button", { name: "Re-run test", exact: true })).toBeAttached();
  await checks.getByRole("button", { name: "Hide checks", exact: true }).click();
  await expect(checks.getByText("Process completed with exit code 1.")).toBeHidden();
  await expect(checks).toContainText("1 failed");
  await page.screenshot({ path: test.info().outputPath("checks-collapsed.png") });
});

test("many reviewers have a compact summary and a complete readable list", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 850 });
  await densePr(page);
  await page.screenshot({ path: test.info().outputPath("reviewers-before-toggle.png") });
  const additions = page.locator("header").getByText("+1,234,567", { exact: true });
  const deletions = page.locator("header").getByText("−987,654", { exact: true });
  await expect(additions).toBeVisible();
  await expect(deletions).toBeVisible();
  expect((await additions.boundingBox())?.y).toBe((await deletions.boundingBox())?.y);
  const reviewers = page.getByLabel("Reviewers", { exact: true });
  const toggle = reviewers.getByRole("button", { name: "Show all 24 reviewers" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(reviewers).toContainText("20 requested");
  await toggle.click();
  const list = reviewers.getByRole("list");
  await expect(list.getByRole("listitem")).toHaveCount(24);
  await expect(list).toContainText("platform/reliability-and-observability-team");
  await expect(list).toContainText("Changes requested");
  await expect(list.getByText("Code owner").first()).toBeVisible();
  expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("reviewers-expanded.png") });
  await reviewers.getByRole("button", { name: "Hide reviewers" }).click();
  await expect(list).toBeHidden();
});

test("section navigation skips a long description and stays available beside the diff", async ({
  page,
}) => {
  await densePr(page, true);
  const navigation = page.getByRole("navigation", { name: "Pull request sections" });
  await expect(navigation).toBeVisible();
  await navigation.getByRole("button", { name: "Changes", exact: true }).click();
  const changes = page.getByRole("heading", { level: 2 }).filter({ hasText: /^Changes/ });
  await expect(changes).toBeInViewport();
  await expect(navigation).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath("jump-to-changes.png") });
  await navigation.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
  await navigation.getByRole("button", { name: "Description", exact: true }).click();
  await expect(page.getByText("Release checklist", { exact: true })).toBeInViewport();
});

test("approver photos load from their profile URLs while the reviewer list is collapsed", async ({
  page,
}) => {
  await densePr(page);
  const approved = page.getByLabel("Approved reviewers", { exact: true });
  await expect(approved).toBeVisible();
  const photos = approved.getByRole("img");
  await expect(photos).toHaveCount(3);
  for (const photo of await photos.all()) {
    await expect(photo).toHaveAttribute("src", /^data:image\/svg\+xml/);
    await expect
      .poll(() =>
        photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
  }
  await expect(page.getByRole("button", { name: "Show all 24 reviewers" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.screenshot({ path: test.info().outputPath("approved-avatars.png") });
});
