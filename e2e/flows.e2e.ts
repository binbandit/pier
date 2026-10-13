import { expect, type Page, test } from "@playwright/test";

// The flows a reviewer runs all day, driven by keys the way they'd use them. Each test works on
// its own PRs in the shared fake world.

const toast = (page: Page, text: string) => page.getByRole("status").getByText(text);

test("a clear bump group goes out in one sweep", async ({ page }) => {
  await page.goto("/deps/npm:lodash@4.17.21");
  // Release lookups land a few seconds after start; until then the group waits in Look.
  await expect(page.getByRole("heading", { name: /^Clear/ })).toBeVisible({ timeout: 30_000 });

  await page.keyboard.press("a");
  const strip = page.getByRole("region", { name: "Confirm writes" });
  await expect(strip).toContainText("Approve 2 PRs");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Approved. Waiting for them to merge.")).toBeVisible({
    timeout: 15_000,
  });
});

test("an approval can be taken back during its five seconds", async ({ page }) => {
  await page.goto("/WastedHippie/sandbox-api/pull/5");
  await expect(page.getByRole("heading", { name: "Add AUDIT_LOG feature flag" })).toBeVisible();

  await page.keyboard.press("a");
  await expect(toast(page, "Approving sandbox-api#5 in 5s")).toBeVisible();
  await page.keyboard.press("z");

  await page.goto("/log");
  await expect(page.getByRole("listitem").filter({ hasText: "sandbox-api#5" })).toContainText(
    "Cancelled",
  );
});

test("an inline draft goes out with the review", async ({ page }) => {
  await page.goto("/WastedHippie/sandbox-web/pull/7");
  await expect(page.getByRole("heading", { name: "Paginate events with cursors" })).toBeVisible();

  await page
    .locator("diffs-container [data-column-number][data-line-type='change-addition']")
    .first()
    .click();
  await page.keyboard.press("c");
  await page.keyboard.type("Should this cursor be opaque?");
  await page.keyboard.press("Meta+Enter");
  // The saved draft, not the composer it was typed in (which also shows the text).
  await expect(page.getByText("Sends with your review")).toBeVisible();

  await page.keyboard.press("r");
  const review = page.getByRole("region", { name: "Review" });
  await expect(review).toContainText("1 inline comment goes with it");
  await page.keyboard.type("A couple of questions.");
  await page.keyboard.press("Meta+Enter");
  await expect(toast(page, "Commenting in 5s")).toBeVisible();

  await page.goto("/log");
  await expect(page.getByRole("listitem").filter({ hasText: "sandbox-web#7" })).toContainText(
    "Sent",
    { timeout: 15_000 },
  );
});

test("the merge runway names what's missing, then merges once it's there", async ({ page }) => {
  const title = "Show a skeleton while ProjectCard loads";
  await page.goto("/WastedHippie/sandbox-api/pull/6");
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  await page.keyboard.press("m");
  const runway = page.getByRole("region", { name: "Merge" });
  await expect(runway).toContainText("It needs an approving review");
  await page.keyboard.press("Escape");

  // Approving moves on to the next PR; come back once the approval has gone out.
  await page.keyboard.press("a");
  await page.goto("/log");
  await expect(
    page.getByRole("listitem").filter({ hasText: "sandbox-api#6" }).filter({ hasText: "Review" }),
  ).toContainText("Sent", { timeout: 15_000 });

  await page.goto("/WastedHippie/sandbox-api/pull/6");
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.keyboard.press("m");
  await expect(runway).toContainText("Ready to merge", { timeout: 15_000 });
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(toast(page, "Merging in 5s")).toBeVisible();

  await page.goto("/log");
  await expect(
    page.getByRole("listitem").filter({ hasText: "sandbox-api#6" }).filter({ hasText: "Merge" }),
  ).toContainText("Sent", { timeout: 20_000 });
});

