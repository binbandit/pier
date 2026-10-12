import { type } from "arktype";

import type {
  AppStatus,
  FlightItem,
  GroupView,
  LogEntry,
  PlanPreview,
  PrView,
  QueueItem,
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
  flight: FlightItem[];
  log: LogEntry[];
  planAction: PlanPreview;
  commitPlan: { commandIds: string[] };
  cancelCommands: { cancelled: number };
  markDone: { ok: true };
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
