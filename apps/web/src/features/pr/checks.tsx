import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useState } from "react";

import { since } from "@/lib/format";
import { q, qLive } from "@/lib/rpc";
import { Dot, type Tone } from "@/ui/dot";
import { Keys } from "@/ui/kbd";
import type { CheckRunView, PrView } from "@pier/core/wire";

// CI for this PR's head: every check, and for a failing one the end of its log right here, which
// is where the reason almost always is. `f r` re-runs the failed jobs.

const TONE: Record<CheckRunView["state"], Tone> = {
  success: "ok",
  failure: "bad",
  pending: "warn",
  neutral: "faint",
  skipped: "faint",
};

export function Checks({ pr }: { pr: PrView }) {
  const { data: runs = [] } = useQuery(
    qLive(
      "checks",
      { repo: pr.repo, number: pr.number },
      pr.headRefOid,
      pr.checks.state,
      pr.checks.failing,
      pr.checks.pending,
    ),
  );
  const failing = runs.filter((r) => r.state === "failure");
  // The first failing log opens by itself once checks load; after that it's whatever you chose.
  const [chosen, setOpen] = useState<number | null | undefined>(undefined);
  const open = chosen === undefined ? (failing[0]?.jobId ?? null) : chosen;
  if (runs.length === 0) return null;

  const ordered = runs.toSorted(
    (a, b) => rank(a.state) - rank(b.state) || a.name.localeCompare(b.name),
  );
  return (
    <section className="mt-6">
      <h2 className="mb-2 flex items-baseline gap-3 text-meta">
        <span className="text-muted">Checks</span>
        {failing.length > 0 && (
          <span className="flex items-center gap-1.5 text-faint">
            <Keys sequence="f r" /> re-run failed
          </span>
        )}
      </h2>
      <ul className="max-w-[900px] space-y-0.5">
        {ordered.map((run) => (
          <li key={run.id}>
            <button
              type="button"
              onClick={() => setOpen(open === run.jobId ? null : run.jobId)}
              disabled={run.jobId === null || run.state !== "failure"}
              className="flex h-7 w-full items-center gap-3 rounded-sm px-2 text-left text-meta enabled:hover:bg-hover"
            >
              <Dot tone={TONE[run.state]} />
              <span
                className={clsx(
                  "flex-1 truncate",
                  run.state === "failure" ? "text-bad" : "text-muted",
                )}
              >
                {run.name}
              </span>
              {run.completedAt && <span className="text-faint">{since(run.completedAt)}</span>}
              {run.state === "failure" && run.jobId !== null && (
                <span className="text-faint">{open === run.jobId ? "Hide log" : "Log"}</span>
              )}
            </button>
            {open !== null && open === run.jobId && <Log repo={pr.repo} jobId={open} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Log({ repo, jobId }: { repo: string; jobId: number }) {
  const { data: log, isPending } = useQuery(q("checkLog", { repo, jobId }));
  if (isPending) return <p className="px-2 py-2 text-meta text-faint">Loading the log</p>;
  if (!log)
    return (
      <p className="px-2 py-2 text-meta text-faint">GitHub didn't return a log for this job.</p>
    );
  // Start a little before the first error, which is where the story usually begins.
  const firstError = log.errors[0] ?? log.lines.length;
  const from = Math.max(0, firstError - 30);
  const errors = new Set(log.errors);
  return (
    <pre className="my-1 max-h-[420px] overflow-auto rounded-md border border-line px-3 py-2 font-code text-[12px] leading-5 text-muted">
      {log.lines.slice(from).map((line, i) => (
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
