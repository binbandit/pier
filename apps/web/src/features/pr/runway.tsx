import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";

import { errorText, rerun, takeBack } from "@/features/actions";
import { type Command, useCommands } from "@/keys/registry";
import { qLive, rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import { Dock } from "@/ui/dock";
import { Dot } from "@/ui/dot";
import { Keys } from "@/ui/kbd";
import type { MergeMethod, PrView, Runway } from "@pier/core/wire";

import { mergedAlong } from "./stack";

// The merge runway rises out of the status line: what still stands between this PR and merging,
// each with the key that clears it, then the method and message, and Enter to merge. A merge waits
// five seconds before it goes, so `z` can still stop it.

const LABELS: Record<MergeMethod, string> = {
  SQUASH: "Squash",
  MERGE: "Merge commit",
  REBASE: "Rebase",
};
const FIX_KEYS = { "update-branch": "u", rerun: "f r", "auto-merge": "a", ready: null } as const;

export function RunwayPanel({
  pr,
  onClose,
  onMerged,
}: {
  pr: PrView;
  onClose: () => void;
  onMerged: () => void;
}) {
  const { data: runway, isPending } = useQuery(
    qLive(
      "runway",
      { repo: pr.repo, number: pr.number },
      pr.headRefOid,
      pr.reviewDecision,
      pr.mergeable,
      pr.checks.state,
    ),
  );
  // Registered here rather than in Loaded so the panel owns the keys while it loads too, and an
  // early Enter can't fall through to the canvas.
  useCommands([
    {
      id: "runway.close",
      title: "Close",
      keys: ["escape"],
      scope: "panel",
      inInputs: true,
      run: onClose,
    },
  ]);
  if (isPending || !runway) {
    return (
      <Dock label="Merge" className="text-meta text-faint">
        {isPending ? "Checking what's in the way" : "Couldn't read this PR's merge state."}
      </Dock>
    );
  }
  return <Loaded pr={pr} runway={runway} onClose={onClose} onMerged={onMerged} />;
}

function Loaded({
  pr,
  runway,
  onClose,
  onMerged,
}: {
  pr: PrView;
  runway: Runway;
  onClose: () => void;
  onMerged: () => void;
}) {
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  // GitHub merges a stack from the bottom, so merging this takes the open PRs below with it.
  const along = mergedAlong(pr);
  const [method, setMethod] = useState<MergeMethod>(runway.defaultMethod);
  const message = runway.messages[method];
  const [headline, setHeadline] = useState(message?.headline ?? "");
  const [body, setBody] = useState(message?.body ?? "");

  const pick = (next: MergeMethod) => {
    setMethod(next);
    setHeadline(runway.messages[next]?.headline ?? "");
    setBody(runway.messages[next]?.body ?? "");
  };

  const act = async (
    work: () => Promise<{ commandIds: string[] }>,
    done: string,
    undoable = false,
  ) => {
    try {
      const { commandIds } = await work();
      void client.invalidateQueries();
      toast(
        {
          text: done,
          tone: "ok",
          ...(undoable ? { undo: () => void takeBack(commandIds, "The merge") } : {}),
        },
        undoable ? 5_000 : 4_000,
      );
      return true;
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
      return false;
    }
  };

  // Merging past the rules is offered to admins, and only goes once they've typed the repo's name.
  const [bypassing, setBypassing] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const confirmBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (bypassing) confirmBox.current?.focus();
  }, [bypassing]);

  const merge = async (bypass = false) => {
    if (!runway.ready && !bypass) return;
    const sent = await act(
      () =>
        rpc("merge", {
          prId: pr.id,
          method,
          ...(method !== "REBASE" ? { headline, body } : {}),
          ...(bypass ? { bypass } : {}),
        }),
      runway.queued && !bypass ? "Adding to the merge queue in 5s" : "Merging in 5s",
      true,
    );
    if (sent) {
      onClose();
      onMerged();
    }
  };
  const queue = (action: "jump" | "remove") =>
    void act(
      () => rpc("queue", { prId: pr.id, action }),
      action === "jump" ? "Jumped to the front of the merge queue" : "Taken out of the merge queue",
    );
  const toggleAutoMerge = () =>
    void act(
      () => rpc("setAutoMerge", { prId: pr.id, enabled: !runway.autoMerge, method }),
      runway.autoMerge
        ? "Auto-merge turned off"
        : `Auto-merge on: ${LABELS[method].toLowerCase()} when ready`,
    );
  const update = (rebase: boolean) =>
    void act(
      () => rpc("updateBranch", { prId: pr.id, rebase }),
      rebase ? "Rebasing onto the base branch" : "Merging the base branch in",
    );

  const commands: Command[] = [
    // Plain Enter merges from the panel; inside the message fields it's a newline, so there it's ⌘⏎.
    {
      id: "runway.merge",
      title: runway.queued ? "Add to the merge queue" : "Merge",
      keys: ["enter"],
      scope: "panel",
      run: () => void merge(),
    },
    ...(runway.canBypass
      ? [
          {
            id: "runway.bypass",
            title: "Merge as an admin, past the rules",
            keys: ["b"],
            scope: "panel" as const,
            run: () => setBypassing(true),
          },
          {
            id: "runway.bypass-confirm",
            title: "Merge past the rules",
            keys: ["enter"],
            scope: "panel" as const,
            inInputs: true,
            hidden: true,
            run: () => {
              if (bypassing && confirmation.trim() === pr.repo) void merge(true);
            },
          },
        ]
      : []),
    ...(runway.queued && !runway.mergeQueue && runway.ready
      ? [
          {
            id: "runway.jump",
            title: "Jump to the front of the merge queue",
            keys: ["j"],
            scope: "panel" as const,
            run: () => queue("jump"),
          },
        ]
      : []),
    ...(runway.mergeQueue
      ? [
          {
            id: "runway.dequeue",
            title: "Take it out of the merge queue",
            keys: ["x"],
            scope: "panel" as const,
            run: () => queue("remove"),
          },
        ]
      : []),
    {
      id: "runway.merge-typing",
      title: "Merge",
      keys: ["mod+enter"],
      scope: "panel",
      inInputs: true,
      hidden: true,
      run: () => void merge(),
    },
    ...runway.methods.map((m, i) => ({
      id: `runway.method-${m}`,
      title: LABELS[m],
      keys: [`${i + 1}`],
      scope: "panel" as const,
      run: () => pick(m),
    })),
    ...(runway.canAutoMerge
      ? [
          {
            id: "runway.auto",
            title: "Toggle auto-merge",
            keys: ["a"],
            scope: "panel" as const,
            run: toggleAutoMerge,
          },
        ]
      : []),
    ...(runway.canUpdateBranch
      ? [
          {
            id: "runway.update",
            title: "Update branch (merge)",
            keys: ["u"],
            scope: "panel" as const,
            run: () => update(false),
          },
          {
            id: "runway.rebase",
            title: "Update branch (rebase)",
            keys: ["shift+u"],
            scope: "panel" as const,
            run: () => update(true),
          },
        ]
      : []),
    {
      id: "runway.rerun",
      title: "Re-run failed checks",
      keys: ["f r"],
      scope: "panel",
      run: () => void rerun([pr.id]),
    },
  ];
  useCommands(commands);

  return (
    <Dock label="Merge">
      <div className="max-w-[900px]">
        <div className="mb-3 flex items-baseline gap-4">
          <h2 className="text-ui font-medium text-strong">
            {runway.ready ? "Ready to merge" : "Not ready to merge"}
          </h2>
          {runway.autoMerge && (
            <span className="text-meta text-auto">
              Auto-merge is on ({LABELS[runway.autoMerge.method].toLowerCase()})
            </span>
          )}
          {runway.mergeQueue && (
            <span className="flex items-center gap-3 text-meta text-auto">
              In the merge queue, position {runway.mergeQueue.position}
              <span className="flex items-center gap-1.5 text-faint">
                <Keys sequence="x" /> take it out
              </span>
            </span>
          )}
        </div>

        {along.length > 0 && (
          <p className="mb-3 text-ui text-warn">
            This is in a stack: merging it also merges{" "}
            {along.map((member) => `#${member.number}`).join(", ")} below it.
          </p>
        )}

        {runway.blockers.length > 0 && (
          <ul className="mb-4 space-y-1">
            {runway.blockers.map((blocker) => {
              const key = blocker.fix ? FIX_KEYS[blocker.fix] : null;
              return (
                <li key={blocker.text} className="flex items-center gap-3 text-ui">
                  <Dot tone={blocker.fix ? "warn" : "bad"} />
                  <span className="text-fg">{blocker.text}</span>
                  {key && (
                    <span className="flex items-center gap-1.5 text-meta text-faint">
                      <Keys sequence={key} />
                      {blocker.fix === "auto-merge"
                        ? "merge it when it's ready"
                        : blocker.fix === "rerun"
                          ? "re-run failed"
                          : "update branch"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mb-3 flex items-center gap-2">
          {runway.methods.map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => pick(m)}
              className={clsx(
                "flex h-8 items-center gap-2 rounded-sm border px-3 text-meta",
                method === m
                  ? "border-accent bg-selected text-strong"
                  : "border-line-strong text-muted hover:text-fg",
              )}
            >
              <Keys sequence={`${i + 1}`} />
              {LABELS[m]}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-4 text-meta text-faint">
            {/* Behind but not blocked (no up-to-date rule): GitHub still offers the update, so do we. */}
            {runway.canUpdateBranch && !runway.blockers.some((b) => b.fix === "update-branch") && (
              <span className="flex items-center gap-1.5">
                <Keys sequence="u" /> update branch
              </span>
            )}
            {runway.canAutoMerge && (
              <span className="flex items-center gap-1.5">
                <Keys sequence="a" /> {runway.autoMerge ? "turn off auto-merge" : "auto-merge"}
              </span>
            )}
            {runway.canBypass && (
              <span className="flex items-center gap-1.5">
                <Keys sequence="b" /> merge as admin
              </span>
            )}
            {runway.queued && !runway.mergeQueue && runway.ready && (
              <span className="flex items-center gap-1.5">
                <Keys sequence="j" /> jump the queue
              </span>
            )}
            <span className={clsx("flex items-center gap-1.5", !runway.ready && "opacity-40")}>
              <Keys sequence="enter" /> {runway.queued ? "Add to the queue" : LABELS[method]}
            </span>
          </span>
        </div>

        {bypassing && (
          <div className="mb-3 rounded-md border border-bad/50 px-3 py-2">
            <p className="mb-2 text-meta text-fg">
              This merges past the branch's rules (
              {runway.blockers.map((b) => b.text.toLowerCase()).join("; ")}). Type{" "}
              <span className="font-code text-strong">{pr.repo}</span> and press Enter to do it.
            </p>
            <input
              autoComplete="off"
              spellCheck={false}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              aria-label="Type the repository name to confirm"
              ref={confirmBox}
              className="h-9 w-full rounded-sm border border-line-strong bg-canvas px-3 font-code text-meta text-strong outline-none"
            />
          </div>
        )}

        {method !== "REBASE" && (
          <div className="rounded-md border border-line-strong bg-canvas">
            <input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              aria-label="Commit title"
              className="block h-10 w-full border-b border-line bg-transparent px-3 text-ui text-strong outline-none"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label="Commit message"
              rows={3}
              className="block w-full resize-none bg-transparent px-3 py-2 font-code text-meta text-fg outline-none"
            />
          </div>
        )}
      </div>
    </Dock>
  );
}
