import type { App } from "@/app";
import { searchGitHub } from "@/domain/remote-search";
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
    prDiff: ({ repo, number, ignoreWhitespace, ...view }) =>
      app.review.diff(repo, number, view, ignoreWhitespace ?? false),
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
    checks: ({ repo, number }) => app.review.checks(repo, number),
    checkLog: ({ repo, jobId }) => app.review.checkLog(repo, jobId),
    rerunFailed: ({ prIds, debug }) => app.review.rerunFailed(prIds, debug ?? false),
    annotations: ({ repo, number }) => app.review.annotations(repo, number),
    runAction: ({ prId, action, runId, jobId, environmentIds, debug }) => ({
      commandIds: app.review.runAction(prId, action, {
        ...(runId !== undefined ? { runId } : {}),
        ...(jobId !== undefined ? { jobId } : {}),
        ...(environmentIds !== undefined ? { environmentIds } : {}),
        ...(debug !== undefined ? { debug } : {}),
      }),
    }),
    runway: ({ repo, number }) => app.review.runway(repo, number),
    merge: ({ prId, method, headline, body, bypass }) => ({
      commandIds: app.review.merge(prId, method, headline, body, bypass ?? false),
    }),
    queue: ({ prId, action }) => ({ commandIds: app.review.queue(prId, action) }),
    branch: ({ prId, action }) => ({ commandIds: app.review.branch(prId, action) }),
    revert: ({ prId, title, body }) => ({ commandIds: app.review.revert(prId, title, body) }),
    commandResult: ({ commandId }) => app.outbox.result(commandId),
    setAutoMerge: ({ prId, enabled, method }) => ({
      commandIds: app.review.setAutoMerge(prId, enabled, method),
    }),
    updateBranch: ({ prId, rebase }) => ({ commandIds: app.review.updateBranch(prId, rebase) }),
    editMetadata: ({ prId, field, add, remove }) => ({
      commandIds: app.review.editMetadata(prId, field, add, remove),
    }),
    setMilestone: ({ prId, milestone }) => ({
      commandIds: app.review.setMilestone(prId, milestone),
    }),
    setDraft: ({ prId, draft }) => ({ commandIds: app.review.setDraft(prId, draft) }),
    setOpen: ({ prId, open }) => ({ commandIds: app.review.setOpen(prId, open) }),
    react: ({ prId, subjectId, content, on }) => ({
      commandIds: app.review.react(prId, subjectId, content, on),
    }),
    editWriting: ({ prId, subject, subjectId, body }) => ({
      commandIds: app.review.editWriting(prId, subject, subjectId, body),
    }),
    deleteComment: ({ prId, subject, subjectId }) => ({
      commandIds: app.review.deleteComment(prId, subject, subjectId),
    }),
    minimize: ({ prId, subjectId, reason }) => ({
      commandIds: app.review.minimize(prId, subjectId, reason),
    }),
    editPr: ({ prId, title, base }) => ({
      commandIds: app.review.editPr(prId, {
        ...(title !== undefined ? { title } : {}),
        ...(base !== undefined ? { base } : {}),
      }),
    }),
    dismissReview: ({ prId, reviewId, message }) => ({
      commandIds: app.review.dismissReview(prId, reviewId, message),
    }),
    setLocked: ({ prId, reason }) => ({ commandIds: app.review.setLocked(prId, reason) }),
    branches: ({ repo }) => app.review.branches(repo),
    history: ({ prId, subjectId }) => app.review.history(prId, subjectId),
    suggestedReviewers: ({ prId }) => app.review.suggestedReviewers(prId),
    repoLabels: ({ repo }) => app.review.repoLabels(repo),
    assignable: ({ repo }) => app.review.assignable(repo),
    milestones: ({ repo }) => app.review.milestones(repo),
    flight: () => app.views.flight(),
    log: ({ limit }) => app.outbox.log(limit ?? 100),
    search: ({ q, limit }) => app.views.search(q, limit),
    fileContents: (input) => app.review.fileContents(input),
    fileBytes: (input) => app.review.fileBytes(input),
    fileDiff: (input) => app.review.fileDiff(input),
    views: () => app.views.savedViews(),
    setSubscription({ prId, subscription }) {
      const commandIds = app.review.setSubscription(prId, subscription);
      app.events.emit(["pr"]);
      return { commandIds };
    },
    searchGitHub: ({ q }) => searchGitHub(q, app.ports, app.model),
    saveView({ id, name, query }) {
      const views = app.settings.get("views");
      const existing = views.find((v) => v.id === id);
      const saved = existing
        ? { ...existing, name, query }
        : {
            id: uniqueSlug(
              name,
              views.map((v) => v.id),
            ),
            name,
            query,
          };
      app.settings.set(
        "views",
        existing ? views.map((v) => (v === existing ? saved : v)) : [...views, saved],
      );
      app.events.emit(["views"]);
      return { id: saved.id };
    },
    deleteView({ id }) {
      app.settings.set(
        "views",
        app.settings.get("views").filter((v) => v.id !== id),
      );
      app.events.emit(["views"]);
      return { ok: true as const };
    },
    async applySuggestions(input) {
      const commandIds = await app.review.applySuggestions(input);
      app.events.emit(["pr", "log"]);
      return { commandIds };
    },
    seenLog() {
      app.settings.set("logSeenAt", new Date().toISOString());
      app.events.emit(["status"]);
      return { ok: true as const };
    },

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

/** "Waiting on QA" -> "waiting-on-qa", with a number added when that's taken. */
function uniqueSlug(name: string, taken: string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "view";
  let slug = base;
  for (let n = 2; taken.includes(slug); n++) slug = `${base}-${n}`;
  return slug;
}
