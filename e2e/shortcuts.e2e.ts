import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

test("y copies GitHub PR and selected-line links without intercepting typing", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/WastedHippie/sandbox-web/pull/8");
  await expect(page.getByRole("heading", { name: "Document local setup and tests" })).toBeVisible();
  await page.keyboard.press("y");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("https://github.com/WastedHippie/sandbox-web/pull/8");
  await expect(page.getByRole("status")).toContainText("Copied a link to sandbox-web#8");

  await page.evaluate(() => navigator.clipboard.writeText("Keep this clipboard text"));
  const comment = page.getByPlaceholder("Add to the conversation");
  await comment.press("y");
  await expect(comment).toHaveValue("y");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "Keep this clipboard text",
  );

  const anchor = createHash("sha256").update("src/routes/events.ts").digest("hex");
  const path = `/WastedHippie/sandbox-web/pull/7/files#diff-${anchor}R13-R16`;
  await page.goto(path);
  await expect(page.locator("[data-selected-line]").first()).toBeAttached();
  await page.keyboard.press("y");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(`https://github.com${path}`);
});

test("the shortcuts modal searches command names, sections and keys", async ({ page }, info) => {
  await page.goto("/WastedHippie/sandbox-web/pull/8");
  await expect(page.getByRole("heading", { name: "Document local setup and tests" })).toBeVisible();
  await page.keyboard.press("?");
  const modal = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  const search = modal.getByRole("textbox", { name: "Search shortcuts" });
  await expect(search).toBeFocused();
  await expect(modal.getByText("Copy the GitHub PR link", { exact: true })).toBeVisible();

  await search.fill("  COPY github  ");
  await expect(modal.getByRole("listitem")).toHaveCount(1);
  await expect(modal.getByRole("listitem")).toContainText("Copy the GitHub PR link");
  await expect(modal.getByRole("listitem").locator("kbd")).toHaveText("y");
  await page.screenshot({ path: info.outputPath("shortcuts-search.png"), animations: "disabled" });

  await search.fill("Go to");
  await expect(modal.getByRole("heading", { level: 3 })).toHaveText(["Go to", "Review"]);
  await expect(modal.getByText("Copy the branch name")).toBeVisible();
  await expect(modal.getByText("Mark file viewed and go to the next")).toBeVisible();
  for (const query of ["shift+y", "⇧y"]) {
    await search.fill(query);
    await expect(modal.getByRole("listitem")).toHaveCount(1);
    await expect(modal.getByRole("listitem")).toContainText("Copy the branch name");
  }

  await search.fill("no matching shortcut");
  await expect(modal.getByRole("status")).toContainText("No shortcuts match");
  await expect(modal.getByRole("listitem")).toHaveCount(0);
  await search.fill("");
  await search.pressSequentially("?");
  await expect(search).toHaveValue("?");
  await expect(modal.getByRole("listitem")).toContainText("Keyboard shortcuts");
  await search.press("Escape");
  await expect(modal).toBeHidden();
  await page.keyboard.press("?");
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await page.screenshot({ path: info.outputPath("shortcuts-all.png"), animations: "disabled" });
  await modal.getByRole("listitem").last().scrollIntoViewIfNeeded();
  await expect(search).toBeInViewport();
});
