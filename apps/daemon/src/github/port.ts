import type {
  Annotation,
  CheckLog,
  ChecksView,
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
  Subscription,
  SuggestedReviewer,
} from "@pier/core/wire";

import type { RateWindow } from "./client";
import type { PrDetail } from "./pr-detail";
import type { PrDoc, PrState, PrViewer, VolatileState } from "./pr-doc";

// The only way the rest of the daemon talks to GitHub, one instance per account.
// `LiveGitHub` implements it over HTTP; the stateful fake implements it in memory for tests.

export type MetadataField = "labels" | "assignees" | "reviewers";

/** A PR by node id and by number: GraphQL takes the first, REST the second. */
export type PrRef = { id: string; repo: string; number: number };

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
  canMergeAsAdmin: boolean;
  mergeQueueEnabled: boolean;
};

export type MergeResult = {
  status: "merged" | "enqueued" | "pending" | "failed";
  message: string;
  uuid: string | null;
};

export type CommitFilesInput = {
  repo: string;
  branch: string;
  expectedHeadOid: string;
  headline: string;
  body: string;
  /** Each file's whole new contents. */
  files: { path: string; contents: string }[];
};

export type BranchHead = { oid: string; parents: string[]; message: string };

export interface GitHubPort {
  readonly login: string;
  viewer(): Promise<{ login: string; avatarUrl: string }>;
  /** A PR's node id from its number, or null when this account can't see it. */
  prId(repo: string, number: number): Promise<string | null>;
  /** Every PR matching the query, splitting by creation date past GitHub's 1,000-result cap. */
  search(query: string): Promise<SearchHit[]>;
  /** Just the first matches, for a one-off search rather than a scope to keep in sync. */
  searchFirst(query: string, limit: number): Promise<SearchHit[]>;
  sweep(ids: string[]): Promise<VolatileState[]>;
  hydrate(ids: string[]): Promise<{ doc: PrDoc; viewer: PrViewer }[]>;
  files(repo: string, number: number): Promise<DiffFile[]>;
  /** `fresh` skips the 304 shortcut, to learn every thread after a restart. */
  notifications(fresh?: boolean): Promise<NotificationPoll>;
  markNotificationDone(threadId: string): Promise<void>;
  markNotificationRead(threadId: string): Promise<void>;
  /** Through the account's notification thread for the PR when it has one, else directly. */
  setSubscription(prId: string, state: Subscription, threadId: string | null): Promise<void>;
  approve(prId: string, commitOid: string, body?: string): Promise<ReviewSummary>;
  comment(subjectId: string, body: string): Promise<{ id: string }>;
  reviewsBy(prId: string, author: string): Promise<ReviewSummary[]>;
  /** Threads, reviews, conversation and history for one PR, as this account sees it. */
  detail(prId: string): Promise<PrDetail | null>;
  /** The merge base of `head` with `base` (a branch or commit), via the compare API. */
  mergeBase(repo: string, base: string, head: string): Promise<string | null>;
  /** A commit's first parent. */
  commitParent(repo: string, oid: string): Promise<string | null>;
  /** Per-file diffs between two commits, for commit-range views without the git store. */
  compareFiles(repo: string, base: string, head: string): Promise<DiffFile[]>;
  /** Commits whole files onto a branch, only if it still points at `expectedHeadOid`. */
  commitFiles(input: CommitFilesInput): Promise<{ oid: string }>;
  /** A branch's latest commit, to check whether a commit we sent landed. */
  branchHead(repo: string, branch: string): Promise<BranchHead | null>;
  /** The CODEOWNERS file on a branch, from the first of GitHub's three places that has one. */
  codeOwners(repo: string, ref: string): Promise<string | null>;
  /** The teams this account is in, as "org/slug". */
  teams(): Promise<string[]>;
  /** The whole PR as one diff, or as patches per commit, the way github.com's .diff/.patch are. */
  rawDiff(repo: string, number: number, format: "diff" | "patch"): Promise<string>;
  /** A file's bytes at a commit (up to GitHub's 1 MB contents limit), or null. */
  fileBytes(repo: string, oid: string, path: string): Promise<Uint8Array | null>;
  /** A file's contents at a commit, or null if it doesn't exist there (or is binary). */
  fileText(repo: string, oid: string, path: string): Promise<string | null>;
  submitReview(input: SubmitReviewInput): Promise<ReviewSummary>;
  reply(threadId: string, body: string): Promise<{ id: string }>;
  setResolved(threadId: string, resolved: boolean): Promise<void>;
  setViewed(prId: string, path: string, viewed: boolean): Promise<void>;
  /** Recent conversation and thread comments, for checking whether an interrupted post landed. */
  recentComments(prId: string): Promise<{ id: string; body: string; author: string | null }[]>;
  /** Everything CI reports on a commit: check runs, commit statuses, workflow runs, deployments. */
  checks(repo: string, oid: string): Promise<ChecksView>;
  /** What these check runs left on the code. */
  annotations(repo: string, runs: { id: number; name: string }[]): Promise<Annotation[]>;
  /** An Actions job's steps and log. */
  jobLog(repo: string, jobId: number): Promise<CheckLog | null>;
  rerunFailedJobs(repo: string, runId: number, debug: boolean): Promise<void>;
  rerunRun(repo: string, runId: number, debug: boolean): Promise<void>;
  rerunJob(repo: string, jobId: number, debug: boolean): Promise<void>;
  cancelRun(repo: string, runId: number): Promise<void>;
  /** Lets a workflow run from a first-time or fork contributor go ahead. */
  approveRun(repo: string, runId: number): Promise<void>;
  /** Approves a run's deployment to these environments. */
  approveDeployment(repo: string, runId: number, environmentIds: number[]): Promise<void>;
  mergeInfo(prId: string): Promise<MergeInfo | null>;
  /** Merges through the async merge API (the only one that handles stacks and queues). */
  merge(
    repo: string,
    number: number,
    input: {
      sha: string;
      method: MergeMethod;
      title?: string;
      message?: string;
      /** Straight to the base (past any queue, and past rules an admin may bypass), or into the queue. */
      action?: "direct_merge" | "merge_queue";
    },
  ): Promise<MergeResult>;
  enqueue(prId: string, headOid: string, jump: boolean): Promise<void>;
  dequeue(prId: string): Promise<void>;
  deleteBranch(repo: string, branch: string): Promise<void>;
  restoreBranch(repo: string, branch: string, sha: string): Promise<void>;
  /** Opens a PR that reverts this merged one. */
  revert(prId: string, title?: string, body?: string): Promise<{ number: number; url: string }>;
  mergeStatus(repo: string, number: number, uuid: string): Promise<MergeResult>;
  setAutoMerge(prId: string, method: MergeMethod | null, headOid: string): Promise<void>;
  updateBranch(prId: string, rebase: boolean, headOid: string): Promise<void>;
  /**
   * Adds and removes by name: label names, or logins for assignees and reviewers. Reviewers
   * can also be teams ("org/slug") or bots ("bot:copilot-pull-request-reviewer").
   */
  editMetadata(
    pr: PrRef,
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
  suggestedReviewers(prId: string): Promise<SuggestedReviewer[]>;
  /** Every version of a comment, review or description, newest first. */
  history(subjectId: string): Promise<Revision[]>;
  /** When a GitHub release was published, or null if the tag has no release. */
  releaseDate(repo: string, tag: string): Promise<string | null>;
  rates(): { graphql: RateWindow | null; core: RateWindow | null };
}
