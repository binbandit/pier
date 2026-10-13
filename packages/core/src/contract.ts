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
  Milestone,
  Person,
  PlanPreview,
  PrDiff,
  PrView,
  QueueItem,
  Revision,
  SuggestedReviewer,
  Runway,
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
    range: "'all' | 'since-review'",
    "ignoreWhitespace?": "boolean",
  }),
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
  }),
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
