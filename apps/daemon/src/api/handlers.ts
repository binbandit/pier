import type { App } from "@/app";
import type { Output, ParsedInput, ProcedureName } from "@pier/core/contract";

// One handler per procedure in the contract. The mapped type makes a missing or mistyped
// handler a compile error.

export type Handlers = {
  [N in ProcedureName]: (input: ParsedInput<N>) => Promise<Output<N>> | Output<N>;
};

export function createHandlers(app: App): Handlers {
  return {
    status: () => app.status(),
    inbox: ({ split }) => app.views.inbox(split),
    counts: () => app.views.counts(),
    group: ({ key }) => app.views.group(key),
    pr: ({ repo, number }) => app.review.view(repo, number),
    prDiff: ({ repo, number, range, ignoreWhitespace }) =>
      app.review.diff(repo, number, range, ignoreWhitespace ?? false),
    saveDraft(input) {
      const id = app.review.saveDraft({
        id: input.id,
        prId: input.prId,
        path: input.path,
        side: input.side,
        line: input.line,
        startLine: input.startLine ?? null,
        body: input.body,
      });
      app.events.emit(["pr"]);
      return { id };
    },
    deleteDraft({ id }) {
      app.review.deleteDraft(id);
      app.events.emit(["pr"]);
      return { ok: true };
    },
    async submitReview({ prId, event, body }) {
      return { commandIds: await app.review.submit(prId, event, body) };
    },
    reply: ({ prId, threadId, body }) => ({ commandIds: app.review.reply(prId, threadId, body) }),
    resolveThread: ({ prId, threadId, resolved }) => ({
      commandIds: app.review.resolve(prId, threadId, resolved),
    }),
    setViewed: ({ prId, path, viewed }) => ({
      commandIds: app.review.setViewed(prId, path, viewed),
    }),
    comment: ({ prId, body }) => ({ commandIds: app.review.comment(prId, body) }),
    flight: () => app.views.flight(),
    log: ({ limit }) => app.outbox.log(limit ?? 100),

    planAction: ({ action, prIds, groupKey }) => app.planner.plan(action, prIds, groupKey ?? null),

    async commitPlan({ planId }) {
      // Plans can sit on screen for minutes; re-read heads and CI just before writing.
      await app.sync.refresh(app.planner.targets(planId));
      return { commandIds: app.planner.commit(planId) };
    },

    cancelCommands: ({ commandIds }) => ({ cancelled: app.outbox.cancel(commandIds) }),

    markDone({ keys }) {
      for (const key of keys) {
        const cursor = app.views.cursorFor(key);
        if (cursor !== null) app.done.mark(key, cursor);
      }
      app.events.emit(["inbox", "counts", "flight"]);
      return { commandIds: app.clearNotifications(keys.flatMap((key) => app.views.prIdsFor(key))) };
    },

    undoDone({ keys }) {
      for (const key of keys) app.done.undo(key);
      app.events.emit(["inbox", "counts", "flight"]);
      return { ok: true };
    },

    logEscape({ url, reason }) {
      app.stores.state
        .query("INSERT INTO escape_log (url, reason, at) VALUES (?, ?, ?)")
        .run(url, reason, new Date().toISOString());
      return { ok: true };
    },
  };
}
