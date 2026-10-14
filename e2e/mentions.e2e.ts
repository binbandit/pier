import { expect, test } from "@playwright/test";

test("comment mentions prioritize PR participants and insert at the caret", async ({ page }) => {
  await page.goto("/WastedHippie/sandbox-web/pull/8");
  const box = page.getByPlaceholder("Add to the conversation");
  await box.fill("Please ask @ about this.");
  await box.press("End");
  for (let i = 0; i < " about this.".length; i++) await box.press("ArrowLeft");
  const suggestions = page.getByRole("listbox", { name: "Mention people" });
  await expect(suggestions).toBeVisible();
  await expect(suggestions.getByRole("option").first()).toContainText("sage-smudge");
  await expect(suggestions).toContainText("PR participant");
  await expect(suggestions).toContainText("Repository");
  const logins = await suggestions.getByRole("option").allTextContents();
  expect(logins.filter((text) => text.includes("sage-smudge"))).toHaveLength(1);
  await box.press("ArrowDown");
  await expect(suggestions.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  await box.press("ArrowUp");
  await box.press("Enter");
  await expect(box).toHaveValue("Please ask @sage-smudge about this.");
  await expect(suggestions).toBeHidden();

  await box.fill("@was");
  await expect(suggestions.getByRole("option", { name: /WastedHippie/ })).toBeVisible();
  await suggestions.getByRole("option", { name: /WastedHippie/ }).click();
  await expect(box).toHaveValue("@WastedHippie ");
  await box.fill("mail@example.com");
  await expect(suggestions).toBeHidden();

  await box.fill("Thanks @sage");
  await expect(suggestions).toBeVisible();
  await box.press("Escape");
  await expect(suggestions).toBeHidden();
  await expect(box).toBeFocused();
  await expect(box).toHaveValue("Thanks @sage");

  await box.fill("@sage");
  await expect(suggestions).toBeVisible();
  await box.press("Enter");
  const message = `thanks for the context ${crypto.randomUUID().slice(0, 8)}.`;
  await box.pressSequentially(message);
  await box.press("Meta+Enter");
  await page.goto("/log");
  await expect(
    page.getByRole("listitem").filter({ hasText: "sandbox-web#8" }).first(),
  ).toContainText("Sent", { timeout: 15_000 });
  await page.goto("/WastedHippie/sandbox-web/pull/8");
  const activity = page.getByRole("complementary", { name: "Activity" });
  await expect(activity.getByText(`@sage-smudge ${message}`, { exact: true })).toBeVisible();
  await page.reload();
  await expect(activity.getByText(`@sage-smudge ${message}`, { exact: true })).toBeVisible();
});

test("mentions in a review insert without submitting it", async ({ page }) => {
  await page.goto("/WastedHippie/sandbox-web/pull/8");
  await expect(page.getByRole("heading", { name: "Document local setup and tests" })).toBeVisible();
  await page.keyboard.press("r");
  const review = page.getByRole("region", { name: "Review", exact: true });
  const box = review.getByRole("textbox");
  await box.fill("Thanks @bi");
  const suggestions = page.getByRole("listbox", { name: "Mention people" });
  await expect(suggestions.getByRole("option", { name: /binbandit/ })).toBeVisible();
  await box.press("Tab");
  await expect(box).toHaveValue("Thanks @binbandit ");
  await expect(review).toBeVisible();
  await expect(box).toBeFocused();
  await box.press("Escape");
  await expect(review).toBeHidden();
});

test("PR participants remain available when repository people cannot load", async ({ page }) => {
  await page.route("**/api/rpc/assignable", (route) =>
    route.fulfill({ status: 500, json: { error: "Repository lookup unavailable" } }),
  );
  await page.goto("/WastedHippie/sandbox-web/pull/8");
  const box = page.getByPlaceholder("Add to the conversation");
  await box.fill("@sage");
  const suggestions = page.getByRole("listbox", { name: "Mention people" });
  await expect(suggestions.getByRole("option", { name: /sage-smudge/ })).toBeVisible();
  await expect(page.getByText("Repository people unavailable", { exact: true })).toBeVisible();
  await box.press("Enter");
  await expect(box).toHaveValue("@sage-smudge ");
  await expect(box).toBeFocused();
});
