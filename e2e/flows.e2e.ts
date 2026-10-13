import { createHash } from "node:crypto";

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

test("an advisory after you approve takes the verdict back, and the version can be skipped", async ({
  page,
}) => {
  await page.goto("/deps/npm:typescript@5.9.3");
  await expect(page.getByRole("heading", { name: /^Look/ })).toBeVisible();
  await page.keyboard.press("Shift+A");
  const strip = page.getByRole("region", { name: "Confirm writes" });
  await expect(strip).toContainText("Approve 1 PR");
  await page.keyboard.press("Enter");

  // The fake publishes an advisory once it's approved; the next check takes the verdict back.
  const notice = page.getByRole("region", { name: "Advisory against typescript 5.9.3" });
  await expect(notice).toContainText("GHSA-4c7m-pq2x-8h3v", { timeout: 30_000 });
  await expect(notice).toContainText("1 with your approval, which can still merge");

  // Renovate's PR is closed outright; Dependabot is told to skip the version, and closes its own.
  await page.keyboard.press("b");
  await page.keyboard.press("i");
  await expect(strip).toContainText("Close 2 PRs and skip this version");
  await page.keyboard.press("Enter");
  await expect(notice).toContainText("Still open in 1 PR.", { timeout: 15_000 });
  await page.goto("/log");
  await expect(
    page.getByRole("listitem").filter({ hasText: "sandbox-web#3" }).first(),
  ).toContainText("Sent");

  await page.goto("/inbox/deps");
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toBeHidden();
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

test("a failing check shows its failing step, what it pointed at, and re-runs", async ({
  page,
}) => {
  await page.goto("/WastedHippie/sandbox-web/pull/8");
  const checks = page.locator("section").filter({ has: page.getByText("Checks", { exact: true }) });
  await expect(checks.getByText("required").first()).toBeVisible();
  // The failing job's log opens at the step that failed.
  await expect(checks.getByRole("button", { name: /Run npm test/ })).toContainText("1 error");
  await expect(checks.getByText("Process completed with exit code 1.")).toBeVisible();
  // What it pointed at sits on the line, in the diff.
  await expect(page.getByText("test failed here")).toBeVisible();

  await checks.getByRole("button", { name: "Re-run test" }).click({ force: true });
  await expect(toast(page, "Re-running test")).toBeVisible();
  await page.goto("/log");
  await expect(page.getByRole("listitem").filter({ hasText: "Re-run job" })).toContainText("Sent", {
    timeout: 15_000,
  });
});

test("one commit, or a run of them, can be looked at on its own", async ({ page }) => {
  await page.goto("/WastedHippie/sandbox-web/pull/7");
  await expect(page.getByRole("heading", { name: "Paginate events with cursors" })).toBeVisible();
  const changes = page
    .getByRole("heading", { level: 2 })
    .filter({ hasText: /^Commit|^Changes|^Since/ });

  await page.keyboard.press("p");
  const picker = page.getByRole("region", { name: "Choose changes" });
  await picker.getByRole("button", { name: /Address review feedback/ }).click();
  await expect(changes).toContainText("Commit 2 of 2");
  await expect(changes).toContainText("1 file");

  // Stretch back over the first commit too.
  await page.keyboard.press("p");
  await expect(picker).toBeVisible();
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("Enter");
  await expect(changes).toContainText("Commits 1 to 2 of 2");
  await expect(changes).toContainText("2 files");

  // An earlier commit is old code, so comments wait for the latest.
  await page.keyboard.press("p");
  await expect(picker).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(changes).toContainText("Commit 1 of 2");
  await expect(page.getByText(/earlier code, so comments are off/)).toBeVisible();
  await page.keyboard.press("c");
  await expect(toast(page, "Comments go on the latest code; p shows it")).toBeVisible();
});

test("files you own are marked, and the filter can narrow to them", async ({ page }) => {
  await page.goto("/WastedHippie/sandbox-web/pull/7");
  await expect(page.getByRole("heading", { name: "Paginate events with cursors" })).toBeVisible();
  const routes = page.locator('[data-file="src/routes/events.ts"]');
  const tests = page.locator('[data-file="test/events.test.ts"]');
  await expect(routes.locator("header")).toContainText("Yours");
  await expect(tests.locator("header")).not.toContainText("Yours");

  // Ticking Viewed with the mouse leaves focus on its checkbox; the keys still work after.
  await tests.getByRole("checkbox").click();
  await expect(tests.getByRole("checkbox")).toBeChecked();
  await page.keyboard.press("d");
  await page.keyboard.press("f");
  const picker = page.getByRole("region", { name: "Show files" });
  await expect(picker).toContainText("Only files you own");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByText("1 of 2 files")).toBeVisible();
  await expect(tests).toHaveCount(0);
  await expect(routes).toBeVisible();
});

test("a reviewer's suggestion goes in as a commit on your branch", async ({ page }) => {
  await page.goto("/WastedHippie/sandbox-web/pull/9");
  await expect(page.getByRole("heading", { name: "Paginate events with cursors" })).toBeVisible();
  const thread = page.locator("[data-thread]").filter({ hasText: "Smaller pages keep this fast" });
  await thread.getByRole("button", { name: "Apply suggestion" }).click();

  const panel = page.getByRole("region", { name: "Apply suggestions" });
  await expect(panel).toContainText("commit 1 suggestion");
  await page.keyboard.press("Enter");
  await expect(toast(page, "Applying 1 suggestion in 5s")).toBeVisible();

  await page.goto("/log");
  await expect(page.getByRole("listitem").filter({ hasText: "Suggestions" })).toContainText(
    "Sent",
    { timeout: 15_000 },
  );
  await page.goto("/WastedHippie/sandbox-web/pull/9");
  await expect(page.locator('[data-file="src/routes/events.ts"]')).toContainText(
    "max(100).default(25)",
  );
  await expect(thread).toContainText("Resolved");
});

test("a search narrows as you type and keeps as a view in the sidebar", async ({ page }) => {
  await page.goto("/inbox/review");
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await page.keyboard.press("/");
  const search = page.getByRole("textbox", { name: "Search" });
  await expect(search).toBeFocused();
  await search.fill("is:open author:sage-smudge cursors");
  const results = page.getByRole("list", { name: "Results" });
  await expect(results).toContainText("Paginate events with cursors");
  await expect(results).not.toContainText("chore(deps)");

  await page.keyboard.press("Meta+s");
  await page.getByRole("textbox", { name: "View name" }).fill("Cursor work");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/v\/cursor-work(-\d+)?$/);
  await expect(page.getByRole("navigation", { name: "Main" })).toContainText("Cursor work");
});

