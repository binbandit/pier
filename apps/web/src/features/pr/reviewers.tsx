import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ShieldCheck, Users } from "lucide-react";
import { useId, useState } from "react";

import { formatNumber } from "@/lib/format";
import { q } from "@/lib/rpc";
import { Avatar } from "@/ui/avatar";
import { Dot, type Tone } from "@/ui/dot";
import type { PrView } from "@pier/core/wire";

type Reviewer = PrView["reviewers"][number];

const STATES: Record<string, { label: string; tone: Tone; rank: number }> = {
  CHANGES_REQUESTED: { label: "Changes requested", tone: "bad", rank: 0 },
  requested: { label: "Requested", tone: "warn", rank: 1 },
  APPROVED: { label: "Approved", tone: "ok", rank: 2 },
  COMMENTED: { label: "Commented", tone: "faint", rank: 3 },
  DISMISSED: { label: "Dismissed", tone: "faint", rank: 4 },
};

export function Reviewers({ pr }: { pr: PrView }) {
  const { data: people = [] } = useQuery(q("assignable", { repo: pr.repo }));
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const many = pr.reviewers.length > 3;
  const approved = pr.reviewers.filter((reviewer) => reviewer.state === "APPROVED");
  const requested = pr.reviewers.filter((reviewer) => reviewer.state === "requested").length;
  const changes = pr.reviewers.filter((reviewer) => reviewer.state === "CHANGES_REQUESTED").length;
  const avatars = new Map([
    ...people.map((person) => [person.login, person.avatarUrl] as const),
    ...pr.timeline.flatMap((entry) =>
      "author" in entry && typeof entry.author === "object" && entry.author
        ? [[entry.author.login, entry.author.avatarUrl] as const]
        : [],
    ),
  ]);
  const ordered = pr.reviewers.toSorted(
    (a, b) =>
      (STATES[a.state]?.rank ?? 5) - (STATES[b.state]?.rank ?? 5) ||
      Number(b.codeOwner) - Number(a.codeOwner) ||
      a.login.localeCompare(b.login),
  );

  return (
    <div aria-label="Reviewers" className={many ? "min-w-0 basis-full" : "max-w-full min-w-0"}>
      {many ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              aria-label={expanded ? "Hide reviewers" : `Show all ${pr.reviewers.length} reviewers`}
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-2 rounded-sm py-1 text-muted hover:text-strong"
            >
              <Users aria-hidden size={14} className="text-off" />
              Reviewers{" "}
              <span className="shrink-0 whitespace-nowrap text-faint">
                {formatNumber(pr.reviewers.length)}
              </span>
              <ChevronDown aria-hidden size={14} className={expanded ? undefined : "-rotate-90"} />
            </button>
            {changes > 0 && (
              <span className="shrink-0 whitespace-nowrap text-bad">
                {formatNumber(changes)} changes requested
              </span>
            )}
            {requested > 0 && (
              <span className="shrink-0 whitespace-nowrap text-faint">
                {formatNumber(requested)} requested
              </span>
            )}
            {approved.length > 0 && (
              <div aria-label="Approved reviewers" className="flex items-center gap-2">
                <span className="shrink-0 whitespace-nowrap text-ok">
                  {formatNumber(approved.length)} approved
                </span>
                <span className="flex items-center -space-x-1">
                  {approved.slice(0, 5).map((reviewer) => (
                    <Avatar
                      key={reviewer.login}
                      login={reviewer.login}
                      url={avatars.get(reviewer.login) ?? null}
                      size={22}
                      className="ring-2 ring-canvas"
                    />
                  ))}
                </span>
                {approved.length > 5 && (
                  <span className="shrink-0 whitespace-nowrap text-faint">
                    +{formatNumber(approved.length - 5)}
                  </span>
                )}
              </div>
            )}
          </div>
          {expanded && (
            <ul
              id={listId}
              className="mt-2 grid max-h-72 max-w-[900px] grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-x-6 gap-y-3 overflow-y-auto rounded-md border border-line p-3"
            >
              {ordered.map((reviewer) => (
                <li
                  key={`${reviewer.kind}:${reviewer.login}`}
                  className="flex min-w-0 items-start gap-2"
                >
                  {reviewer.kind === "team" ? (
                    <Users aria-hidden size={20} className="mt-0.5 shrink-0 text-off" />
                  ) : (
                    <Avatar
                      login={reviewer.login}
                      url={avatars.get(reviewer.login) ?? null}
                      size={22}
                    />
                  )}
                  <div className="min-w-0">
                    <span className="block wrap-anywhere text-muted">{reviewer.login}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-faint">
                      <ReviewerState reviewer={reviewer} />
                      {reviewer.codeOwner && (
                        <span className="flex items-center gap-1">
                          <ShieldCheck aria-hidden size={12} /> Code owner
                        </span>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {ordered.map((reviewer) => (
            <li
              key={`${reviewer.kind}:${reviewer.login}`}
              className="flex min-w-0 items-center gap-1.5"
              title={`${STATES[reviewer.state]?.label ?? reviewer.state}${reviewer.codeOwner ? ", code owner" : ""}`}
            >
              {reviewer.kind === "team" ? (
                <Users aria-hidden size={16} className="shrink-0 text-off" />
              ) : (
                <Avatar
                  login={reviewer.login}
                  url={avatars.get(reviewer.login) ?? null}
                  size={18}
                />
              )}
              <span className="wrap-anywhere">{reviewer.login}</span>
              <Dot
                tone={STATES[reviewer.state]?.tone ?? "faint"}
                label={STATES[reviewer.state]?.label ?? reviewer.state}
              />
              {reviewer.codeOwner && (
                <ShieldCheck aria-label="Code owner" size={12} className="shrink-0 text-off" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewerState({ reviewer }: { reviewer: Reviewer }) {
  const state = STATES[reviewer.state];
  return (
    <span className="flex items-center gap-1.5">
      <Dot tone={state?.tone ?? "faint"} />
      {state?.label ?? reviewer.state.toLowerCase().replaceAll("_", " ")}
    </span>
  );
}
