import type { ChecksView, WorkflowRunView } from "@pier/core/wire";

// A workflow that runs again on the same commit for the same reason (another review, a manual
// dispatch) supersedes its earlier run, so only the newest run of each shows, the way its
// re-runs replace each other on github.com. Runs of one workflow with different triggers (push
// and pull_request) both stay, told apart by their trigger.

/** One workflow file and one trigger: names can repeat across files, ids can't. */
function keyOf(run: WorkflowRunView): string {
  return `${run.workflowId}:${run.event}`;
}

export function latestRuns(view: ChecksView): ChecksView {
  const newest = new Map<string, number>();
  for (const run of view.workflows) {
    newest.set(keyOf(run), Math.max(newest.get(keyOf(run)) ?? 0, run.id));
  }
  const workflows = view.workflows.filter((run) => newest.get(keyOf(run)) === run.id);
  const byId = new Map(workflows.map((run) => [run.id, run]));
  const superseded = new Set(view.workflows.filter((run) => !byId.has(run.id)).map((r) => r.id));
  const triggers = Map.groupBy(workflows, (run) => run.name);

  return {
    ...view,
    workflows,
    runs: view.runs.flatMap((run) => {
      if (run.runId === null) return [run];
      if (superseded.has(run.runId)) return [];
      const workflow = byId.get(run.runId);
      if (!workflow) return [run];
      const ambiguous = (triggers.get(workflow.name)?.length ?? 0) > 1;
      return [{ ...run, workflow: workflow.name, event: ambiguous ? workflow.event : null }];
    }),
  };
}
