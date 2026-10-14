import { expect, type Page, test } from "@playwright/test";

async function saveView(page: Page, label: string) {
  const name = `${label} ${crypto.randomUUID().slice(0, 8)}`;
  const query = "is:open repo:WastedHippie/sandbox-api";
  await page.goto("/search");
  await page.getByRole("textbox", { name: "Search", exact: true }).fill(query);
  await page.keyboard.press("Meta+s");
  await page.getByRole("textbox", { name: "View name", exact: true }).fill(name);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return { name, query };
}

test("sidebar views can be renamed without leaving the current page", async ({ page }, info) => {
  const { name, query } = await saveView(page, "Sidebar rename");
  const views = page.getByRole("list", { name: "Views", exact: true });
  const link = views.getByRole("link", { name });
  await page.goto("/inbox/deps");
  await link.click({ button: "right" });
  await info.attach("sidebar-context-menu", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Rename" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await link.click({ button: "right" });
  await page.mouse.click(700, 30);
  await expect(menu).toBeHidden();
  await link.focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  await expect(menu).toBeFocused();
  await page.keyboard.press("Home");
  await expect(menu.getByRole("menuitem", { name: "Rename" })).toBeFocused();
  await page.keyboard.press("Enter");
  const input = page.getByRole("textbox", { name: "View name", exact: true });
  await expect(input).toBeFocused();
  await input.fill("   ");
  await page.keyboard.press("Enter");
  await expect(input).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(link).toBeVisible();
  await expect(input).toBeHidden();

  await link.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Rename" }).click();
  const renamed = `${name} renamed`;
  await input.fill(`  ${renamed}  `);
  await page.keyboard.press("Enter");
  await expect(views.getByRole("link", { name: renamed })).toBeVisible();
  await expect(page).toHaveURL(/\/inbox\/deps$/);
  await page.reload();
  await views.getByRole("link", { name: renamed }).click();
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search", exact: true })).toHaveValue(query);
});

test("a failed sidebar rename keeps the edited name available to retry", async ({ page }) => {
  const { name } = await saveView(page, "Sidebar retry");
  const views = page.getByRole("list", { name: "Views", exact: true });
  await views.getByRole("link", { name }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const input = page.getByRole("textbox", { name: "View name", exact: true });
  const renamed = `${name} recovered`;
  await input.fill(renamed);
  await page.route("**/api/rpc/saveView", (route) =>
    route.fulfill({ status: 500, json: { error: "Could not save this view" } }),
  );
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").getByText("Could not save this view")).toBeVisible();
  await expect(input).toHaveValue(renamed);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.unroute("**/api/rpc/saveView");
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
  await page.reload();
  await expect(views.getByRole("link", { name: renamed })).toBeVisible();
});

test("deleting sidebar views preserves the current page or the deleted view's search", async ({
  page,
}) => {
  const views = page.getByRole("list", { name: "Views", exact: true });
  const inactive = await saveView(page, "Sidebar inactive delete");
  await page.goto("/inbox/deps");
  await views.getByRole("link", { name: inactive.name }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(views.getByRole("link", { name: inactive.name })).toBeHidden();
  await expect(page).toHaveURL(/\/inbox\/deps$/);
  await page.reload();
  await expect(views.getByRole("link", { name: inactive.name })).toBeHidden();

  const active = await saveView(page, "Sidebar active delete");
  await views.getByRole("link", { name: active.name }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: "Search", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search", exact: true })).toHaveValue(
    active.query,
  );
  await page.reload();
  await expect(views.getByRole("link", { name: active.name })).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Search", exact: true })).toHaveValue(
    active.query,
  );
});
