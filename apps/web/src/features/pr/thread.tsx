import { useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useState } from "react";

import { Html, Markdown } from "@/components/markdown";
import { errorText } from "@/features/actions";
import { ago } from "@/lib/format";
import { rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import { Avatar } from "@/ui/avatar";
import type { Draft, Thread } from "@pier/core/wire";

import { Composer } from "./composer";

// Conversation that sits inside the diff, on the lines it's about. Replies post straight away;
// resolving collapses the thread to one line so the code stays readable.

export function ThreadCard({
  prId,
  thread,
  focused,
}: {
  prId: string;
  thread: Thread;
  focused: boolean;
}) {
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(!thread.resolved);
  const [replying, setReplying] = useState(false);

  const refresh = () => void client.invalidateQueries({ queryKey: ["pr"] });
  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
      refresh();
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };

  const first = thread.comments[0];
  if (!open) {
    return (
      <button
        type="button"
        data-thread={thread.id}
        onClick={() => setOpen(true)}
        className={clsx(
          "my-1 flex w-full max-w-[820px] items-center gap-3 rounded-md border px-3 py-1.5 text-left text-meta",
          focused ? "border-accent/60" : "border-line",
        )}
      >
        {first?.author && (
          <Avatar login={first.author.login} url={first.author.avatarUrl} size={14} />
        )}
        <span className="truncate text-muted">{plainText(first?.body ?? "")}</span>
        <span className="ml-auto shrink-0 text-faint">
          {thread.resolved ? `Resolved${thread.resolvedBy ? ` by ${thread.resolvedBy}` : ""}` : ""}
          {thread.comments.length > 1 ? `, ${thread.comments.length} comments` : ""}
        </span>
      </button>
    );
  }

  return (
    <section
      data-thread={thread.id}
      className={clsx(
        "my-2 max-w-[820px] rounded-md border bg-canvas font-ui",
        focused ? "border-accent/60" : "border-line-strong",
      )}
    >
      <ul className="divide-y divide-line">
        {thread.comments.map((comment) => (
          <li key={comment.id} className="px-4 py-3">
            <div className="mb-1.5 flex items-center gap-2 text-meta">
              {comment.author && (
                <Avatar login={comment.author.login} url={comment.author.avatarUrl} size={16} />
              )}
              <span className="text-fg">{comment.author?.login ?? "ghost"}</span>
              <span className="text-faint">{ago(comment.createdAt)} ago</span>
              {comment.edited && <span className="text-faint">edited</span>}
            </div>
            <Html html={comment.bodyHTML} className="prose-pier text-ui" />
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-meta text-faint">
        {thread.pending && <span className="text-auto">Sending</span>}
        {thread.outdated && <span>Outdated</span>}
        <span className="ml-auto flex items-center gap-4">
          {thread.canReply && !replying && (
            <button type="button" onClick={() => setReplying(true)} className="hover:text-fg">
              Reply
            </button>
          )}
          {thread.canResolve && (
            <button
              type="button"
              onClick={() =>
                void run(() =>
                  rpc("resolveThread", { prId, threadId: thread.id, resolved: !thread.resolved }),
                ).then(() => !thread.resolved && setOpen(false))
              }
              className="hover:text-fg"
            >
              {thread.resolved ? "Unresolve" : "Resolve"}
            </button>
          )}
          {thread.resolved && (
            <button type="button" onClick={() => setOpen(false)} className="hover:text-fg">
              Collapse
            </button>
          )}
        </span>
      </div>
      {replying && (
        <div className="border-t border-line p-3">
          <Composer
            id={`reply-${thread.id}`}
            placeholder="Reply"
            submitLabel="Reply"
            focusOnMount
            minRows={2}
            onCancel={() => setReplying(false)}
            onSubmit={(body) =>
              run(async () => {
                await rpc("reply", { prId, threadId: thread.id, body });
                setReplying(false);
              })
            }
          />
        </div>
      )}
    </section>
  );
}

export function DraftCard({
  prId,
  draft,
  headOid,
}: {
  prId: string;
  draft: Draft;
  headOid: string;
}) {
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [editing, setEditing] = useState(false);
  const stale = draft.headOid !== headOid;

  const save = async (body: string) => {
    try {
      await rpc("saveDraft", {
        id: draft.id,
        prId,
        path: draft.path,
        side: draft.side,
        line: draft.line,
        startLine: draft.startLine,
        body,
      });
      setEditing(false);
      void client.invalidateQueries({ queryKey: ["pr"] });
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };
  const remove = async () => {
    await rpc("deleteDraft", { id: draft.id });
    void client.invalidateQueries({ queryKey: ["pr"] });
  };

  if (editing) {
    return (
      <div className="my-2 max-w-[820px]">
        <Composer
          id={`draft-${draft.id}`}
          placeholder="Comment"
          initial={draft.body}
          submitLabel="Save"
          focusOnMount
          onCancel={() => setEditing(false)}
          onSubmit={save}
        />
      </div>
    );
  }
  return (
    <section
      data-draft={draft.id}
      className="my-2 max-w-[820px] rounded-md border border-dashed border-line-max bg-canvas px-4 py-3 font-ui"
    >
      <div className="mb-1.5 flex items-center gap-3 text-meta">
        <span className="text-accent">Draft</span>
        <span className="text-faint">Sends with your review</span>
        {stale && <span className="text-warn">Written before the latest push</span>}
        <span className="ml-auto flex gap-4 text-faint">
          <button type="button" onClick={() => setEditing(true)} className="hover:text-fg">
            Edit
          </button>
          <button type="button" onClick={() => void remove()} className="hover:text-bad">
            Delete
          </button>
        </span>
      </div>
      <Markdown source={draft.body} className="prose-pier text-ui" />
    </section>
  );
}

function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/[#*_`>[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
