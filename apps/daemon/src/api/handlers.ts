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
    pr: ({ repo, number }) => app.prView(repo, number),
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
      return { ok: true };
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
