import type { Commentable, PrView, Reaction, ReactionContent } from "@pier/core/wire";

import type { PendingEdit } from "./metadata";

// Reactions, edits, deletes, hides, dismissals, locking and title/description changes as they'll
// be once the writes still in the outbox land, laid over the PR view so each shows the moment
// it's made. Once a write lands the detail is read again, so only unsent writes need this.

export function overlayConversation(view: PrView, pending: PendingEdit[]): PrView {
  let next = view;
  for (const { kind, payload } of pending) {
    const id = payload.subjectId ?? "";
    switch (kind) {
      case "react": {
        const content = payload.content ?? "THUMBS_UP";
        const on = payload.on ?? true;
        next =
          id === next.id
            ? { ...next, reactions: toggle(next.reactions, content, on) }
            : mapWriting(next, id, (w) => ({ ...w, reactions: toggle(w.reactions, content, on) }));
        break;
      }
      case "edit-comment":
        next =
          payload.subject === "pull-request"
            ? { ...next, body: payload.body ?? next.body, bodyHTML: null }
            : mapWriting(next, id, (w) => ({ ...w, body: payload.body ?? w.body, unsent: true }));
        break;
      case "delete-comment":
        next = {
          ...next,
          timeline: next.timeline.filter((e) => !("id" in e) || e.id !== id),
          threads: next.threads
            .map((t) => ({ ...t, comments: t.comments.filter((c) => c.id !== id) }))
            .filter((t) => t.comments.length > 0),
        };
        break;
      case "minimize":
        next = mapWriting(next, id, (w) => ({
          ...w,
          minimized: payload.reason ? payload.reason.toLowerCase().replaceAll("_", "-") : null,
        }));
        break;
      case "dismiss-review":
        next = {
          ...next,
          timeline: next.timeline.map((e) =>
            e.kind === "review" && e.id === id
              ? { ...e, state: "DISMISSED", canDismiss: false }
              : e,
          ),
        };
        break;
      case "edit-pr":
        next = {
          ...next,
          title: payload.title ?? next.title,
          baseRefName: payload.base ?? next.baseRefName,
          ...(payload.body !== undefined ? { body: payload.body, bodyHTML: null } : {}),
        };
        break;
      case "lock":
        next = { ...next, locked: payload.lockReason ?? null };
        break;
      default:
        break;
    }
  }
  return next;
}

/** Applies `change` to the comment or review with this id, wherever it is. */
function mapWriting(
  view: PrView,
  id: string,
  change: <W extends Commentable>(writing: W) => W,
): PrView {
  return {
    ...view,
    timeline: view.timeline.map((e) =>
      (e.kind === "comment" || e.kind === "review") && e.id === id ? change(e) : e,
    ),
    threads: view.threads.map((t) => ({
      ...t,
      comments: t.comments.map((c) => (c.id === id ? change(c) : c)),
    })),
  };
}

/** GitHub's order, so a new reaction lands where it will once GitHub reports it. */
const ORDER: ReactionContent[] = [
  "THUMBS_UP",
  "THUMBS_DOWN",
  "LAUGH",
  "HOORAY",
  "CONFUSED",
  "HEART",
  "ROCKET",
  "EYES",
];

function toggle(reactions: Reaction[], content: ReactionContent, on: boolean): Reaction[] {
  const existing = reactions.find((r) => r.content === content);
  if (on === (existing?.mine ?? false)) return reactions;
  const count = (existing?.count ?? 0) + (on ? 1 : -1);
  const rest = reactions.filter((r) => r.content !== content);
  return (count > 0 ? [...rest, { content, count, mine: on }] : rest).toSorted(
    (a, b) => ORDER.indexOf(a.content) - ORDER.indexOf(b.content),
  );
}