test("a 5,000-line PR opens and moves between files without lag", async ({ page }) => {
  const opened = Date.now();
  await page.goto("/WastedHippie/sandbox-api/pull/7");
  await expect(page.locator("diffs-container").first()).toBeVisible();
  expect(Date.now() - opened).toBeLessThan(5_000);

  const frames = await page.evaluate(async () => {
    // This body runs in the page, so everything it uses has to be defined inside it.
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: i < 10 ? "]" : "[", bubbles: true }),
      );
      await frame();
      times.push(performance.now() - start);
    }
    return times.toSorted((a, b) => a - b);
  });
  // Two frames is the floor for this measurement; anything near it means the jump felt instant.
  expect(frames[18]).toBeLessThan(100);
});

test("labels, milestone and draft change from the keyboard and stick", async ({ page }) => {
  await page.goto("/WastedHippie/sandbox-cli/pull/4");
  await expect(page.getByRole("heading", { name: "Add NEW_BILLING feature flag" })).toBeVisible();

  await page.keyboard.press("s");
  await page.keyboard.press("l");
  await page.getByRole("textbox", { name: "Filter labels" }).fill("enhancement");
  await expect(page.getByRole("region", { name: "Labels" }).getByRole("button")).toHaveText(
    /enhancement/,
  );
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(toast(page, "Added enhancement")).toBeVisible();

  await page.keyboard.press("s");
  await page.keyboard.press("m");
  await expect(page.getByRole("region", { name: "Milestone" })).toContainText("Next release");
  await page.keyboard.press("Enter");

  await page.keyboard.press("s");
  await page.keyboard.press("d");
  await expect(toast(page, "Converted to draft")).toBeVisible();

  // After a reload everything comes from what GitHub says now, not from what we sent.
  await page.reload();
  await expect(page.getByLabel("Labels", { exact: true })).toContainText("enhancement");
  await expect(page.getByLabel("Milestone", { exact: true })).toContainText("Next release");
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
});

test("a conversation comment can be reacted to, edited and deleted", async ({ page }) => {
  await page.goto("/WastedHippie/sandbox-api/pull/7");
  const rail = page.getByRole("complementary", { name: "Activity" });
  await rail.getByRole("textbox").fill("Is the generated client checked in on purpose?");
  await page.keyboard.press("Meta+Enter");
  const comment = rail.getByRole("listitem").filter({ hasText: "generated client" });
  await expect(comment).toBeVisible({ timeout: 15_000 });

  await comment.hover();
  await comment.getByRole("button", { name: "React" }).click();
  await comment.getByRole("button", { name: "eyes" }).click();
  await expect(comment.getByRole("button", { pressed: true })).toContainText("1");

  await comment.hover();
  await comment.getByRole("button", { name: "Edit" }).click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("Is the generated client meant to be checked in?");
  await page.keyboard.press("Meta+Enter");
  await expect(rail.getByText("meant to be checked in")).toBeVisible();

  const edited = rail.getByRole("listitem").filter({ hasText: "meant to be checked in" });
  await edited.hover();
  await edited.getByRole("button", { name: "Delete" }).click();
  await expect(toast(page, "Deleting the comment in 5s")).toBeVisible();
  await expect(rail.getByText("meant to be checked in")).toBeHidden();
});

test("a comment on a whole file goes out with the review", async ({ page }) => {
  await page.goto("/WastedHippie/sandbox-api/pull/5");
  await expect(page.getByRole("heading", { name: "Add AUDIT_LOG feature flag" })).toBeVisible();
  await page.keyboard.press("c");
  await page.keyboard.type("Please document the flag in the README too.");
  await page.keyboard.press("Meta+Enter");
  await expect(page.getByText("On the whole file")).toBeVisible();
  await expect(page.getByText("Sends with your review")).toBeVisible();

  await page.keyboard.press("r");
  await expect(page.getByRole("region", { name: "Review" })).toContainText(
    "1 inline comment goes with it",
  );
  await page.keyboard.press("Meta+Enter");
  await page.getByRole("button", { name: "Send without a summary" }).click();
  await page.goto("/log");
  await expect(
    page.getByRole("listitem").filter({ hasText: "sandbox-api#5" }).first(),
  ).toContainText("Sent", { timeout: 15_000 });
});
