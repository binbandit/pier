import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { clsx } from "clsx";

import { Ledger, type Tick } from "@/components/ledger";
import { Markdown } from "@/components/markdown";
import { Row } from "@/components/rows";
import { DiffFiles } from "@/diff/adapter";
import { openOnGitHub, propose } from "@/features/actions";
import { useCommands } from "@/keys/registry";
import { ago, plural } from "@/lib/format";
import { q } from "@/lib/rpc";
import { useList } from "@/lib/use-list";
import { Avatar } from "@/ui/avatar";
import { Dot, type Tone } from "@/ui/dot";
import type { Cohort, GateResult, GroupRow, GroupView } from "@pier/core/wire";

// One dependency bump across every repo it landed in. The left column is the decision (is this
// safe, and for which repos); the right column is the evidence (release notes, the diff).

const COHORT_TITLE: Record<Cohort, string> = { clear: "Clear", look: "Look", stuck: "Stuck" };
const COHORT_HELP: Record<Cohort, string> = {
  clear: "Passed every gate. One key approves them all.",
  look: "Something needs your eyes before approving.",
  stuck: "Needs a fix before approving makes sense.",
};
const GATE_TONE: Record<GateResult["status"], Tone> = {
  pass: "ok",
  fail: "bad",
  unknown: "warn",
  na: "faint",
};
const GATE_LABEL: Record<GateResult["gate"], string> = {
  semver: "Version change",
  "release-age": "Release age",
  paths: "Files touched",
  transitive: "New transitive deps",
  provenance: "Commit provenance",
  "install-script": "Install scripts",
  advisory: "Known advisories",
  checks: "Checks",
};

export function GroupCanvas({ groupKey }: { groupKey: string }) {
  const { data: view, isPending } = useQuery(q("group", { key: groupKey }));
  if (isPending) return <div className="px-8 pt-10 text-faint">Loading</div>;
  if (!view) return <GroupGone />;
  return <Loaded view={view} />;
}

function GroupGone() {
  const navigate = useNavigate();
  useCommands([
    {
      id: "group.back",
      title: "Back to Deps",
      keys: ["u", "escape"],
      scope: "surface",
      run: () => void navigate({ to: "/inbox/$split", params: { split: "deps" } }),
    },
  ]);
  return (
    <div className="px-8 pt-16">
      <p className="text-prose text-muted">Every PR in this group has merged or closed.</p>
    </div>
  );
}

