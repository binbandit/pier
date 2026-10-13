import type { CheckRun, LogSection, StepLog } from "@pier/core/wire";

// An Actions job log, cut into the sections GitHub draws: each `##[group]` line starts one (a
// step's command), and everything up to the next group (the step's output) belongs to it. Errors
// are the lines GitHub marked `##[error]`. Only the end of a long log is kept, which is where
// the failure almost always is.

const MAX_LINES = 5_000;
// Colour codes start with the escape character, which is the point of matching it.
// oxlint-disable-next-line no-control-regex
const ANSI_COLOUR = /\u001b\[[\d;]*m/g;

const TIMESTAMP = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) ?/;

/** `cutAt`: when the log was cut, the time of its first kept line (which step it's inside). */
export function parseJobLog(text: string): {
  sections: LogSection[];
  truncated: boolean;
  cutAt: string | null;
} {
  const stamped = text.replace(/\r\n/g, "\n").split("\n");
  const truncated = stamped.length > MAX_LINES;
  const kept = truncated ? stamped.slice(-MAX_LINES) : stamped;
  const cutAt = truncated ? (TIMESTAMP.exec(kept[0] ?? "")?.[1] ?? null) : null;
  // Every line starts with a timestamp, and many carry terminal colours; neither reads here.
  const lines = kept.map((line) => line.replace(TIMESTAMP, "").replace(ANSI_COLOUR, ""));

  const sections: LogSection[] = [];
  let current: LogSection = {
    title: truncated ? "Earlier output" : "Set up job",
    lines: [],
    errors: [],
  };
  for (const raw of lines) {
    if (raw.startsWith("##[group]")) {
      if (current.lines.length > 0 || sections.length > 0) sections.push(current);
      current = { title: raw.slice("##[group]".length).trim(), lines: [], errors: [] };
      continue;
    }
    if (raw.startsWith("##[endgroup]")) continue;
    const isError = raw.includes("##[error]");
    const line = raw.replace("##[error]", "").replace(/^##\[(warning|notice|debug)\]/, "");
    if (isError) current.errors.push(current.lines.length);
    current.lines.push(line);
  }
  sections.push(current);
  // A trailing blank line from the final newline isn't output.
  const last = sections.at(-1);
  if (last && last.lines.at(-1) === "") last.lines.pop();
  return { sections, truncated, cutAt };
}

/**
 * Puts each log section under the job step that wrote it. A step's log starts with a group named
 * after the step ("Run npm test"); groups an action opens itself ("Fetching the repository")
 * belong to the step before. Output before the first named step is the job's set-up, or, in a
 * log cut short (`cutAt`), the step that was running when the kept part begins.
 */
export function byStep(
  steps: { name: string; state: CheckRun["state"]; startedAt?: string | null }[],
  sections: LogSection[],
  cutAt: string | null = null,
): StepLog[] {
  // Compared to the second: steps carry whole seconds, log lines fractions of one.
  const first = cutAt
    ? Math.max(
        0,
        steps.findLastIndex((step) => (step.startedAt ?? "").slice(0, 19) <= cutAt.slice(0, 19)),
      )
    : 0;
  const out: StepLog[] = [];
  let current: StepLog = {
    name: steps[first]?.name ?? "Log",
    state: steps[first]?.state ?? "success",
    sections: [],
  };
  let next = first + 1;
  for (const section of sections) {
    const match = steps.findIndex((step, i) => i >= next && step.name === section.title);
    const step = steps[match];
    if (!step) {
      current.sections.push(section);
      continue;
    }
    if (current.sections.length > 0) out.push(current);
    current = { name: step.name, state: step.state, sections: [section] };
    next = match + 1;
  }
  if (current.sections.length > 0) out.push(current);
  return out;
}
