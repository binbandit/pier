import { expect, test } from "@playwright/test";

import type { PrView, TimelineEntry } from "../packages/core/src/wire";

const at = "2026-10-14T01:00:00Z";
const updates: TimelineEntry[] = [
  { kind: "event", actor: "octocat", text: "requested review from sage-smudge", at },
  {
    kind: "commit",
    oid: "1234567890",
    headline: "Tighten cursor validation",
    author: "octocat",
    at,
  },
  { kind: "force-push", actor: "octocat", before: "1234567890", after: "9876543210", at },
];
const comment = {
  body: "Please keep this discussion visible.",
  bodyHTML: "<p>Please keep this discussion visible.</p>",
  author: null,
  edited: false,
  canEdit: false,
  canDelete: false,
  canMinimize: false,
  minimized: null,
  reactions: [],
  unsent: false,
  at,
} as const;

test("history updates toggle by key and button, persist, and leave the discussion visible", async ({
  page,
}) => {
  await page.route("**/api/rpc/pr", async (route) => {
    const response = await route.fetch({
      headers: { ...route.request().headers(), "sec-fetch-site": "same-origin" },
    });
    const pr = (await response.json()) as PrView;
    const timeline: TimelineEntry[] = [
      ...updates,
      { ...comment, reactions: [], kind: "comment", subject: "issue-comment", id: "discussion" },
      {
        ...comment,
        reactions: [],
        kind: "review",
        subject: "review",
        id: "approval",
        state: "APPROVED",
        commitOid: null,
        canDismiss: false,
        body: "",
        bodyHTML: "",
      },
    ];
    await route.fulfill({ response, json: { ...pr, timeline } });
  });
  await page.goto("/WastedHippie/sandbox-web/pull/8");
  const activity = page.getByRole("complementary", { name: "Activity", exact: true });
  const request = activity.getByText(/requested review from/);
  await expect(request).toBeVisible();
  await expect(activity.getByRole("button", { name: "Hide history updates" })).toBeVisible();

  await page.keyboard.press("h");
  await expect(request).toBeHidden();
  await expect(activity.getByText("Tighten cursor validation")).toBeHidden();
  await expect(activity.getByText(/force-pushed/)).toBeHidden();
  await expect(activity.getByText(comment.body)).toBeVisible();
  await expect(activity.getByText("approved", { exact: true })).toBeVisible();

  await page.reload();
  const show = activity.getByRole("button", { name: "Show history updates" });
  await expect(show).toBeVisible();
  await expect(request).toBeHidden();

  const input = activity.getByRole("textbox");
  await input.fill("h is part of my comment");
  await input.press("h");
  await expect(show).toBeVisible();
  await show.click();
  await expect(request).toBeVisible();
  await page.reload();
  await expect(activity.getByRole("button", { name: "Hide history updates" })).toBeVisible();
  await expect(request).toBeVisible();
});

test("an activity feed containing only updates explains the filtered state", async ({ page }) => {
  await page.route("**/api/rpc/pr", async (route) => {
    const response = await route.fetch({
      headers: { ...route.request().headers(), "sec-fetch-site": "same-origin" },
    });
    const pr = (await response.json()) as PrView;
    await route.fulfill({ response, json: { ...pr, timeline: updates } });
  });
  await page.goto("/WastedHippie/sandbox-web/pull/8");
  const activity = page.getByRole("complementary", { name: "Activity", exact: true });
  await activity.getByRole("button", { name: "Hide history updates" }).click();
  await expect(
    activity.getByText("No comments or reviews yet. History updates are hidden."),
  ).toBeVisible();
  await activity.getByRole("button", { name: "Show history updates" }).click();
  await expect(activity.getByText(/requested review from/)).toBeVisible();
});