function Loaded({ view }: { view: GroupView }) {
  const navigate = useNavigate();
  const rows = view.rows;
  const actionable = rows.filter((r) => !r.approvedByYou && !r.pending);
  const clear = actionable.filter((r) => r.cohort === "clear");

  const list = useList<GroupRow>({
    id: `group-${view.key}`,
    items: rows,
    keyOf: (r) => r.prId,
    rowHeight: 36,
    onOpen: (row) => openOnGitHub(row.url),
    scrollTo: (index, container) =>
      container.querySelector(`[data-row="${index}"]`)?.scrollIntoView({ block: "nearest" }),
    commands: (current, selected) => {
      const chosen = selected.length > 0 ? selected : null;
      return [
        {
          id: "group.approve",
          title: chosen ? "Approve selected" : "Approve the clear cohort",
          keys: ["a"],
          scope: "surface",
          hint: chosen ? `approve ${chosen.length}` : `approve ${clear.length} clear`,
          group: "Decide",
          run: () => {
            const ids = (chosen ?? clear)
              .filter((r) => !r.approvedByYou && !r.pending)
              .map((r) => r.prId);
            void propose(
              "approve",
              ids,
              `${view.pkg} ${view.to}${chosen ? "" : ", clear cohort"}`,
              view.key,
            );
          },
        },
        {
          id: "group.approve-row",
          title: "Approve this PR",
          keys: ["shift+a"],
          scope: "surface",
          group: "Decide",
          run: () =>
            current &&
            void propose("approve", [current.prId], `${current.repo}#${current.number}`, view.key),
        },
        {
          id: "group.rebase",
          title: "Ask Dependabot to rebase",
          keys: ["b r"],
          scope: "surface",
          group: "Bot",
          run: () => {
            const targets = chosen ?? (current ? [current] : []);
            void propose(
              "rebase",
              targets.map((r) => r.prId),
              `${view.pkg} ${view.to}`,
            );
          },
        },
        {
          id: "group.recreate",
          title: "Ask Dependabot to recreate",
          keys: ["b c"],
          scope: "surface",
          group: "Bot",
          run: () => {
            const targets = chosen ?? (current ? [current] : []);
            void propose(
              "recreate",
              targets.map((r) => r.prId),
              `${view.pkg} ${view.to}`,
            );
          },
        },
        {
          id: "group.github",
          title: "Open on github.com",
          keys: ["shift+o"],
          scope: "surface",
          group: "Go to",
          run: () => current && openOnGitHub(current.url),
        },
        {
          id: "group.back",
          title: "Back to Deps",
          keys: ["u"],
          scope: "surface",
          group: "Go to",
          run: () => void navigate({ to: "/inbox/$split", params: { split: "deps" } }),
        },
      ];
    },
  });

  const { scrollRef } = list;
  const ticks: Tick[] = rows.map((r) => ({
    id: r.prId,
    cohort: r.cohort,
    state: r.approvedByYou ? "done" : r.pending ? "sending" : "open",
  }));
  const byCohort = Map.groupBy(rows, (r) => r.cohort);
  const gateDetails = new Set(view.gates.map((g) => g.detail.replace(/ \(\+\d+ more\)$/, "")));
  const release = view.release;

  return (
    <div className="flex min-h-0 flex-1">
      <section
        ref={scrollRef}
        className="min-h-0 w-[min(760px,52%)] shrink-0 overflow-y-auto border-r border-line px-8 pt-8 pb-16"
      >
        <header>
          <h1 className="font-code text-title font-semibold text-strong">{view.pkg}</h1>
          <p className="mt-1 font-code text-ui text-muted">
            {view.fromVersions.map((f) => f.version).join(", ")}{" "}
            <span className="text-faint">→</span> <span className="text-strong">{view.to}</span>
          </p>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-meta">
            <dt className="text-faint">Ecosystem</dt>
            <dd className="text-muted">{view.ecosystem}</dd>
            <dt className="text-faint">Change</dt>
            <dd className={view.semver === "major" ? "text-warn" : "text-muted"}>{view.semver}</dd>
            <dt className="text-faint">Published</dt>
            <dd className="text-muted">
              {release?.publishedAt
                ? `${ago(release.publishedAt)} ago, ${new Date(release.publishedAt).toLocaleDateString()}`
                : "Unknown"}
            </dd>
            {release?.links.slice(0, 2).map((link) => (
              <LinkRow key={link.url} label={link.label} url={link.url} />
            ))}
          </dl>
        </header>

        <div className="mt-8">
          <Ledger ticks={ticks} size="lg" label={`${rows.length} PRs`} />
          <p className="mt-2 text-meta text-faint">
            {plural(rows.length, "PR")} in {plural(new Set(rows.map((r) => r.repo)).size, "repo")}
            {rows.some((r) => r.approvedByYou) &&
              `, ${rows.filter((r) => r.approvedByYou).length} approved`}
          </p>
        </div>

        <ul className="mt-8 space-y-1.5">
          {view.gates.map((gate) => (
            <li
              key={gate.gate}
              className="grid grid-cols-[16px_170px_1fr] items-baseline gap-x-3 text-meta"
            >
              <Dot tone={GATE_TONE[gate.status]} label={gate.status} />
              <span className="text-muted">{GATE_LABEL[gate.gate]}</span>
              <span
                className={clsx(
                  gate.status === "fail"
                    ? "text-bad"
                    : gate.status === "unknown"
                      ? "text-warn"
                      : "text-faint",
                )}
              >
                {gate.detail}
              </span>
            </li>
          ))}
        </ul>

        {(["clear", "look", "stuck"] as const).map((cohort) => {
          const members = byCohort.get(cohort) ?? [];
          if (members.length === 0) return null;
          // Reasons already spelled out in the gate list, or shared by every row here, aren't repeated
          // on each row; rows show only what's specific to them.
          const shared = new Set(
            members
              .flatMap((m) => m.reasons)
              .filter(
                (r) =>
                  gateDetails.has(r) ||
                  (members.length > 1 && members.every((m) => m.reasons.includes(r))),
              ),
          );
          return (
            <section key={cohort} className="mt-10">
              <h2 className="flex items-baseline gap-3">
                <span className="text-section font-semibold text-strong">
                  {COHORT_TITLE[cohort]}
                </span>
                <span className="text-ui text-faint">{members.length}</span>
              </h2>
              <p className="mb-2 text-meta text-faint">{COHORT_HELP[cohort]}</p>
              <ul>
                {members.map((row) => {
                  const index = rows.indexOf(row);
                  const own = row.reasons.filter((r) => !shared.has(r));
                  return (
                    <li key={row.prId} data-row={index} className="-mx-3">
                      <Row
                        active={index === list.index}
                        selected={list.selectedKeys.includes(row.prId)}
                        onSelect={() => list.move(index)}
                        onOpen={() => openOnGitHub(row.url)}
                        className="grid h-9 grid-cols-[minmax(0,1fr)_80px_130px_24px] gap-x-4 rounded-sm px-3"
                      >
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span
                            className={clsx(
                              "shrink-0 font-code text-meta",
                              row.approvedByYou ? "text-faint" : "text-fg",
                            )}
                          >
                            {row.repo}
                            <span className="text-faint">#{row.number}</span>
                          </span>
                          {row.directory !== "/" && (
                            <span className="font-code text-meta text-faint">{row.directory}</span>
                          )}
                          {row.differs && <span className="text-meta text-warn">differs</span>}
                          {own.length > 0 && (
                            <span className="truncate text-meta text-muted">{own.join("; ")}</span>
                          )}
                        </span>
                        <span className="font-code text-meta text-faint">{row.from ?? ""}</span>
                        <RowState row={row} />
                        <Avatar login={row.account} size={16} />
                      </Row>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </section>

      <section className="min-h-0 min-w-0 flex-1 overflow-y-auto px-8 pt-8 pb-16">
        {view.representative && (
          <>
            <h2 className="mb-3 flex items-baseline gap-3">
              <span className="text-ui font-medium text-strong">Changes</span>
              <span className="font-code text-meta text-faint">
                {view.representative.repo}#{view.representative.number}
              </span>
            </h2>
            {view.representative.files.length > 0 ? (
              <DiffFiles files={view.representative.files} />
            ) : (
              <p className="text-meta text-faint">Loading the diff</p>
            )}
          </>
        )}
        {view.notes && (
          <>
            <h2 className="mt-10 mb-3 text-ui font-medium text-strong">About this release</h2>
            <Markdown source={botNotes(view.notes)} />
          </>
        )}
      </section>
    </div>
  );
}

/**
 * Bot PR bodies end in boilerplate (compatibility badges, the list of bot commands, Renovate's
 * config block). Keep what's worth reading, and open the release notes since that's why you're here.
 */
function botNotes(body: string): string {
  const cuts = [
    body.indexOf("[![Dependabot compatibility score]"),
    body.search(/\n---\n+\s*### Configuration/),
    body.search(/\n---\n+\s*- \[ \] <!-- rebase-check -->/),
  ].filter((i) => i > 0);
  const trimmed = cuts.length > 0 ? body.slice(0, Math.min(...cuts)) : body;
  return trimmed.replace("<details>", "<details open>");
}

function RowState({ row }: { row: GroupRow }) {
  if (row.approvedByYou) return <span className="text-meta text-faint">Approved</span>;
  if (row.pending) {
    const text = {
      waiting: "Waits for the PR before it",
      held: "Sending in a moment",
      queued: "Queued",
      claimed: "Sending",
      unknown: "Checking",
      acked: "Sent",
      failed: "Failed",
      cancelled: "Cancelled",
    }[row.pending.state];
    return <span className="text-meta text-auto">{text}</span>;
  }
  const checks = row.checks;
  const tone: Tone =
    checks.state === "success"
      ? "ok"
      : checks.state === "failure"
        ? "bad"
        : checks.state === "pending"
          ? "warn"
          : "faint";
  const text =
    checks.state === "none"
      ? "No checks"
      : checks.state === "pending"
        ? `${checks.pending} running`
        : checks.state === "failure"
          ? `${checks.failing} failing`
          : `${checks.total} passing`;
  return (
    <span className="flex items-center gap-2 text-meta text-muted">
      <Dot tone={tone} />
      {text}
    </span>
  );
}

function LinkRow({ label, url }: { label: string; url: string }) {
  return (
    <>
      <dt className="text-faint">
        {label === "SOURCE_REPO" ? "Source" : label === "HOMEPAGE" ? "Homepage" : label}
      </dt>
      <dd>
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-info underline decoration-info/40 underline-offset-2 hover:decoration-info"
        >
          {url.replace(/^https?:\/\//, "")}
        </a>
      </dd>
    </>
  );
}
