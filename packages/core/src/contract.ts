import { type } from "arktype";

import type {
  Annotation,
  AppStatus,
  CheckLog,
  ChecksView,
  FlightItem,
  GroupView,
  Label,
  LogEntry,
  OutboxState,
  Milestone,
  Person,
  PlanPreview,
  PrDiff,
  PrView,
  QueueItem,
  Revision,
  SuggestedReviewer,
  RemoteSearch,
  Runway,
  SavedView,
  SearchResult,
  SplitCounts,
} from "./wire";

// The RPC surface between the web app and the daemon. Each procedure is `POST /api/rpc/:name`
// with a JSON body validated by the schema below, answered with `Outputs[name]`.

const split = "'review' | 'deps' | 'mine'";

export const inputs = {
  status: type({}),
  inbox: type({ split }),
  counts: type({}),
  group: type({ key: "string" }),
  pr: type({ repo: "string", number: "number.integer > 0" }),
  prDiff: type({
    repo: "string",
    number: "number.integer > 0",
    "ignoreWhitespace?": "boolean",
  }).and(
    type({ range: "'all' | 'since-review'" }).or({
      range: "'commits'",
      from: "string",
      to: "string",
    }),
  ),
  saveDraft: type({
    "id?": "string",
    prId: "string",
    path: "string",
    side: "'LEFT' | 'RIGHT'",
    /** Null for a comment on the whole file. */
    line: "number.integer > 0 | null",
    "startLine?": "number.integer > 0 | null",
    body: "string > 0",
  }),
  deleteDraft: type({ id: "string" }),
  submitReview: type({
    prId: "string",
    event: "'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'",
    body: "string",
  }),
  reply: type({ prId: "string", threadId: "string", body: "string > 0" }),
  resolveThread: type({ prId: "string", threadId: "string", resolved: "boolean" }),
  setViewed: type({ prId: "string", path: "string", viewed: "boolean" }),
  comment: type({ prId: "string", body: "string > 0" }),
  checks: type({ repo: "string", number: "number.integer > 0" }),
  checkLog: type({ repo: "string", jobId: "number.integer > 0" }),
  rerunFailed: type({ prIds: "string[] > 0", "debug?": "boolean" }),
  annotations: type({ repo: "string", number: "number.integer > 0" }),
  runAction: type({
    prId: "string",
    action: "'rerun-all' | 'rerun-job' | 'cancel-run' | 'approve-run' | 'approve-deployment'",
    "runId?": "number.integer > 0",
    "jobId?": "number.integer > 0",
    "environmentIds?": "number.integer[]",
    "debug?": "boolean",
  }),
  runway: type({ repo: "string", number: "number.integer > 0" }),
  merge: type({
    prId: "string",
    method: "'MERGE' | 'SQUASH' | 'REBASE'",
    "headline?": "string",
    "body?": "string",
    /** Merge past the rules as an admin; the UI asks for the repo's name first. */
    "bypass?": "boolean",
  }),
  queue: type({ prId: "string", action: "'add' | 'jump' | 'remove'" }),
  branch: type({ prId: "string", action: "'delete' | 'restore'" }),
  revert: type({ prId: "string", "title?": "string > 0", "body?": "string" }),
  commandResult: type({ commandId: "string" }),
  setAutoMerge: type({
    prId: "string",
    enabled: "boolean",
    "method?": "'MERGE' | 'SQUASH' | 'REBASE'",
  }),
  updateBranch: type({ prId: "string", rebase: "boolean" }),
  editMetadata: type({
    prId: "string",
    field: "'labels' | 'assignees' | 'reviewers'",
    add: "string[]",
    remove: "string[]",
  }),
  setMilestone: type({ prId: "string", milestone: "number.integer > 0 | null" }),
  setDraft: type({ prId: "string", draft: "boolean" }),
  setOpen: type({ prId: "string", open: "boolean" }),
  react: type({
    prId: "string",
    subjectId: "string",
    content:
      "'THUMBS_UP' | 'THUMBS_DOWN' | 'LAUGH' | 'HOORAY' | 'CONFUSED' | 'HEART' | 'ROCKET' | 'EYES'",
    on: "boolean",
  }),
  editWriting: type({
    prId: "string",
    subject: "'issue-comment' | 'review-comment' | 'review' | 'pull-request'",
    subjectId: "string",
    body: "string",
  }),
  deleteComment: type({
    prId: "string",
    subject: "'issue-comment' | 'review-comment'",
    subjectId: "string",
  }),
  minimize: type({
    prId: "string",
    subjectId: "string",
    reason:
      "'SPAM' | 'ABUSE' | 'OFF_TOPIC' | 'OUTDATED' | 'DUPLICATE' | 'RESOLVED' | 'LOW_QUALITY' | null",
  }),
  editPr: type({ prId: "string", "title?": "string > 0", "base?": "string > 0" }),
  dismissReview: type({ prId: "string", reviewId: "string", message: "string > 0" }),
  setLocked: type({
    prId: "string",
    reason: "'off-topic' | 'too heated' | 'resolved' | 'spam' | null",
  }),
  branches: type({ repo: "string" }),
  history: type({ prId: "string", subjectId: "string" }),
  suggestedReviewers: type({ prId: "string" }),
  repoLabels: type({ repo: "string" }),
  assignable: type({ repo: "string" }),
  milestones: type({ repo: "string" }),
  flight: type({}),
  log: type({ "limit?": "1 <= number.integer <= 500" }),
  search: type({ q: "string", "limit?": "0 <= number.integer <= 1000" }),
  /** The same search, asked of GitHub (for PRs pier doesn't track). */
  searchGitHub: type({ q: "string > 0" }),
  views: type({}),
  /** Saves a search as a view; an `id` updates that view. */
  saveView: type({ "id?": "string", name: "string > 0", query: "string" }),
  deleteView: type({ id: "string" }),
  setSubscription: type({
    prId: "string",
    subscription: "'SUBSCRIBED' | 'UNSUBSCRIBED' | 'IGNORED'",
  }),
  /** Commits the suggestions in these review comments to the PR's branch, in one commit. */
  applySuggestions: type({
    prId: "string",
    /** The head you saw them against; anything newer is refused. */
    headOid: "string",
    commentIds: "string[] > 0",
    headline: "string > 0",
    body: "string",
  }),
  /** The Log was looked at, so its failures stop showing in the status line. */
  seenLog: type({}),
  planAction: type({
    action: "'approve' | 'rebase' | 'recreate'",
    prIds: "string[] > 0",
    "groupKey?": "string",
  }),
  commitPlan: type({ planId: "string" }),
  cancelCommands: type({ commandIds: "string[] > 0" }),
  markDone: type({ keys: "string[] > 0" }),
  undoDone: type({ keys: "string[] > 0" }),
  logEscape: type({ url: "string", reason: "string" }),
} as const;

