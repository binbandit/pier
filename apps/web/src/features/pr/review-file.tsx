import type { DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { PatchDiff } from "@pierre/diffs/react";
import { useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import { DIFF_OPTIONS, LOCKFILE, toPatch } from "@/diff/adapter";
import { codeBetween, patchLines } from "@/diff/lines";
import { errorText } from "@/features/actions";
import { rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import type { DiffFile, Draft, Side, Thread, ViewedState } from "@pier/core/wire";

import { Composer } from "./composer";
import { DraftCard, ThreadCard } from "./thread";

// One file in the review stream: our own header (path, stats, viewed), then the diff with every
// thread and draft placed on the lines it's about. Selecting lines and pressing `c` (or clicking
// the + in the gutter) opens a comment right there.

export type NewComment = { path: string; side: Side; start: number; end: number };

type Note =
  | { kind: "thread"; thread: Thread }
  | { kind: "draft"; draft: Draft }
  | { kind: "new"; comment: NewComment };

type Props = {
  prId: string;
  headOid: string;
  file: DiffFile;
  threads: Thread[];
  drafts: Draft[];
  viewed: ViewedState;
  current: boolean;
  focusedThread: string | null;
  composing: NewComment | null;
  selection: SelectedLineRange | null;
  onSelect: (path: string, range: SelectedLineRange | null) => void;
  onCompose: (comment: NewComment | null) => void;
};

export function ReviewFile(props: Props) {
  const {
    prId,
    headOid,
    file,
    threads,
    drafts,
    viewed,
    current,
    focusedThread,
    composing,
    selection,
    onSelect,
    onCompose,
  } = props;
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  const isLockfile = LOCKFILE.test(file.path);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? (viewed !== "viewed" && !isLockfile);

  const lines = patchLines(file);
  // The renderer can only place a note on a line this diff shows. Threads on unchanged lines, or
  // outside a narrower "since your review" diff, are listed under the file instead.
  const visible = (side: Side, line: number) =>
    (side === "RIGHT" ? lines.right : lines.left).has(line);
  const placed = threads.filter((t) => t.line !== null && !t.outdated && visible(t.side, t.line));
  const elsewhere = threads.filter(
    (t) => t.line !== null && !t.outdated && !visible(t.side, t.line),
  );
  const outdated = threads.filter((t) => t.line === null || t.outdated);
  const placedDrafts = drafts.filter((d) => visible(d.side, d.line));
  const otherDrafts = drafts.filter((d) => !visible(d.side, d.line));
  // Rebuilt only when what's on the lines actually changes; a new array on every refetch makes the
  // renderer redraw (and on first mount, sometimes not draw at all).
  const notesKey = [
    ...placed.map(
      (t) => `t:${t.id}:${t.line}:${t.resolved}:${t.comments.length}:${t.pending?.state ?? ""}`,
    ),
    ...placedDrafts.map((d) => `d:${d.id}:${d.line}:${d.body.length}`),
    composing && composing.path === file.path ? `n:${composing.side}:${composing.end}` : "",
  ].join("|");
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- notesKey captures every input that matters
  const notes = useMemo(() => buildNotes(placed, placedDrafts, composing, file.path), [notesKey]);

  const toggleViewed = async () => {
    try {
      await rpc("setViewed", { prId, path: file.path, viewed: viewed !== "viewed" });
      setExpanded(null);
      void client.invalidateQueries({ queryKey: ["pr"] });
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };

  // The renderer rebuilds itself whenever `options` changes identity, so it's made once per file
  // and reaches the latest callbacks through a ref.
  const callbacks = useRef({ onSelect, onCompose });
  useEffect(() => {
    callbacks.current = { onSelect, onCompose };
  });
  const path = file.path;
  const options = useMemo(
    () => ({
      ...DIFF_OPTIONS,
      // pier draws its own header (with Viewed). `disableFileHeader: true` stops @pierre/diffs 1.5.2
      // from rendering any lines at all, so its header is hidden with CSS instead.
      unsafeCSS: `${DIFF_OPTIONS.unsafeCSS}\n[data-diffs-header] { display: none; }`,
      enableLineSelection: true,
      enableGutterUtility: true,
      onLineSelected: (range: SelectedLineRange | null) => callbacks.current.onSelect(path, range),
      onGutterUtilityClick: (range: SelectedLineRange) =>
        callbacks.current.onCompose(fromRange(path, range)),
    }),
    [path],
  );
  const patch = useMemo(() => toPatch(file), [file]);

  return (
    <section data-file={file.path} className="scroll-mt-4">
      <header
        className={clsx(
          "sticky top-0 z-10 flex h-11 items-center gap-3 border-b bg-canvas px-1",
          current ? "border-line-max" : "border-line",
        )}
      >
        {current && <span aria-hidden className="h-4 w-0.5 rounded-full bg-accent" />}
        <button
          type="button"
          onClick={() => setExpanded(!open)}
          className="min-w-0 truncate text-left font-code text-meta text-fg hover:text-strong"
        >
          {file.previousPath ? (
            <>
              <span className="text-faint">{file.previousPath} → </span>
              {file.path}
            </>
          ) : (
            file.path
          )}
        </button>
        <span className="shrink-0 font-code text-meta">
          <span className="text-ok">+{file.additions}</span>{" "}
          <span className="text-bad">−{file.deletions}</span>
        </span>
        {threads.length > 0 && (
          <span className="shrink-0 text-meta text-faint">
            {threads.length} {threads.length === 1 ? "thread" : "threads"}
          </span>
        )}
        {viewed === "changed" && (
          <span className="shrink-0 text-meta text-warn">Changed since you viewed it</span>
        )}
        <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-2 text-meta text-muted hover:text-fg">
          <input
            type="checkbox"
            checked={viewed === "viewed"}
            onChange={() => void toggleViewed()}
            className="size-3.5 accent-[var(--color-accent)]"
          />
          Viewed
        </label>
      </header>

      {open &&
        (file.patch === null ? (
          <p className="px-1 py-3 text-meta text-faint">
            GitHub didn't send a diff for this file (binary or too large).
          </p>
        ) : (
          <PatchDiff
            patch={patch}
            options={options}
            lineAnnotations={notes}
            selectedLines={selection}
            renderAnnotation={(annotation) => {
              const note = annotation.metadata;
              if (note.kind === "thread")
                return (
                  <ThreadCard
                    prId={prId}
                    thread={note.thread}
                    focused={note.thread.id === focusedThread}
                  />
                );
              if (note.kind === "draft")
                return <DraftCard prId={prId} draft={note.draft} headOid={headOid} />;
              const source = codeBetween(
                lines,
                note.comment.side,
                note.comment.start,
                note.comment.end,
              );
              return (
                <div className="my-2 max-w-[820px] font-ui">
                  <Composer
                    id="new-comment"
                    placeholder={`Comment on ${rangeLabel(note.comment)}`}
                    submitLabel="Save draft"
                    focusOnMount
                    suggestionSource={note.comment.side === "RIGHT" ? source : null}
                    onCancel={() => onCompose(null)}
                    onSubmit={async (body) => {
                      try {
                        await rpc("saveDraft", {
                          prId,
                          path: file.path,
                          side: note.comment.side,
                          line: note.comment.end,
                          startLine:
                            note.comment.start === note.comment.end ? null : note.comment.start,
                          body,
                        });
                        onCompose(null);
                        onSelect(file.path, null);
                        void client.invalidateQueries({ queryKey: ["pr"] });
                      } catch (error) {
                        toast({ text: errorText(error), tone: "bad" });
                      }
                    }}
                  />
                </div>
              );
            }}
          />
        ))}

      {open && (elsewhere.length > 0 || otherDrafts.length > 0) && (
        <div className="mt-2 space-y-2">
          {elsewhere.map((thread) => (
            <div key={thread.id}>
              <p className="mb-1 px-1 font-code text-meta text-faint">
                Line {thread.line}, not in this diff
              </p>
              <ThreadCard prId={prId} thread={thread} focused={thread.id === focusedThread} />
            </div>
          ))}
          {otherDrafts.map((draft) => (
            <div key={draft.id}>
              <p className="mb-1 px-1 font-code text-meta text-faint">
                Line {draft.line}, not in this diff
              </p>
              <DraftCard prId={prId} draft={draft} headOid={headOid} />
            </div>
          ))}
        </div>
      )}

      {open && outdated.length > 0 && (
        <div className="mt-2 space-y-2">
          {outdated.map((thread) => (
            <div key={thread.id}>
              <p className="mb-1 px-1 font-code text-meta text-faint">
                Outdated, originally on line {thread.originalLine ?? "?"}
              </p>
              <pre className="mb-1 max-w-[820px] overflow-x-auto rounded-sm border border-line px-3 py-2 font-code text-[12px] leading-5 text-muted">
                {lastLines(thread.diffHunk, 4)}
              </pre>
              <ThreadCard prId={prId} thread={thread} focused={thread.id === focusedThread} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function buildNotes(
  placed: Thread[],
  drafts: Draft[],
  composing: NewComment | null,
  path: string,
): DiffLineAnnotation<Note>[] {
  return [
    ...placed.map((thread) => ({
      side: sideOf(thread.side),
      lineNumber: thread.line ?? 0,
      metadata: { kind: "thread" as const, thread },
    })),
    ...drafts.map((draft) => ({
      side: sideOf(draft.side),
      lineNumber: draft.line,
      metadata: { kind: "draft" as const, draft },
    })),
    ...(composing && composing.path === path
      ? [
          {
            side: sideOf(composing.side),
            lineNumber: composing.end,
            metadata: { kind: "new" as const, comment: composing },
          },
        ]
      : []),
  ];
}

function sideOf(side: Side): "additions" | "deletions" {
  return side === "LEFT" ? "deletions" : "additions";
}

export function fromRange(path: string, range: SelectedLineRange): NewComment {
  const side: Side = (range.endSide ?? range.side) === "deletions" ? "LEFT" : "RIGHT";
  return {
    path,
    side,
    start: Math.min(range.start, range.end),
    end: Math.max(range.start, range.end),
  };
}

function rangeLabel(comment: NewComment): string {
  return comment.start === comment.end
    ? `line ${comment.end}`
    : `lines ${comment.start} to ${comment.end}`;
}

function lastLines(hunk: string, count: number): string {
  return hunk.split("\n").slice(-count).join("\n");
}
