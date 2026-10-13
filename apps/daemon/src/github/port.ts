import type {
  CheckLog,
  CheckRunView,
  CommentSubject,
  DiffFile,
  Label,
  LockReason,
  MergeMethod,
  Milestone,
  MinimizeReason,
  Person,
  ReactionContent,
  Revision,
} from "@pier/core/wire";

import type { RateWindow } from "./client";
import type { PrDetail } from "./pr-detail";
import type { PrDoc, PrState, PrViewer, VolatileState } from "./pr-doc";

// The only way the rest of the daemon talks to GitHub, one instance per account.
// `LiveGitHub` implements it over HTTP; the stateful fake implements it in memory for tests.

export type MetadataField = "labels" | "assignees" | "reviewers";

export type SearchHit = { id: string; updatedAt: string; headRefOid: string; state: PrState };

export type NotificationThread = {
  id: string;
  reason: string;
  unread: boolean;
  updatedAt: string;
  repo: string;
  /** The PR or issue number, when the subject has one. */
  number: number | null;
  type: string;
};

export type NotificationPoll =
  | { changed: false; pollIntervalSec: number }
  | { changed: true; pollIntervalSec: number; threads: NotificationThread[] };

export type ReviewSummary = {
  id: string;
  state: string;
  commitOid: string | null;
  submittedAt: string | null;
};

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

/** A new thread in a review: on a line (or range), or on the whole file. */
export type DraftThreadInput =
  | {
      subject: "line";
      path: string;
      line: number;
      side: "LEFT" | "RIGHT";
      startLine?: number;
      startSide?: "LEFT" | "RIGHT";
      body: string;
    }
  | { subject: "file"; path: string; body: string };

/**
 * A review to submit. If you already have a pending review on the PR (say, started on
 * github.com), the threads are added to it and it's submitted, rather than starting another.
 */
export type SubmitReviewInput = {
  prId: string;
  commitOid: string;
  event: ReviewEvent;
  body: string;
  threads: DraftThreadInput[];
};

/** The merge-relevant state of a PR and its repo, as the reading account sees it. */
export type MergeInfo = {
  isDraft: boolean;
  mergeable: string;
  mergeStateStatus: string;
  reviewDecision: string | null;
  canUpdateBranch: boolean;
  canEnableAutoMerge: boolean;
  autoMerge: { method: MergeMethod } | null;
  mergeQueue: { position: number; state: string } | null;
  messages: Partial<Record<MergeMethod, { headline: string; body: string }>>;
  methods: MergeMethod[];
  defaultMethod: MergeMethod;
  autoMergeAllowed: boolean;
};

export type MergeResult = {
  status: "merged" | "enqueued" | "pending" | "failed";
  message: string;
  uuid: string | null;
};

export interface GitHubPort {
  readonly login: string;
  viewer(): Promise<{ login: string; avatarUrl: string }>;
  /** Every PR matching the query, splitting by creation date past GitHub's 1,000-result cap. */
  search(query: string): Promise<SearchHit[]>;
  sweep(ids: string[]): Promise<VolatileState[]>;
  hydrate(ids: string[]): Promise<{ doc: PrDoc; viewer: PrViewer }[]>;
  files(repo: string, number: number): Promise<DiffFile[]>;
  /** `fresh` skips the 304 shortcut, to learn every thread after a restart. */
  notifications(fresh?: boolean): Promise<NotificationPoll>;
  markNotificationDone(threadId: string): Promise<void>;
  approve(prId: string, commitOid: string, body?: string): Promise<ReviewSummary>;
  comment(subjectId: string, body: string): Promise<{ id: string }>;
  reviewsBy(prId: string, author: string): Promise<ReviewSummary[]>;
  /** Threads, reviews, conversation and history for one PR, as this account sees it. */
  detail(prId: string): Promise<PrDetail | null>;
  /** The merge base of `head` with `base` (a branch or commit), via the compare API. */
  mergeBase(repo: string, base: string, head: string): Promise<string | null>;
  /** A file's contents at a commit, or null if it doesn't exist there (or is binary). */
  fileText(repo: string, oid: string, path: string): Promise<string | null>;
  submitReview(input: SubmitReviewInput): Promise<ReviewSummary>;
  reply(threadId: string, body: string): Promise<{ id: string }>;
  setResolved(threadId: string, resolved: boolean): Promise<void>;
  setViewed(prId: string, path: string, viewed: boolean): Promise<void>;
  /** Recent conversation and thread comments, for checking whether an interrupted post landed. */
  recentComments(prId: string): Promise<{ id: string; body: string; author: string | null }[]>;
  /** Check runs on a commit, with their Actions job and run ids where they have them. */
  checkRuns(repo: string, oid: string): Promise<CheckRunView[]>;
  /** The tail of an Actions job's log. */
  jobLog(repo: string, jobId: number): Promise<CheckLog | null>;
  rerunFailedJobs(repo: string, runId: number): Promise<void>;
  mergeInfo(prId: string): Promise<MergeInfo | null>;
  /** Merges through the async merge API (the only one that handles stacks and queues). */
  merge(
    repo: string,
    number: number,
    input: { sha: string; method: MergeMethod; title?: string; message?: string },
  ): Promise<MergeResult>;
  mergeStatus(repo: string, number: number, uuid: string): Promise<MergeResult>;
  setAutoMerge(prId: string, method: MergeMethod | null, headOid: string): Promise<void>;
  updateBranch(prId: string, rebase: boolean, headOid: string): Promise<void>;
  /** Adds and removes by name: label names, or user logins for assignees and reviewers. */
  editMetadata(
    repo: string,
    number: number,
    field: MetadataField,
    change: { add: string[]; remove: string[] },
  ): Promise<void>;
  setMilestone(repo: string, number: number, milestone: number | null): Promise<void>;
  setDraft(prId: string, draft: boolean): Promise<void>;
  setOpen(prId: string, open: boolean): Promise<void>;
  repoLabels(repo: string): Promise<Label[]>;
  /** Who can be assigned, which is also who can be asked to review. */
  assignable(repo: string): Promise<Person[]>;
  milestones(repo: string): Promise<Milestone[]>;
  /** Adds (on) or removes your reaction on a comment, review or PR description. */
  react(subjectId: string, content: ReactionContent, on: boolean): Promise<void>;
  /** Rewrites a comment, a review's summary or the PR description. */
  editWriting(subject: CommentSubject, id: string, body: string): Promise<void>;
  deleteComment(subject: "issue-comment" | "review-comment", id: string): Promise<void>;
  /** Hides a comment for a reason, or shows it again (null). */
  minimize(id: string, reason: MinimizeReason | null): Promise<void>;
  editPr(prId: string, change: { title?: string; body?: string; base?: string }): Promise<void>;
  dismissReview(reviewId: string, message: string): Promise<void>;
  setLocked(repo: string, number: number, reason: LockReason | null): Promise<void>;
  branches(repo: string): Promise<string[]>;
  /** Every version of a comment, review or description, newest first. */
  history(subjectId: string): Promise<Revision[]>;
  /** When a GitHub release was published, or null if the tag has no release. */
  releaseDate(repo: string, tag: string): Promise<string | null>;
  rates(): { graphql: RateWindow | null; core: RateWindow | null };
}
