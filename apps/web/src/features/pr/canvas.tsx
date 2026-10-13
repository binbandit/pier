import type { SelectedLineRange } from "@pierre/diffs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { clsx } from "clsx";
import { CircleDot, Lock, Milestone, UserRound, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { errorText, markDone, openOnGitHub } from "@/features/actions";
import { type Command, useCommands } from "@/keys/registry";
import { plural, since } from "@/lib/format";
import { q, qLive, rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import { Avatar } from "@/ui/avatar";
import { Dot, type Tone } from "@/ui/dot";
import { Keys } from "@/ui/kbd";
import type { DiffRange, PrView, QueueItem } from "@pier/core/wire";

import { ActivityRail } from "./activity";
import { Checks } from "./checks";
import { FileTree } from "./file-tree";
import { type MetadataKind, MetadataPicker } from "./metadata";
import { RevertPanel } from "./revert";
import { type NewComment, ReviewFile, fromRange } from "./review-file";
import { type ReviewEvent, ReviewPanel } from "./review-panel";
import { RunwayPanel } from "./runway";
import { TitlePanel } from "./title";
import { Writing } from "./writing";

// One PR on one page. The stream reads top to bottom: what this is, whose turn it is, then the
// files (source first) with conversation inline. Re-reviews open on what changed since you last
// looked. Deciding moves you to the next PR waiting on you.

const WIDE = 1600;

/** What's raised from the status line; one at a time. */
type Raised =
  | { kind: "review"; event: ReviewEvent }
  | { kind: "runway" }
  | { kind: "picker"; field: MetadataKind }
  | { kind: "title" }
  | { kind: "revert" };

const PICKERS: { field: MetadataKind; key: string; title: string }[] = [
  { field: "labels", key: "l", title: "Edit labels" },
  { field: "assignees", key: "a", title: "Edit assignees" },
  { field: "reviewers", key: "r", title: "Edit reviewers" },
  { field: "milestone", key: "m", title: "Set milestone" },
  { field: "base", key: "b", title: "Change base branch" },
  { field: "lock", key: "k", title: "Lock or unlock the conversation" },
];

export function PrCanvas({ repo, number }: { repo: string; number: number }) {
  const { data: pr, isPending } = useQuery(q("pr", { repo, number }));
  if (isPending) return <div className="px-8 pt-10 text-faint">Loading</div>;
  if (!pr) return <Untracked repo={repo} number={number} />;
  return <Loaded key={pr.id} pr={pr} />;
}

function Untracked({ repo, number }: { repo: string; number: number }) {
  useCommands([
    {
      id: "pr.github",
      title: "Open on github.com",
      keys: ["shift+o"],
      scope: "surface",
      group: "Go to",
      run: () => openOnGitHub(`https://github.com/${repo}/pull/${number}`),
    },
  ]);
  return (
    <div className="px-8 pt-16">
      <p className="text-prose text-muted">
        None of your accounts can see {repo}#{number}. It may not exist, or it's in a repo they
        aren't part of.
      </p>
      <p className="mt-2 flex items-center gap-2 text-ui text-faint">
        <Keys sequence="shift+o" /> opens it on github.com
      </p>
    </div>
  );
}

function Loaded({ pr }: { pr: PrView }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const toast = useUi((s) => s.toast);
  const streamRef = useRef<HTMLDivElement>(null);

  const reReview = pr.lastReviewedOid !== null && pr.lastReviewedOid !== pr.headRefOid;
  const [range, setRange] = useState<DiffRange>(reReview ? "since-review" : "all");
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [rail, setRail] = useState(() => window.innerWidth >= WIDE);
  const [raised, setRaised] = useState<Raised | null>(null);
  const lower = () => setRaised(null);

  // The `s` pickers' lists, fetched once per repo per session so typing into a picker never
  // races its list. ETags make the repeat reads free.
  useEffect(() => {
    for (const name of ["repoLabels", "assignable", "milestones"] as const) {
      void client.prefetchQuery(q(name, { repo: pr.repo }));
    }
  }, [client, pr.repo]);
  const [current, setCurrent] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ path: string; range: SelectedLineRange } | null>(
    null,
  );
  const [composing, setComposing] = useState<NewComment | null>(null);
  const [focusedThread, setFocusedThread] = useState<string | null>(null);

  const { data: diff } = useQuery({
    ...q("prDiff", { repo: pr.repo, number: pr.number, range, ignoreWhitespace }),
    enabled: range !== "all" || ignoreWhitespace,
  });
  const files = range === "all" && !ignoreWhitespace ? (pr.files ?? []) : (diff?.files ?? []);
  const ordered = reviewOrder(files);
  const { data: queue = [] } = useQuery(q("inbox", { split: "review" }));

  const threadsByPath = Map.groupBy(pr.threads, (t) => t.path);
  const draftsByPath = Map.groupBy(pr.drafts, (d) => d.path);
  const pendingByPath = Map.groupBy(pr.pendingReview?.comments ?? [], (c) => c.path);
  // What CI pointed at in the code, asked again whenever the head or its checks move.
  const { data: annotations = [] } = useQuery(
    qLive("annotations", { repo: pr.repo, number: pr.number }, pr.headRefOid, pr.checks.state),
  );
  const annotationsByPath = Map.groupBy(annotations, (a) => a.path);
  const threadCounts = new Map([...threadsByPath].map(([path, list]) => [path, list.length]));
  const openThreads = pr.threads.filter((t) => !t.resolved);
  const currentIndex = Math.max(
    0,
    ordered.findIndex((f) => f.path === current),
  );

  // The file header nearest the top of the stream is the current file.
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      const top = el.getBoundingClientRect().top + 48;
      let found: string | null = null;
      for (const section of el.querySelectorAll<HTMLElement>("[data-file]")) {
        if (section.getBoundingClientRect().top <= top) found = section.dataset.file ?? null;
      }
      setCurrent(found);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const jump = (path: string) => {
    setCurrent(path);
    streamRef.current
      ?.querySelector(`[data-file="${CSS.escape(path)}"]`)
      ?.scrollIntoView({ block: "start" });
  };
  const jumpThread = (direction: 1 | -1) => {
    if (openThreads.length === 0) return;
    const at = openThreads.findIndex((t) => t.id === focusedThread);
    const next = openThreads[(at + direction + openThreads.length) % openThreads.length];
    if (!next) return;
    setFocusedThread(next.id);
    streamRef.current
      ?.querySelector(`[data-thread="${CSS.escape(next.id)}"]`)
      ?.scrollIntoView({ block: "center" });
  };

  /** After a decision, the next PR waiting on you (or back to the inbox when there isn't one). */
  const advance = () => {
    const next = queue.find(
      (item): item is Extract<QueueItem, { kind: "pr" }> => item.kind === "pr" && item.id !== pr.id,
    );
    if (!next) {
      void navigate({ to: "/inbox/$split", params: { split: "review" } });
      return;
    }
    const [owner = "", name = ""] = next.repo.split("/");
    void navigate({
      to: "/$owner/$repo/pull/$number",
      params: { owner, repo: name, number: next.number },
    });
  };

  const branch = async (action: "delete" | "restore") => {
    try {
      await rpc("branch", { prId: pr.id, action });
      void client.invalidateQueries();
      toast(
        {
          text: action === "delete" ? `Deleted ${pr.headRefName}` : `Restored ${pr.headRefName}`,
          tone: "ok",
          ...(action === "delete"
            ? { undo: () => void rpc("branch", { prId: pr.id, action: "restore" }) }
            : {}),
        },
        6_000,
      );
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };

  const setDraft = async (draft: boolean) => {
    try {
      await rpc("setDraft", { prId: pr.id, draft });
      void client.invalidateQueries();
      toast(
        {
          text: draft ? "Converted to draft" : "Marked ready for review",
          tone: "ok",
          undo: () => void rpc("setDraft", { prId: pr.id, draft: !draft }),
        },
        6_000,
      );
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };

  // Closing notifies everyone on the PR, so it waits five seconds for `z`; reopening goes at once.
  const setOpen = async (open: boolean) => {
    try {
      const { commandIds } = await rpc("setOpen", { prId: pr.id, open });
      void client.invalidateQueries();
      toast(
        open
          ? { text: "Reopened", tone: "ok" }
          : {
              text: `Closing ${pr.repo.split("/")[1]}#${pr.number} in 5s`,
              tone: "ok",
              undo: () => void rpc("cancelCommands", { commandIds }),
            },
        5_000,
      );
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };

  const quickApprove = async () => {
    if (pr.drafts.length > 0) {
      setRaised({ kind: "review", event: "APPROVE" });
      return;
    }
    try {
      const { commandIds } = await rpc("submitReview", { prId: pr.id, event: "APPROVE", body: "" });
      void client.invalidateQueries();
      toast(
        {
          text: `Approving ${pr.repo.split("/")[1]}#${pr.number} in 5s`,
          tone: "ok",
          undo: () => void rpc("cancelCommands", { commandIds }),
        },
        5_000,
      );
      advance();
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };

  const toggleViewedAndNext = async () => {
    const file = ordered[currentIndex];
    if (!file) return;
    const isViewed = pr.viewed[file.path] === "viewed";
    await rpc("setViewed", { prId: pr.id, path: file.path, viewed: !isViewed });
    void client.invalidateQueries({ queryKey: ["pr"] });
    if (!isViewed) {
      const next = ordered.slice(currentIndex + 1).find((f) => pr.viewed[f.path] !== "viewed");
      if (next) jump(next.path);
    }
  };

  const commands: Command[] = [
    {
      id: "pr.next-file",
      title: "Next file",
      keys: ["]"],
      scope: "surface",
      group: "Move",
      run: () => ordered[currentIndex + 1] && jump(ordered[currentIndex + 1]!.path),
    },
    {
      id: "pr.prev-file",
      title: "Previous file",
      keys: ["["],
      scope: "surface",
      group: "Move",
      run: () => ordered[currentIndex - 1] && jump(ordered[currentIndex - 1]!.path),
    },
    {
      id: "pr.next-thread",
      title: "Next open thread",
      keys: ["n"],
      scope: "surface",
      group: "Move",
      run: () => jumpThread(1),
    },
    {
      id: "pr.prev-thread",
      title: "Previous open thread",
      keys: ["shift+n"],
      scope: "surface",
      group: "Move",
      run: () => jumpThread(-1),
    },
    {
      id: "pr.comment",
      title: "Comment on the selected lines, or on the current file",
      keys: ["c"],
      scope: "surface",
      hint: selection ? "comment" : undefined,
      group: "Review",
      run: () => {
        const file = ordered[currentIndex];
        if (selection) setComposing(fromRange(selection.path, selection.range));
        else if (file) setComposing({ kind: "file", path: file.path });
      },
    },
    {
      id: "pr.viewed",
      title: "Mark file viewed and go to the next",
      keys: ["v"],
      scope: "surface",
      hint: "viewed",
      group: "Review",
      run: () => void toggleViewedAndNext(),
    },
    {
      id: "pr.review",
      title: "Write a review",
      keys: ["r"],
      scope: "surface",
      hint: "review",
      group: "Review",
      run: () => setRaised({ kind: "review", event: "COMMENT" }),
    },
    {
      id: "pr.approve",
      title: "Approve",
      keys: ["a"],
      scope: "surface",
      hint: "approve",
      group: "Review",
      run: () => void quickApprove(),
    },
    {
      id: "pr.request-changes",
      title: "Request changes",
      keys: ["shift+r"],
      scope: "surface",
      group: "Review",
      run: () => setRaised({ kind: "review", event: "REQUEST_CHANGES" }),
    },
    {
      id: "pr.range",
      title: range === "all" ? "Show changes since your review" : "Show all changes",
      keys: ["p"],
      scope: "surface",
      group: "Display",
      run: () => setRange(range === "all" ? "since-review" : "all"),
    },
    {
      id: "pr.whitespace",
      title: ignoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes",
      keys: ["d w"],
      scope: "surface",
      group: "Display",
      run: () => setIgnoreWhitespace(!ignoreWhitespace),
    },
    {
      id: "pr.rail",
      title: rail ? "Hide activity" : "Show activity",
      keys: ["i"],
      scope: "surface",
      group: "Display",
      run: () => setRail(!rail),
    },
    {
      id: "pr.done",
      title: "Done, next PR",
      keys: ["e"],
      scope: "surface",
      group: "Review",
      run: () => {
        void markDone(client, [`pr:${pr.id}`], `Done: ${pr.repo.split("/")[1]}#${pr.number}`);
        advance();
      },
    },
    {
      id: "pr.merge",
      title: "Merge",
      keys: ["m"],
      scope: "surface",
      hint: pr.author?.login === pr.account ? "merge" : undefined,
      group: "Merge",
      run: () => setRaised({ kind: "runway" }),
    },
    ...PICKERS.map(({ field, key, title }): Command => ({
      id: `pr.pick-${field}`,
      title,
      keys: [`s ${key}`],
      scope: "surface",
      group: "Edit",
      run: () => setRaised({ kind: "picker", field }),
    })),
    {
      id: "pr.edit-title",
      title: "Edit title",
      keys: ["s e"],
      scope: "surface",
      group: "Edit",
      run: () => setRaised({ kind: "title" }),
    },
    ...(pr.state === "MERGED"
      ? [
          {
            id: "pr.revert",
            title: "Revert",
            keys: ["s v"],
            scope: "surface" as const,
            group: "Edit",
            run: () => setRaised({ kind: "revert" }),
          },
        ]
      : []),
    ...(pr.headBranch.canDelete || pr.headBranch.canRestore
      ? [
          {
            id: "pr.branch",
            title: pr.headBranch.exists ? "Delete the head branch" : "Restore the head branch",
            keys: ["s x"],
            scope: "surface" as const,
            group: "Edit",
            run: () => void branch(pr.headBranch.exists ? "delete" : "restore"),
          },
        ]
      : []),
    {
      id: "pr.draft",
      title: pr.isDraft ? "Mark ready for review" : "Convert to draft",
      keys: ["s d"],
      scope: "surface",
      group: "Edit",
      run: () => void setDraft(!pr.isDraft),
    },
    {
      id: "pr.close",
      title: pr.state === "OPEN" ? "Close" : "Reopen",
      keys: ["s c"],
      scope: "surface",
      group: "Edit",
      run: () => void setOpen(pr.state !== "OPEN"),
    },
    {
      id: "pr.github",
      title: "Open on github.com",
      keys: ["shift+o"],
      scope: "surface",
      group: "Go to",
      run: () => openOnGitHub(pr.url),
    },
    {
      id: "pr.back",
      title: "Back",
      keys: ["u"],
      scope: "surface",
      group: "Go to",
      run: () => (router.history.length > 1 ? router.history.back() : void navigate({ to: "/" })),
    },
  ];
  useCommands(commands);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        {ordered.length > 10 && (
          <FileTree
            files={ordered}
            viewed={pr.viewed}
            threadCounts={threadCounts}
            current={ordered[currentIndex]?.path ?? null}
            onJump={jump}
          />
        )}
        <div ref={streamRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="px-8 pt-8 pb-24">
            <Header pr={pr} />
            <Checks pr={pr} />
            <TurnLine pr={pr} range={range} fallback={diff?.fallback ?? null} />
            <section className="mt-6 border-t border-line pt-6">
              <Writing
                prId={pr.id}
                id={pr.id}
                writing={{
                  subject: "pull-request",
                  body: pr.body,
                  edited: false,
                  canEdit: pr.canEdit,
                  canDelete: false,
                  canMinimize: false,
                  minimized: null,
                  reactions: pr.reactions,
                  unsent: false,
                }}
                html={pr.bodyHTML}
                quoteInto={rail ? "conversation" : null}
                bodyClassName="prose-pier"
              />
              {!pr.body.trim() && <p className="text-meta text-faint">No description.</p>}
            </section>

            <section className="mt-10">
              <h2 className="mb-3 flex items-baseline gap-3">
                <span className="text-section font-semibold text-strong">
                  {range === "since-review" ? "Since your review" : "Changes"}
                </span>
                <span className="text-ui text-faint">{plural(ordered.length, "file")}</span>
                {ignoreWhitespace && (
                  <span className="text-meta text-faint">whitespace hidden</span>
                )}
              </h2>
              {range === "since-review" && diff && ordered.length === 0 && (
                <p className="text-ui text-muted">
                  Nothing has changed since you reviewed {pr.lastReviewedOid?.slice(0, 7)}.
                </p>
              )}
              <div className="space-y-8">
                {ordered.map((file) => (
                  <ReviewFile
                    key={`${range}:${ignoreWhitespace}:${file.path}`}
                    prId={pr.id}
                    headOid={pr.headRefOid}
                    file={file}
                    threads={threadsByPath.get(file.path) ?? []}
                    drafts={draftsByPath.get(file.path) ?? []}
                    pending={pendingByPath.get(file.path) ?? []}
                    annotations={annotationsByPath.get(file.path) ?? []}
                    viewed={pr.viewed[file.path] ?? "unviewed"}
                    current={file.path === ordered[currentIndex]?.path && current !== null}
                    focusedThread={focusedThread}
                    composing={composing}
                    selection={selection?.path === file.path ? selection.range : null}
                    onSelect={(path, r) => setSelection(r ? { path, range: r } : null)}
                    onCompose={setComposing}
                  />
                ))}
              </div>
            </section>
          </div>
        </div>
        {rail && <ActivityRail pr={pr} />}
      </div>
      {raised?.kind === "review" && (
        <ReviewPanel pr={pr} initial={raised.event} onClose={lower} onSent={advance} />
      )}
      {raised?.kind === "runway" && <RunwayPanel pr={pr} onClose={lower} onMerged={advance} />}
      {raised?.kind === "picker" && (
        <MetadataPicker key={raised.field} pr={pr} kind={raised.field} onClose={lower} />
      )}
      {raised?.kind === "title" && <TitlePanel pr={pr} onClose={lower} />}
      {raised?.kind === "revert" && <RevertPanel pr={pr} onClose={lower} />}
    </div>
  );
}

function Header({ pr }: { pr: PrView }) {
  const triage =
    pr.reviewers.length + pr.assignees.length + pr.labels.length + pr.linkedIssues.length > 0 ||
    pr.milestone !== null;
  return (
    <header>
      <p className="font-code text-meta text-faint">
        {pr.repo}#{pr.number}
      </p>
      <h1 className="mt-1 max-w-[72ch] text-title font-semibold text-strong">{pr.title}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-meta text-muted">
        {pr.isDraft && (
          <span className="rounded-full border border-line-max px-2 leading-5 text-muted">
            Draft
          </span>
        )}
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
        {pr.state !== "OPEN" ? (
          <span className="flex items-center gap-3 text-faint">
            {pr.state === "MERGED" ? "Merged" : "Closed"}
            {(pr.headBranch.canDelete || pr.headBranch.canRestore) && (
              <span className="flex items-center gap-1.5">
                <Keys sequence="s x" />
                {pr.headBranch.exists ? "delete the branch" : "restore the branch"}
              </span>
            )}
            {pr.state === "MERGED" && (
              <span className="flex items-center gap-1.5">
                <Keys sequence="s v" /> revert
              </span>
            )}
          </span>
        ) : (
          pr.pending?.kind === "close" && <span className="text-warn">Closing</span>
        )}
        {pr.locked && (
          <span
            className="flex items-center gap-1.5 text-faint"
            title="Only people who can write to the repo can comment"
          >
            <Lock aria-hidden size={13} className="text-off" />
            Locked{pr.locked !== "locked" && ` as ${pr.locked}`}
          </span>
        )}
      </div>
      {triage && (
        <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-meta text-muted">
          {pr.reviewers.length > 0 && (
            <span aria-label="Reviewers" className="flex items-center gap-3">
              <Users aria-hidden size={14} className="text-off" />
              {pr.reviewers.map((r) => (
                <span
                  key={`${r.kind}:${r.login}`}
                  className="flex items-center gap-1.5"
                  title={r.state}
                >
                  <Dot tone={REVIEWER_TONE[r.state] ?? "faint"} />
                  {r.login}
                </span>
              ))}
            </span>
          )}
          {pr.assignees.length > 0 && (
            <span aria-label="Assignees" className="flex items-center gap-3">
              <UserRound aria-hidden size={14} className="text-off" />
              {pr.assignees.map((a) => (
                <span key={a.login} className="flex items-center gap-1.5">
                  <Avatar login={a.login} url={a.avatarUrl} size={16} />
                  {a.login}
                </span>
              ))}
            </span>
          )}
          {pr.labels.length > 0 && (
            <span aria-label="Labels" className="flex flex-wrap items-center gap-1.5">
              {pr.labels.map((label) => (
                <span
                  key={label.name}
                  className="rounded-full border px-2 text-[12px] leading-5"
                  style={{
                    borderColor: `#${label.color}80`,
                    color: `color-mix(in oklab, #${label.color} 55%, #e6e6e6)`,
                  }}
                >
                  {label.name}
                </span>
              ))}
            </span>
          )}
          {pr.milestone && (
            <span aria-label="Milestone" className="flex items-center gap-2">
              <Milestone aria-hidden size={14} className="text-off" />
              {pr.milestone.title}
            </span>
          )}
          {pr.linkedIssues.length > 0 && (
            <span aria-label="Closes" className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <CircleDot aria-hidden size={14} className="text-off" />
              {pr.linkedIssues.map((issue) => (
                <a
                  key={issue.url}
                  href={issue.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={issue.title}
                  className={clsx(
                    "hover:text-fg",
                    issue.state === "CLOSED" && "text-faint line-through",
                  )}
                >
                  {issue.repo === pr.repo ? "" : issue.repo}#{issue.number}
                </a>
              ))}
            </span>
          )}
        </div>
      )}
    </header>
  );
}

const REVIEWER_TONE: Record<string, Tone> = {
  APPROVED: "ok",
  CHANGES_REQUESTED: "bad",
  requested: "warn",
};

/** One sentence on whose move it is and what you're looking at. */
function TurnLine({
  pr,
  range,
  fallback,
}: {
  pr: PrView;
  range: DiffRange;
  fallback: string | null;
}) {
  const lastReview = pr.timeline
    .toReversed()
    .find((e) => e.kind === "review" && e.author?.login === pr.account);
  const pushedSince = pr.lastReviewedOid && pr.lastReviewedOid !== pr.headRefOid;
  let text: string;
  // A merged or closed PR isn't anyone's turn.
  if (pr.state !== "OPEN") text = "";
  else if (pr.approvedByYou) text = "You approved this commit.";
  else if (pushedSince && lastReview)
    text = `Your turn: ${pr.author?.login ?? "the author"} pushed after your review ${since(lastReview.at)}.`;
  else if (pr.reviewers.some((r) => r.login === pr.account && r.state === "requested"))
    text = "Your turn: your review was requested.";
  else text = "";
  const drafts = pr.drafts.length;
  if (!text && drafts === 0 && !fallback) return null;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-1 text-ui">
      {text && <span className="text-fg">{text}</span>}
      {range === "since-review" && pushedSince && (
        <span className="text-meta text-faint">
          Showing {pr.lastReviewedOid?.slice(0, 7)} to {pr.headRefOid.slice(0, 7)}.{" "}
          <Keys sequence="p" /> for everything
        </span>
      )}
      {fallback && <span className="text-meta text-warn">{fallback}</span>}
      {drafts > 0 && (
        <span className="flex items-center gap-1.5 text-meta text-accent">
          {plural(drafts, "draft comment")} waiting, <Keys sequence="r" /> to send
        </span>
      )}
    </div>
  );
}

/** Source first, then tests, then config and docs, then generated files and lockfiles. */
function reviewOrder<T extends { path: string }>(files: T[]): T[] {
  return files.toSorted(
    (a, b) => reviewRank(a.path) - reviewRank(b.path) || a.path.localeCompare(b.path),
  );
}

function reviewRank(path: string): number {
  if (
    /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|go\.sum)$/.test(
      path,
    ) ||
    /\.(snap|min\.js)$/.test(path)
  )
    return 4;
  if (/(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/.test(path)) return 1;
  if (/\.(md|mdx|txt|ya?ml|json|toml)$|^\.github\//.test(path)) return 2;
  return 0;
}
