import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { RotateCw } from "lucide-react";
import { type ReactNode, useState } from "react";

import { errorText, rerun } from "@/features/actions";
import { type Command, useCommands } from "@/keys/registry";
import { since } from "@/lib/format";
import { q, qLive, rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import { Dot, type Tone } from "@/ui/dot";
import { Keys } from "@/ui/kbd";
import type { CheckRunView, ChecksView, LogSection, PrView, StepLog } from "@pier/core/wire";

// CI for this PR's head: every check and commit status, which ones are required, and for a
// failing job its log right here, opened at the step that failed. The `f` chord re-runs, cancels
// and approves; held runs and deployments waiting on you say so at the top.

const TONE: Record<CheckRunView["state"], Tone> = {
  success: "ok",
  failure: "bad",
  pending: "warn",
  neutral: "faint",
  skipped: "faint",
};

type RunAction = "rerun-all" | "rerun-job" | "cancel-run" | "approve-run" | "approve-deployment";
type RunTarget = { runId?: number; jobId?: number; environmentIds?: number[]; debug?: boolean };

const EMPTY: ChecksView = { runs: [], workflows: [], deployments: [] };

export function Checks({ pr }: { pr: PrView }) {
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  const { data: view = EMPTY } = useQuery(
    qLive(
      "checks",
      { repo: pr.repo, number: pr.number },
      pr.headRefOid,
      pr.checks.state,
      pr.checks.failing,
      pr.checks.pending,
    ),
  );
  const { runs, workflows, deployments } = view;
  // Annotations on files in the diff show on their lines; the rest (runner messages, files the PR
  // doesn't touch) show under their check. Same query as the canvas's, so it's one fetch.
  const { data: annotations = [] } = useQuery(
    qLive("annotations", { repo: pr.repo, number: pr.number }, pr.headRefOid, pr.checks.state),
  );
  const inDiff = new Set((pr.files ?? []).map((f) => f.path));
  const offDiff = Map.groupBy(
    annotations.filter((a) => !inDiff.has(a.path)),
    (a) => a.check,
  );
  const failing = runs.filter((r) => r.state === "failure");
  // The first failing log opens by itself once checks load; after that it's whatever you chose.
  const [chosen, setOpen] = useState<number | null | undefined>(undefined);
  const open = chosen === undefined ? (failing.find((r) => r.jobId)?.jobId ?? null) : chosen;

  const held = workflows.filter((w) => w.needsApproval);
  const gated = workflows.filter((w) => w.waitingOn.some((env) => env.canApprove));
  const running = workflows.filter((w) => w.state === "pending" && !w.needsApproval);
  const finished = workflows.filter((w) => w.state !== "pending");

  const act = async (action: RunAction, targets: RunTarget[], done: string) => {
    if (targets.length === 0) return;
    try {
      for (const target of targets) await rpc("runAction", { prId: pr.id, action, ...target });
      void client.invalidateQueries();
      toast({ text: done, tone: "ok" });
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };

  const commands: Command[] = [
    {
      id: "checks.rerun-failed",
      title: "Re-run failed jobs",
      keys: ["f r"],
      scope: "surface",
      group: "Checks",
      run: () => void rerun([pr.id]),
    },
    {
      id: "checks.rerun-debug",
      title: "Re-run failed jobs with debug logging",
      keys: ["f d"],
      scope: "surface",
      group: "Checks",
      run: () => void rerun([pr.id], true),
    },
    {
      id: "checks.rerun-all",
      title: "Re-run every job",
      keys: ["f a"],
      scope: "surface",
      group: "Checks",
      run: () =>
        void act(
          "rerun-all",
          finished.map((w) => ({ runId: w.id })),
          `Re-running ${count(finished.length, "workflow")}`,
        ),
    },
    {
      id: "checks.cancel",
      title: "Cancel running workflows",
      keys: ["f x"],
      scope: "surface",
      group: "Checks",
      run: () =>
        void act(
          "cancel-run",
          running.map((w) => ({ runId: w.id })),
          `Cancelling ${count(running.length, "workflow")}`,
        ),
    },
    {
      id: "checks.approve-runs",
      title: "Approve held workflows",
      keys: ["f p"],
      scope: "surface",
      group: "Checks",
      run: () =>
        void act(
          "approve-run",
          held.map((w) => ({ runId: w.id })),
          `Approved ${count(held.length, "workflow")} to run`,
        ),
    },
    {
      id: "checks.approve-deployments",
      title: "Approve deployments waiting on you",
      keys: ["f e"],
      scope: "surface",
      group: "Checks",
      run: () =>
        void act(
          "approve-deployment",
          gated.map((w) => ({
            runId: w.id,
            environmentIds: w.waitingOn.filter((env) => env.canApprove).map((env) => env.id),
          })),
          "Deployment approved",
        ),
    },
  ];
  useCommands(commands);

  if (runs.length === 0 && workflows.length === 0 && deployments.length === 0) return null;

  const required = new Set(pr.requiredChecks);
  const ordered = runs.toSorted(
    (a, b) =>
      rank(a.state) - rank(b.state) ||
      Number(required.has(b.name)) - Number(required.has(a.name)) ||
      a.name.localeCompare(b.name),
  );
  return (
    <section className="mt-6">
      <h2 className="mb-2 flex items-baseline gap-4 text-meta">
        <span className="text-muted">Checks</span>
        {failing.length > 0 && <Hint keys="f r">re-run failed</Hint>}
        {failing.length > 0 && <Hint keys="f d">with debug logs</Hint>}
        {running.length > 0 && <Hint keys="f x">cancel</Hint>}
      </h2>

      {held.length > 0 && (
        <Banner keys="f p" action="approve">
          {held.map((w) => w.name).join(", ")} {held.length === 1 ? "is" : "are"} waiting for
          approval to run (a first-time or fork contributor).
        </Banner>
      )}
      {gated.map((w) => (
        <Banner key={w.id} keys="f e" action="approve">
          {w.name} is waiting for you to approve deploying to{" "}
          {w.waitingOn.map((env) => env.name).join(", ")}.
        </Banner>
      ))}

      <ul className="max-w-[900px] space-y-0.5">
        {ordered.map((run) => {
          const hasLog = run.jobId !== null && run.state !== "pending";
          return (
            <li key={`${run.kind}-${run.id}`} className="group/check">
              <div className="flex h-7 items-center gap-3 rounded-sm px-2 text-meta hover:bg-hover">
                <Dot tone={TONE[run.state]} />
                <span
                  className={clsx(
                    "min-w-0 shrink-0 truncate",
                    run.state === "failure" ? "text-bad" : "text-muted",
                  )}
                >
                  {run.name}
                </span>
                {required.has(run.name) && <span className="shrink-0 text-faint">required</span>}
                <span className="min-w-0 flex-1 truncate text-faint">{run.summary}</span>
                {(run.state === "pending" ||
                  run.state === "skipped" ||
                  run.state === "neutral") && (
                  <span className="shrink-0 text-faint">
                    {run.state === "pending" ? "running" : run.state}
                  </span>
                )}
                {run.completedAt && (
                  <span className="shrink-0 text-faint">{since(run.completedAt)}</span>
                )}
                {hasLog && (
                  <button
                    type="button"
                    aria-label={`Re-run ${run.name}`}
                    title="Re-run this job"
                    onClick={() =>
                      void act("rerun-job", [{ jobId: run.jobId ?? 0 }], `Re-running ${run.name}`)
                    }
                    className="flex size-6 shrink-0 items-center justify-center rounded-sm text-faint opacity-0 group-hover/check:opacity-100 hover:bg-press hover:text-fg focus-visible:opacity-100"
                  >
                    <RotateCw aria-hidden size={13} />
                  </button>
                )}
                {hasLog ? (
                  <button
                    type="button"
                    onClick={() => setOpen(open === run.jobId ? null : run.jobId)}
                    className="shrink-0 text-faint hover:text-fg"
                  >
                    {open === run.jobId ? "Hide log" : "Log"}
                  </button>
                ) : (
                  run.url && (
                    <a
                      href={run.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="shrink-0 text-faint hover:text-fg"
                    >
                      Details
                    </a>
                  )
                )}
              </div>
              {(offDiff.get(run.name) ?? []).length > 0 && (
                <ul className="mb-1 ml-7 space-y-0.5">
                  {(offDiff.get(run.name) ?? []).slice(0, 5).map((a) => (
                    <li
                      key={`${a.path}:${a.startLine}:${a.message}`}
                      className="flex items-baseline gap-2 text-meta"
                    >
                      <Dot
                        tone={
                          a.level === "failure" ? "bad" : a.level === "warning" ? "warn" : "info"
                        }
                      />
                      <span className="min-w-0 truncate text-muted" title={a.message}>
                        {a.title ? `${a.title}: ` : ""}
                        {a.message.split("\n")[0]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {open !== null && open === run.jobId && <Log repo={pr.repo} jobId={open} />}
            </li>
          );
        })}
      </ul>

      {deployments.length > 0 && (
        <>
          <h3 className="mt-4 mb-1 text-meta text-muted">Deployments</h3>
          <ul className="max-w-[900px] space-y-0.5">
            {deployments.map((d) => (
              <li key={d.id} className="flex h-7 items-center gap-3 px-2 text-meta">
                <Dot tone={deploymentTone(d.state)} />
                <span className="text-muted">{d.environment}</span>
                <span className="text-faint">{d.state.replaceAll("_", " ")}</span>
                <span className="flex-1" />
                <span className="text-faint">{since(d.at)}</span>
                {d.url && (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-faint hover:text-fg"
                  >
                    Open
                  </a>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Hint({ keys, children }: { keys: string; children: string }) {
  return (
    <span className="flex items-center gap-1.5 text-faint">
      <Keys sequence={keys} /> {children}
    </span>
  );
}

function Banner({ keys, action, children }: { keys: string; action: string; children: ReactNode }) {
  return (
    <p className="mb-2 flex max-w-[900px] items-center gap-3 rounded-sm border border-warn/40 px-3 py-2 text-meta text-fg">
      <Dot tone="warn" />
      <span className="flex-1">{children}</span>
      <Hint keys={keys}>{action}</Hint>
    </p>
  );
}

/** A job's log by step: steps that failed are open, the rest are a line each until opened. */
function Log({ repo, jobId }: { repo: string; jobId: number }) {
  const { data: log, isPending } = useQuery(q("checkLog", { repo, jobId }));
  if (isPending) return <p className="px-2 py-2 text-meta text-faint">Loading the log</p>;
  if (!log)
    return (
      <p className="px-2 py-2 text-meta text-faint">GitHub didn't return a log for this job.</p>
    );
  const anyErrors = log.steps.some((step) => errorsIn(step) > 0);
  return (
    <div className="my-1 max-w-[900px] rounded-md border border-line font-code text-[12px] leading-5">
      {log.truncated && (
        <p className="border-b border-line px-3 py-1.5 font-ui text-meta text-faint">
          Showing the end of a long log.{" "}
          <a href={log.url} target="_blank" rel="noreferrer noopener" className="hover:text-fg">
            Full log on GitHub
          </a>
        </p>
      )}
      {log.steps.map((step, i) => (
        <Fold
          // Steps can share a name (the same action twice), so position is part of who they are.
          // oxlint-disable-next-line react/no-array-index-key
          key={`${i}-${step.name}`}
          title={step.name}
          tone={TONE[step.state]}
          errors={errorsIn(step)}
          lines={step.sections.reduce((n, s) => n + s.lines.length, 0)}
          // Without errors (a cancelled or timed-out job), the last step is where it stopped.
          initiallyOpen={
            errorsIn(step) > 0 ||
            step.state === "failure" ||
            (!anyErrors && i === log.steps.length - 1)
          }
        >
          {step.sections.length === 1 && step.sections[0] ? (
            <Lines section={step.sections[0]} />
          ) : (
            step.sections.map((section, j) => (
              <Fold
                // oxlint-disable-next-line react/no-array-index-key
                key={`${j}-${section.title}`}
                title={section.title}
                errors={section.errors.length}
                lines={section.lines.length}
                initiallyOpen={section.errors.length > 0}
                nested
              >
                <Lines section={section} />
              </Fold>
            ))
          )}
        </Fold>
      ))}
    </div>
  );
}

function Fold({
  title,
  tone,
  errors,
  lines,
  initiallyOpen,
  nested = false,
  children,
}: {
  title: string;
  tone?: Tone;
  errors: number;
  lines: number;
  initiallyOpen: boolean;
  nested?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div className={clsx(!nested && "border-b border-line last:border-b-0")}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={clsx(
          "flex w-full items-center gap-2 py-1 pr-3 text-left font-ui text-meta hover:bg-hover",
          nested ? "pl-8" : "pl-3",
        )}
      >
        <span aria-hidden className="w-3 text-faint">
          {open ? "▾" : "▸"}
        </span>
        {tone && <Dot tone={tone} />}
        <span className={clsx("truncate", errors > 0 ? "text-bad" : "text-muted")}>{title}</span>
        <span className="ml-auto shrink-0 text-faint">
          {errors > 0 ? count(errors, "error") : count(lines, "line")}
        </span>
      </button>
      {open && children}
    </div>
  );
}

function Lines({ section }: { section: LogSection }) {
  const errors = new Set(section.errors);
  // Long outputs start a little before the first error, which is where the story usually begins.
  const first = section.errors[0];
  const from = first === undefined ? 0 : Math.max(0, first - 40);
  if (section.lines.length === 0) return null;
  return (
    <pre className="max-h-[420px] overflow-auto px-3 pb-2 text-muted">
      {from > 0 && <span className="block text-faint">{count(from, "earlier line")}</span>}
      {section.lines.slice(from).map((line, i) => (
        <span
          // Log lines repeat, so their position is their identity.
          // oxlint-disable-next-line react/no-array-index-key
          key={i}
          className={clsx("block", errors.has(from + i) && "text-bad")}
        >
          {line || " "}
        </span>
      ))}
    </pre>
  );
}

function rank(state: CheckRunView["state"]): number {
  return state === "failure" ? 0 : state === "pending" ? 1 : 2;
}

function deploymentTone(state: string): Tone {
  if (state === "success" || state === "active") return "ok";
  if (state === "failure" || state === "error") return "bad";
  return state === "inactive" ? "faint" : "warn";
}

function count(n: number, noun: string): string {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}

function errorsIn(step: StepLog): number {
  return step.sections.reduce((n, s) => n + s.errors.length, 0);
}
