import { useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useState } from "react";

import { errorText, takeBack } from "@/features/actions";
import { useCommands } from "@/keys/registry";
import { plural } from "@/lib/format";
import { rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import { Dock } from "@/ui/dock";
import { Keys } from "@/ui/kbd";
import type { PrView } from "@pier/core/wire";

import { Composer } from "./composer";

// The review rises out of the status line: pick what it says (comment, approve, request changes),
// write the summary, and send it together with every draft in one write. It holds for five
// seconds after sending, so `z` can still take it back.

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

const EVENTS: { event: ReviewEvent; label: string; sending: string }[] = [
  { event: "COMMENT", label: "Comment", sending: "Commenting" },
  { event: "APPROVE", label: "Approve", sending: "Approving" },
  { event: "REQUEST_CHANGES", label: "Request changes", sending: "Requesting changes" },
];

export function ReviewPanel({
  pr,
  initial,
  onClose,
  onSent,
}: {
  pr: PrView;
  initial: ReviewEvent;
  onClose: () => void;
  onSent: () => void;
}) {
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [event, setEvent] = useState<ReviewEvent>(initial);
  const own = pr.author?.login === pr.account;
  const stale = pr.drafts.filter((d) => d.headOid !== pr.headRefOid).length;

  useCommands([
    {
      id: "review.close",
      title: "Close review",
      keys: ["escape"],
      scope: "panel",
      inInputs: true,
      run: onClose,
    },
    ...EVENTS.map(({ event: e, label }, i) => ({
      id: `review.event-${e}`,
      title: label,
      keys: [`ctrl+${i + 1}`],
      scope: "panel" as const,
      inInputs: true,
      run: () => setEvent(e),
    })),
  ]);

  const submit = async (body: string) => {
    try {
      const { commandIds } = await rpc("submitReview", { prId: pr.id, event, body });
      onClose();
      void client.invalidateQueries();
      toast(
        {
          text: `${EVENTS.find((e) => e.event === event)?.sending ?? "Sending"} in 5s`,
          tone: "ok",
          undo: () => void takeBack(commandIds, "The review"),
        },
        5_000,
      );
      onSent();
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };

  return (
    <Dock label="Review">
      <div className="max-w-[900px]">
        <div className="mb-3 flex items-center gap-2">
          {EVENTS.map(({ event: e, label }, i) => {
            const disabled = own && e !== "COMMENT";
            return (
              <button
                key={e}
                type="button"
                disabled={disabled}
                onClick={() => setEvent(e)}
                className={clsx(
                  "flex h-8 items-center gap-2 rounded-sm border px-3 text-meta",
                  event === e
                    ? "border-accent bg-selected text-strong"
                    : "border-line-strong text-muted hover:text-fg",
                  disabled && "opacity-40",
                )}
              >
                <Keys sequence={`ctrl+${i + 1}`} />
                {label}
              </button>
            );
          })}
          <span className="ml-auto text-meta text-faint">
            {pr.drafts.length === 0
              ? "No inline comments"
              : `${plural(pr.drafts.length, "inline comment")} ${pr.drafts.length === 1 ? "goes" : "go"} with it`}
            {pr.pendingReview && (
              <span className="ml-2 text-auto">
                continues your review from github.com
                {pr.pendingReview.comments.length > 0 &&
                  ` (${plural(pr.pendingReview.comments.length, "comment")})`}
              </span>
            )}
            {stale > 0 && (
              <span className="ml-2 text-warn">{stale} written before the latest push</span>
            )}
          </span>
        </div>
        <Composer
          id="review-body"
          placeholder={
            event === "REQUEST_CHANGES" ? "What needs to change?" : "Leave a summary (optional)"
          }
          submitLabel={EVENTS.find((e) => e.event === event)?.label ?? "Submit"}
          focusOnMount
          minRows={3}
          onCancel={onClose}
          onSubmit={submit}
        />
        {event !== "REQUEST_CHANGES" && (
          <button
            type="button"
            onClick={() => void submit("")}
            className="mt-2 flex items-center gap-1.5 text-meta text-faint hover:text-fg"
          >
            Send without a summary
          </button>
        )}
      </div>
    </Dock>
  );
}