export type Outputs = {
  status: AppStatus;
  inbox: QueueItem[];
  counts: SplitCounts;
  group: GroupView | null;
  pr: PrView | null;
  prDiff: PrDiff | null;
  saveDraft: { id: string };
  deleteDraft: { ok: true };
  submitReview: { commandIds: string[] };
  reply: { commandIds: string[] };
  resolveThread: { commandIds: string[] };
  setViewed: { commandIds: string[] };
  comment: { commandIds: string[] };
  checks: ChecksView;
  checkLog: CheckLog | null;
  rerunFailed: { commandIds: string[]; runs: number };
  annotations: Annotation[];
  runAction: { commandIds: string[] };
  runway: Runway | null;
  merge: { commandIds: string[] };
  queue: { commandIds: string[] };
  branch: { commandIds: string[] };
  revert: { commandIds: string[] };
  /** How a write went, and what GitHub answered (a revert's new PR, for one). */
  commandResult: { state: OutboxState; detail: string | null; result: unknown } | null;
  setAutoMerge: { commandIds: string[] };
  updateBranch: { commandIds: string[] };
  editMetadata: { commandIds: string[] };
  setMilestone: { commandIds: string[] };
  setDraft: { commandIds: string[] };
  setOpen: { commandIds: string[] };
  react: { commandIds: string[] };
  editWriting: { commandIds: string[] };
  deleteComment: { commandIds: string[] };
  minimize: { commandIds: string[] };
  editPr: { commandIds: string[] };
  dismissReview: { commandIds: string[] };
  setLocked: { commandIds: string[] };
  branches: string[];
  history: Revision[];
  suggestedReviewers: SuggestedReviewer[];
  repoLabels: Label[];
  assignable: Person[];
  milestones: Milestone[];
  flight: FlightItem[];
  log: LogEntry[];
  seenLog: { ok: true };
  applySuggestions: { commandIds: string[] };
  search: SearchResult;
  views: SavedView[];
  searchGitHub: RemoteSearch;
  saveView: { id: string };
  deleteView: { ok: true };
  setSubscription: { commandIds: string[] };
  planAction: PlanPreview;
  commitPlan: { commandIds: string[] };
  cancelCommands: { cancelled: number };
  markDone: { commandIds: string[] };
  undoDone: { ok: true };
  logEscape: { ok: true };
};

export type ProcedureName = keyof typeof inputs;

/** What a caller sends. */
export type Input<N extends ProcedureName> = (typeof inputs)[N]["inferIn"];

/** What a handler receives after validation. */
export type ParsedInput<N extends ProcedureName> = (typeof inputs)[N]["infer"];

export type Output<N extends ProcedureName> = Outputs[N];

// Compile-time guard: every procedure has exactly one input schema and one output type.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const contractIsComplete: Same<keyof Outputs, ProcedureName> = true;
void contractIsComplete;

/**
 * Topics pushed over the SSE stream. Each names the procedure whose queries are now stale,
 * so the web app can invalidate exactly those.
 */
export type Topic = ProcedureName;

export type ServerEvent =
  | { type: "changed"; topics: Topic[] }
  | { type: "hello"; version: string }
  /** Sent every few seconds so the client can tell a silent dead connection from a quiet one. */
  | { type: "ping" };

export const API_HEADER = "x-pier";
