import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { clsx } from "clsx";

import { Markdown } from "@/components/markdown";
import { DiffFiles } from "@/diff/adapter";
import { openOnGitHub, propose } from "@/features/actions";
import { useCommands } from "@/keys/registry";
import { ago } from "@/lib/format";
import { q } from "@/lib/rpc";
import { Avatar } from "@/ui/avatar";
import { Dot, type Tone } from "@/ui/dot";
import type { PrView } from "@pier/core/wire";

// One PR on one page: what it is, whether CI is happy, and the full diff in a single stream.
// Inline comments, threads and the review composer build on this.

const CHECK_TONE: Record<PrView["checks"]["contexts"][number]["state"], Tone> = {
  success: "ok",
  failure: "bad",
  pending: "warn",
  neutral: "faint",
  skipped: "faint",
};

export function PrCanvas({ repo, number }: { repo: string; number: number }) {
  const { data: pr, isPending } = useQuery(q("pr", { repo, number }));
  const navigate = useNavigate();
  const router = useRouter();

  useCommands([
    {
      id: "pr.back",
      title: "Back",
      keys: ["u"],
      scope: "surface",
      group: "Go to",
      run: () => (router.history.length > 1 ? router.history.back() : void navigate({ to: "/" })),
    },
    {
      id: "pr.github",
      title: "Open on github.com",
      keys: ["shift+o"],
      scope: "surface",
      group: "Go to",
      run: () => openOnGitHub(pr?.url ?? `https://github.com/${repo}/pull/${number}`),
    },
    ...(pr && pr.state === "OPEN" && !pr.approvedByYou
      ? [
          {
            id: "pr.approve",
            title: "Approve",
            keys: ["a"],
            scope: "surface" as const,
            hint: "approve",
            group: "Decide",
            run: () => void propose("approve", [pr.id], `${repo}#${number}`),
          },
        ]
      : []),
  ]);

  if (isPending) return <div className="px-8 pt-10 text-faint">Loading</div>;
  if (!pr) {
    return (
      <div className="px-8 pt-16">
        <p className="text-prose text-muted">
          pier isn't tracking {repo}#{number} yet.
        </p>
        <p className="mt-2 text-ui text-faint">Shift+O opens it on github.com.</p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-8 pt-8 pb-20">
        <header>
          <p className="font-code text-meta text-faint">
            {pr.repo}#{pr.number}
          </p>
          <h1 className="mt-1 text-title font-semibold text-strong">{pr.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-meta text-muted">
            {pr.author && (
              <span className="flex items-center gap-2">
                <Avatar login={pr.author.login} url={pr.author.avatarUrl} size={16} />
                {pr.author.login}
              </span>
            )}
            <span className="font-code text-faint">
              {pr.baseRefName} <span className="text-off">←</span> {pr.headRefName}
            </span>
            <span className="font-code">
              <span className="text-ok">+{pr.additions}</span>{" "}
              <span className="text-bad">−{pr.deletions}</span>
            </span>
            <span className="text-faint">Updated {ago(pr.updatedAt)} ago</span>
            {pr.state !== "OPEN" && (
              <span className="text-faint">{pr.state === "MERGED" ? "Merged" : "Closed"}</span>
            )}
            {pr.approvedByYou && <span className="text-ok">You approved this commit</span>}
          </div>
        </header>

        {pr.checks.contexts.length > 0 && (
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-1.5 text-meta">
            {pr.checks.contexts.map((check) => (
              <li
                key={check.name}
                className={clsx(
                  "flex items-center gap-2",
                  check.state === "failure" ? "text-bad" : "text-muted",
                )}
              >
                <Dot tone={CHECK_TONE[check.state]} />
                {check.name}
              </li>
            ))}
          </ul>
        )}

        {pr.body.trim() && (
          <section className="mt-8 border-t border-line pt-6">
            <Markdown source={pr.body} />
          </section>
        )}

        <section className="mt-10">
          <h2 className="mb-4 flex items-baseline gap-3">
            <span className="text-section font-semibold text-strong">Changes</span>
            <span className="text-ui text-faint">{pr.changedFiles} files</span>
          </h2>
          {pr.files ? (
            <DiffFiles files={pr.files} />
          ) : (
            <p className="text-meta text-faint">Loading the diff</p>
          )}
        </section>
      </div>
    </div>
  );
}
