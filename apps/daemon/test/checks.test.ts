import { expect, test } from "bun:test";

import { latestRuns } from "@/domain/checks";
import type { CheckRunView, WorkflowRunView } from "@pier/core/wire";

const workflow = (id: number, name: string, event: string): WorkflowRunView => ({
  id,
  name,
  event,
  state: "success",
  needsApproval: false,
  waitingOn: [],
  url: "",
});
const job = (id: number, name: string, runId: number | null): CheckRunView => ({
  id,
  name,
  state: "success",
  kind: runId === null ? "status" : "check",
  jobId: runId === null ? null : id,
  runId,
  url: "",
  summary: null,
  startedAt: null,
  completedAt: null,
  annotations: 0,
  workflow: null,
  event: null,
});

test("a workflow run again for the same trigger replaces its earlier run", () => {
  const view = latestRuns({
    workflows: [
      workflow(10, "merge approved bumps", "pull_request_review"),
      workflow(12, "merge approved bumps", "pull_request_review"),
      workflow(11, "ci", "push"),
      workflow(13, "ci", "pull_request"),
    ],
    runs: [
      job(1, "merge", 10),
      job(2, "merge", 12),
      job(3, "test", 11),
      job(4, "test", 13),
      job(5, "netlify", null),
    ],
    deployments: [],
  });
  expect(view.workflows.map((w) => w.id)).toEqual([12, 11, 13]);
  expect(view.runs.map((r) => [r.id, r.workflow, r.event])).toEqual([
    [2, "merge approved bumps", null],
    [3, "ci", "push"],
    [4, "ci", "pull_request"],
    [5, null, null],
  ]);
});
