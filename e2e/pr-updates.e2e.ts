import { expect, test, type Page } from "@playwright/test";

import type { Input, Output, ProcedureName } from "../packages/core/src/contract";
import type { FlightItem } from "../packages/core/src/wire";

async function rpc<N extends ProcedureName>(page: Page, name: N, input: Input<N>) {
  return page.evaluate(
    async ({ procedure, payload }) => {
      const response = await fetch(`/api/rpc/${procedure}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-pier": "1" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json() as Promise<Output<N>>;
    },
    { procedure: name, payload: input },
  );
}

for (const [split, number] of [
  ["review", 8],
  ["mine", 9],
] as const) {
  test(`${split} shows updates after viewing a PR and clears them on opening`, async ({
    page,
  }, info) => {
    await page.goto(`/inbox/${split}`);
    const row = page.getByRole("button").filter({ hasText: `sandbox-web#${number}` });
    await expect(row).toBeVisible();
    await row.dblclick();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const pr = await rpc(page, "pr", { repo: "WastedHippie/sandbox-web", number });
    expect(pr).not.toBeNull();
    await expect
      .poll(
        async () =>
          (await rpc(page, "search", { q: "repo:WastedHippie/sandbox-web" })).items.find(
            (item) => item.id === pr!.id,
          )?.activity,
      )
      .toBe("read");
    await page.goto(`/inbox/${split}`);
    await expect(row.getByText("New", { exact: true })).toBeHidden();
    await expect(row.getByText("Updated", { exact: true })).toBeHidden();

    try {
      // Change the fake GitHub PR while its page is closed, through the real write/sync path.
      await rpc(page, "editPr", { prId: pr!.id, title: `${pr!.title} (updated)` });
      await expect(row).toContainText(`${pr!.title} (updated)`);
      await page.screenshot({ path: info.outputPath(`${split}-updated.png`) });
      await expect(row.getByText("Updated", { exact: true })).toBeVisible();
      await page.reload();
      await expect(row.getByText("Updated", { exact: true })).toBeVisible();

      await row.dblclick();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${pr!.title} (updated)`);
      await expect
        .poll(
          async () =>
            (await rpc(page, "search", { q: "repo:WastedHippie/sandbox-web" })).items.find(
              (item) => item.id === pr!.id,
            )?.activity,
        )
        .toBe("read");
      await page.goto(`/inbox/${split}`);
      await expect(row.getByText("Updated", { exact: true })).toBeHidden();
      await page.reload();
      await expect(row).toBeVisible();
      await expect(row.getByText("Updated", { exact: true })).toBeHidden();
      await expect(row.getByText("New", { exact: true })).toBeHidden();
    } finally {
      const { commandIds } = await rpc(page, "editPr", { prId: pr!.id, title: pr!.title });
      await expect
        .poll(async () => (await rpc(page, "commandResult", { commandId: commandIds[0] }))?.state)
        .toBe("acked");
      await expect
        .poll(
          async () =>
            (await rpc(page, "search", { q: "repo:WastedHippie/sandbox-web" })).items.find(
              (item) => item.id === pr!.id,
            )?.title,
        )
        .toBe(pr!.title);
    }
  });
}

test("In flight displays read state and opens a tracked PR in pier", async ({ page }, info) => {
  await page.goto("/WastedHippie/sandbox-web/pull/9");
  const pr = await rpc(page, "pr", { repo: "WastedHippie/sandbox-web", number: 9 });
  const items: FlightItem[] = [
    {
      prId: pr!.id,
      repo: pr!.repo,
      number: pr!.number,
      title: pr!.title,
      url: pr!.url,
      account: pr!.account,
      activity: "read",
      waitingOn: "Waiting on review",
      checks: pr!.checks,
      mergePath: "unknown",
      updatedAt: pr!.updatedAt,
    },
  ];
  await page.route("**/api/rpc/flight", (route) => route.fulfill({ json: items }));
  await page.goto("/flight");
  const row = page.getByRole("button").filter({ hasText: "sandbox-web#9" });
  await expect(row).toBeVisible();
  await expect(row.getByText("New", { exact: true })).toBeHidden();
  await expect(row.getByText("Updated", { exact: true })).toBeHidden();
  await page.screenshot({ path: info.outputPath("in-flight-read.png") });
  await row.dblclick();
  await expect(page).toHaveURL(/\/WastedHippie\/sandbox-web\/pull\/9$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(pr!.title);
});
