import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, expect, test } from "@playwright/test";

// The link-capture extension, as `pier extension` writes it, loaded into a real Chromium.
// github.com never answers here: anything that reaches it gets a stub page.

const pier = fileURLToPath(new URL("../apps/daemon/dist/pier", import.meta.url));

test("github.com PR links open in pier, unless they're meant for GitHub", async ({ baseURL }) => {
  const home = mkdtempSync(join(tmpdir(), "pier-extension-"));
  execFileSync(pier, ["extension"], {
    env: { ...process.env, PIER_HOME: home, PIER_PORT: new URL(baseURL ?? "").port },
  });
  const extension = join(home, "extension");
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.route(/^https:\/\/(github\.com|chat\.example)\//, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<title>${new URL(route.request().url()).host}</title>
        <a href="https://github.com/WastedHippie/sandbox-api/pull/6">sandbox-api#6</a>`,
    }),
  );
  const page = context.pages()[0] ?? (await context.newPage());
  const pr = "https://github.com/WastedHippie/sandbox-api/pull/5";

  // Typed or bookmarked. The rules load a moment after the extension does.
  await expect(async () => {
    await page.goto(pr);
    expect(page.url()).toBe(`${baseURL}/WastedHippie/sandbox-api/pull/5`);
  }).toPass();

  // A link to lines keeps its anchor (the flows check it opens with them selected).
  await page.goto(`${pr}/files#diff-${"0".repeat(64)}R3`);
  await expect(page).toHaveURL(
    `${baseURL}/WastedHippie/sandbox-api/pull/5#diff-${"0".repeat(64)}R3`,
  );

  // Followed from another site.
  await page.goto("https://chat.example/");
  await page.getByRole("link").click();
  await expect(page).toHaveURL(`${baseURL}/WastedHippie/sandbox-api/pull/6`);

  // pier's own way to GitHub, and moving around once there, stay on GitHub.
  await page.goto(`${pr}?pier=0`);
  await expect(page).toHaveTitle("github.com");
  await page.getByRole("link").click();
  await expect(page).toHaveURL("https://github.com/WastedHippie/sandbox-api/pull/6");

  await context.close();
});
