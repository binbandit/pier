import type { ChecksView } from "@pier/core/wire";

// A workflow that runs again on the same commit for the same reason (another review, a manual
// dispatch) supersedes its earlier run, so only the newest run of each shows, the way its
// re-runs replace each other on github.com. Runs of one workflow with different triggers (push
// and pull_request) both stay, told apart by their trigger.

export function latestRuns(view: ChecksView): ChecksView {
  const newest = new Map<string, number>();
  for (const run of view.workflows) {
    const key = `${run.name}\u0000${run.event}`;
    newest.set(key, Math.max(newest.get(key) ?? 0, run.id));
  }
  const workflows = view.workflows.filter(
    (run) => newest.get(`${run.name}\u0000${run.event}`) === run.id,
  );
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
