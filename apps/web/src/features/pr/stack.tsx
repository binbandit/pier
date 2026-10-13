import { Link } from "@tanstack/react-router";
import { clsx } from "clsx";
import { Layers } from "lucide-react";

import { Keys } from "@/ui/kbd";
import type { PrStack, PrView } from "@pier/core/wire";

// A stack of PRs, each built on the one below: where this one sits, and the way up and down.

export function StackStrip({ pr, stack }: { pr: PrView; stack: PrStack }) {
  const [owner = "", repo = ""] = pr.repo.split("/");
  const here = stack.prs.find((member) => member.number === pr.number);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
      <Layers aria-hidden size={14} className="text-off" />
      <span className="text-faint">
        {here ? `${here.position} of ${stack.prs.length} on ${stack.base}` : `On ${stack.base}`}
      </span>
      <ol aria-label="Stack" className="flex flex-wrap items-center gap-x-2">
        {stack.prs.map((member, i) => (
          <li key={member.number} className="flex items-center gap-2">
            {i > 0 && (
              <span aria-hidden className="text-off">
                →
              </span>
            )}
            <Link
              to="/$owner/$repo/pull/$number"
              params={{ owner, repo, number: member.number }}
              aria-current={member.number === pr.number || undefined}
              title={member.title ?? undefined}
              className={clsx(
                "max-w-[220px] truncate",
                member.number === pr.number
                  ? "text-strong"
                  : member.merged || member.state === "closed"
                    ? "text-off hover:text-fg"
                    : "text-muted hover:text-fg",
              )}
            >
              #{member.number}
              {member.merged ? " ✓" : ""} {member.number === pr.number ? "" : (member.title ?? "")}
            </Link>
          </li>
        ))}
      </ol>
      <span className="ml-2 flex items-center gap-1.5 text-faint">
        <Keys sequence="g j" /> down
      </span>
      <span className="flex items-center gap-1.5 text-faint">
        <Keys sequence="g k" /> up
      </span>
    </div>
  );
}

/** The PRs below this one a merge would take with it: GitHub merges a stack from the bottom. */
export function mergedAlong(pr: PrView): PrStack["prs"] {
  const stack = pr.stack;
  const here = stack?.prs.find((member) => member.number === pr.number);
  if (!stack || !here) return [];
  return stack.prs.filter(
    (member) => member.position < here.position && member.state === "open" && !member.merged,
  );
}