test("a PR can be watched from the keyboard", async ({ page }) => {
  await page.goto("/WastedHippie/sandbox-web/pull/8");
  await expect(page.getByRole("heading", { name: "Document local setup and tests" })).toBeVisible();
  await page.keyboard.press("!");
  await expect(toast(page, "Watching: sandbox-web#8")).toBeVisible();
  await expect(page.locator("header").first()).toContainText("Watching");
});

test("a github.com link to lines opens the PR with them selected", async ({ page }) => {
  // GitHub names a file's anchor after the SHA-256 of its path.
  const anchor = createHash("sha256").update("src/routes/events.ts").digest("hex");
  await page.goto(`/WastedHippie/sandbox-web/pull/7/files#diff-${anchor}R13-R16`);
  await expect(page).toHaveURL(/\/pull\/7#diff-/);
  const selected = page.locator('[data-file="src/routes/events.ts"] [data-selected-line]');
  await expect(selected.first()).toBeAttached();
  await expect(
    page.getByRole("heading", { level: 2 }).filter({ hasText: /^Changes/ }),
  ).toBeVisible();
});

test("a 400-file PR lists every file but draws only the diffs within reach", async ({ page }) => {
  await page.goto("/WastedHippie/sandbox-api/pull/8");
  await expect(
    page.getByRole("heading", { name: "Rename the logger across services" }),
  ).toBeVisible();
  const tree = page.getByRole("navigation", { name: "Files" });
  await expect(tree).toContainText("0 of 400 viewed");
  await expect(page.locator("diffs-container").first()).toBeAttached();
  expect(await page.locator("diffs-container").count()).toBeLessThan(60);

  // The last file is drawn once you get there, and the tree keeps it in sight.
  await tree.getByRole("button", { name: "services/svc-399/start.ts" }).click();
  await expect(
    page.locator('[data-file="services/svc-399/start.ts"] diffs-container'),
  ).toBeAttached();
  await expect(tree.locator('[data-path="services/svc-399/start.ts"]')).toBeInViewport();
});

test("a stacked PR shows its stack, and the palette moves through it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") errors.push(msg.text());
  });
  await page.goto("/WastedHippie/sandbox-cli/pull/6");
  await expect(
    page.getByRole("heading", { name: "Validate config against the schema" }),
  ).toBeVisible();
  const stack = page.getByRole("list", { name: "Stack" });
  await expect(stack.locator("..")).toContainText("2 of 3 on main");

  await page.keyboard.press("g");
  await page.keyboard.press("k");
  await expect(page).toHaveURL(/\/pull\/7$/);
  // Its stack commands exist once its stack is on screen.
  await expect(stack.locator("..")).toContainText("3 of 3 on main");

  await page.keyboard.press("Meta+k");
  await page.keyboard.type("Go down the stack");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/pull\/6$/);
  expect(errors.filter((e) => /Maximum update depth/.test(e))).toEqual([]);

  // Its description links the PR below on github.com; the link opens it here.
  await page.locator('a[href="https://github.com/WastedHippie/sandbox-cli/pull/5"]').click();
  await expect(page).toHaveURL(/\/WastedHippie\/sandbox-cli\/pull\/5$/);
  await expect(page.getByRole("heading", { name: "Load config from TOML files" })).toBeVisible();
});

test("a saved reply goes in where the cursor is", async ({ page }) => {
  await page.goto("/WastedHippie/sandbox-web/pull/8");
  await expect(page.getByRole("heading", { name: "Document local setup and tests" })).toBeVisible();
  const box = page.getByPlaceholder("Add to the conversation");
  await box.click();
  await page.keyboard.type("Nice. ");
  await page.keyboard.press("Control+.");
  const replies = page.getByRole("list", { name: "Saved replies" });
  // Bring the (fake) GitHub ones over, then use the first.
  await replies.getByRole("button", { name: /from GitHub/ }).click();
  await expect(replies).toContainText("Needs a test");
  await page.keyboard.press("Enter");
  await expect(box).toHaveValue("Nice. Thanks for this! Merging once checks are green.");
});
