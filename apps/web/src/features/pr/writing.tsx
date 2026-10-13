import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import {
  Ban,
  Eye,
  EyeOff,
  History,
  type LucideIcon,
  Pencil,
  SmilePlus,
  TextQuote,
  Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { Html, Markdown } from "@/components/markdown";
import { errorText, takeBack } from "@/features/actions";
import { since } from "@/lib/format";
import { q, rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import type { Commentable, MinimizeReason, ReactionContent } from "@pier/core/wire";

import { Composer } from "./composer";

// One comment, review summary or PR description: what was written, its reactions, and what you
// can do to it. Actions show on hover so a long conversation stays quiet to read.

const EMOJI: Record<ReactionContent, string> = {
  THUMBS_UP: "👍",
  THUMBS_DOWN: "👎",
  LAUGH: "😄",
  HOORAY: "🎉",
  CONFUSED: "😕",
  HEART: "❤️",
  ROCKET: "🚀",
  EYES: "👀",
};

const HIDE_REASONS: { reason: MinimizeReason; label: string }[] = [
  { reason: "OFF_TOPIC", label: "Off topic" },
  { reason: "OUTDATED", label: "Outdated" },
  { reason: "RESOLVED", label: "Resolved" },
  { reason: "DUPLICATE", label: "Duplicate" },
  { reason: "SPAM", label: "Spam" },
  { reason: "ABUSE", label: "Abuse" },
];

type Mode = "reading" | "editing" | "reacting" | "hiding" | "dismissing" | "history";

export function Writing({
  prId,
  id,
  writing,
  html,
  header,
  quoteInto,
  onQuote,
  canDismiss = false,
  bodyClassName = "prose-pier mt-1 text-[14px]",
  className,
}: {
  prId: string;
  id: string;
  writing: Commentable;
  /** GitHub's rendered body; null (or an unsent edit) renders the markdown here instead. */
  html: string | null;
  header?: ReactNode;
  /** The composer a quote reply goes into; null when there's nowhere to reply. */
  quoteInto: string | null;
  /** Runs before quoting, so the target composer can open first. */
  onQuote?: () => void;
  canDismiss?: boolean;
  bodyClassName?: string;
  className?: string;
}) {
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  const quote = useUi((s) => s.quoteInto);
  const [mode, setMode] = useState<Mode>("reading");
  const [showHidden, setShowHidden] = useState(false);

  const send = async (work: () => Promise<{ commandIds: string[] }>, done?: string) => {
    try {
      const { commandIds } = await work();
      void client.invalidateQueries({ queryKey: ["pr"] });
      setMode("reading");
      if (done) toast({ text: done, tone: "ok" });
      return commandIds;
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
      return null;
    }
  };

  const react = (content: ReactionContent, on: boolean) =>
    void send(() => rpc("react", { prId, subjectId: id, content, on }));

  const remove = async () => {
    if (writing.subject !== "issue-comment" && writing.subject !== "review-comment") return;
    const subject = writing.subject;
    const commandIds = await send(() => rpc("deleteComment", { prId, subject, subjectId: id }));
    if (commandIds)
      toast(
        {
          text: "Deleting the comment in 5s",
          tone: "ok",
          undo: () => void takeBack(commandIds, "Deleting the comment"),
        },
        5_000,
      );
  };

  const hasBody = writing.body.trim().length > 0;
  const toggle = (next: Mode) => setMode(mode === next ? "reading" : next);
  // On hover, or while one of them is in use. With a byline they sit over its right edge;
  // without one (the PR description) they get a row under the text.
  const actions = mode !== "editing" && (
    <span
      className={clsx(
        "flex items-center gap-0.5 text-faint",
        header ? "absolute -top-1 right-0 bg-canvas pl-2" : "mt-2 h-7",
        mode === "reading" && "opacity-0 group-hover/writing:opacity-100 focus-within:opacity-100",
      )}
    >
      <IconAction
        icon={SmilePlus}
        label="React"
        active={mode === "reacting"}
        onClick={() => toggle("reacting")}
      />
      {quoteInto && hasBody && (
        <IconAction
          icon={TextQuote}
          label="Quote"
          onClick={() => {
            onQuote?.();
            quote(quoteInto, quoted(writing.body));
          }}
        />
      )}
      {writing.canEdit && (
        <IconAction icon={Pencil} label="Edit" onClick={() => setMode("editing")} />
      )}
      {writing.edited && (
        <IconAction
          icon={History}
          label="History"
          active={mode === "history"}
          onClick={() => toggle("history")}
        />
      )}
      {writing.canMinimize &&
        (writing.minimized ? (
          <IconAction
            icon={Eye}
            label="Unhide"
            onClick={() => void send(() => rpc("minimize", { prId, subjectId: id, reason: null }))}
          />
        ) : (
          <IconAction
            icon={EyeOff}
            label="Hide"
            active={mode === "hiding"}
            onClick={() => toggle("hiding")}
          />
        ))}
      {canDismiss && (
        <IconAction
          icon={Ban}
          label="Dismiss"
          active={mode === "dismissing"}
          onClick={() => toggle("dismissing")}
        />
      )}
      {writing.canDelete && (
        <IconAction icon={Trash2} label="Delete" danger onClick={() => void remove()} />
      )}
    </span>
  );

  const hidden = writing.minimized !== null && !showHidden;

  return (
    <div className={clsx("group/writing relative", className)}>
      {header}
      {header && actions}
      {mode === "editing" ? (
        <div className="mt-2">
          <Composer
            id={`edit-${id}`}
            placeholder="Write something"
            initial={writing.body}
            submitLabel="Save"
            focusOnMount
            minRows={3}
            onCancel={() => setMode("reading")}
            onSubmit={(body) =>
              void send(() =>
                rpc("editWriting", { prId, subject: writing.subject, subjectId: id, body }),
              )
            }
          />
        </div>
      ) : hidden ? (
        <p className="mt-1 text-meta text-faint">
          Hidden as {writing.minimized?.replaceAll("-", " ")}.{" "}
          <button type="button" onClick={() => setShowHidden(true)} className="hover:text-fg">
            Show
          </button>
        </p>
      ) : (
        hasBody &&
        (writing.unsent || html === null ? (
          <Markdown source={writing.body} className={bodyClassName} />
        ) : (
          <Html html={html} className={bodyClassName} />
        ))
      )}

      {mode !== "editing" && !hidden && writing.reactions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-meta">
          {writing.reactions.map((r) => (
            <button
              key={r.content}
              type="button"
              aria-pressed={r.mine}
              onClick={() => react(r.content, !r.mine)}
              className={clsx(
                "flex h-6 items-center gap-1.5 rounded-full border px-2",
                r.mine
                  ? "border-accent/60 bg-selected text-strong"
                  : "border-line-strong text-muted",
              )}
            >
              <span aria-hidden>{EMOJI[r.content]}</span>
              {r.count}
            </button>
          ))}
        </div>
      )}

      {!header && actions}

      {mode === "reacting" && (
        <div className="mt-1.5 flex gap-1" role="group" aria-label="Reactions">
          {(Object.keys(EMOJI) as ReactionContent[]).map((content) => {
            const mine = writing.reactions.some((r) => r.content === content && r.mine);
            return (
              <button
                key={content}
                type="button"
                aria-label={content.toLowerCase().replace("_", " ")}
                aria-pressed={mine}
                onClick={() => react(content, !mine)}
                className={clsx(
                  "flex size-8 items-center justify-center rounded-sm text-[16px] hover:bg-hover",
                  mine && "bg-selected",
                )}
              >
                {EMOJI[content]}
              </button>
            );
          })}
        </div>
      )}

      {mode === "hiding" && (
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-meta">
          <span className="text-faint">Hide as</span>
          {HIDE_REASONS.map(({ reason, label }) => (
            <Action
              key={reason}
              onClick={() => void send(() => rpc("minimize", { prId, subjectId: id, reason }))}
            >
              {label}
            </Action>
          ))}
        </div>
      )}

      {mode === "history" && <Revisions prId={prId} id={id} />}

      {mode === "dismissing" && (
        <div className="mt-2">
          <Composer
            id={`dismiss-${id}`}
            placeholder="Why dismiss this review? The reviewer sees this."
            submitLabel="Dismiss review"
            focusOnMount
            minRows={2}
            onCancel={() => setMode("reading")}
            onSubmit={(message) =>
              void send(
                () => rpc("dismissReview", { prId, reviewId: id, message }),
                "Review dismissed",
              )
            }
          />
        </div>
      )}
    </div>
  );
}

/** Every version, newest first, the way GitHub's "edited" menu lists them. */
function Revisions({ prId, id }: { prId: string; id: string }) {
  const { data: revisions, isPending } = useQuery(q("history", { prId, subjectId: id }));
  if (isPending) return <p className="mt-2 text-meta text-faint">Loading the history</p>;
  if (!revisions?.length) return <p className="mt-2 text-meta text-faint">No earlier versions.</p>;
  return (
    <ol className="mt-2 space-y-3 border-l border-line pl-3">
      {revisions.map((revision, i) => (
        <li key={`${revision.editedAt}-${revision.editor ?? ""}`}>
          <p className="text-meta text-faint">
            {i === revisions.length - 1 ? "Written" : "Edited"} by {revision.editor ?? "someone"},{" "}
            {since(revision.editedAt)}
            {i === 0 && " (now)"}
          </p>
          <Markdown source={revision.body} className="prose-pier mt-1 text-[13px] text-muted" />
        </li>
      ))}
    </ol>
  );
}

function IconAction({
  icon: Icon,
  label,
  onClick,
  active = false,
  danger = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={clsx(
        "flex size-7 items-center justify-center rounded-sm hover:bg-hover",
        active ? "text-fg" : "text-faint",
        danger ? "hover:text-bad" : "hover:text-fg",
      )}
    >
      <Icon aria-hidden size={15} strokeWidth={1.75} />
    </button>
  );
}

function Action({
  onClick,
  danger = false,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx("text-faint", danger ? "hover:text-bad" : "hover:text-fg")}
    >
      {children}
    </button>
  );
}

/** Markdown quote of what was written, the way GitHub's "Quote reply" does it. */
function quoted(body: string): string {
  return body
    .trim()
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}
