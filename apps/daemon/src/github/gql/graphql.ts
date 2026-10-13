/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { DocumentTypeDecoration } from '@graphql-typed-document-node/core';
/** The possible states for a check suite or run conclusion. */
export type CheckConclusionState =
  /** The check suite or run requires action. */
  | 'ACTION_REQUIRED'
  /** The check suite or run has been cancelled. */
  | 'CANCELLED'
  /** The check suite or run has failed. */
  | 'FAILURE'
  /** The check suite or run was neutral. */
  | 'NEUTRAL'
  /** The check suite or run was skipped. */
  | 'SKIPPED'
  /** The check suite or run was marked stale by GitHub. Only GitHub can use this conclusion. */
  | 'STALE'
  /** The check suite or run has failed at startup. */
  | 'STARTUP_FAILURE'
  /** The check suite or run has succeeded. */
  | 'SUCCESS'
  /** The check suite or run has timed out. */
  | 'TIMED_OUT';

/** The possible states for a check suite or run status. */
export type CheckStatusState =
  /** The check suite or run has been completed. */
  | 'COMPLETED'
  /** The check suite or run is in progress. */
  | 'IN_PROGRESS'
  /** The check suite or run is in pending state. */
  | 'PENDING'
  /** The check suite or run has been queued. */
  | 'QUEUED'
  /** The check suite or run has been requested. */
  | 'REQUESTED'
  /** The check suite or run is in waiting state. */
  | 'WAITING';

/** The possible sides of a diff. */
export type DiffSide =
  /** The left side of the diff. */
  | 'LEFT'
  /** The right side of the diff. */
  | 'RIGHT';

/** Specifies a review comment thread to be left with a Pull Request Review. */
export type DraftPullRequestReviewThread = {
  /** Body of the comment to leave. */
  body: string;
  /**
   * The line of the blob to which the thread refers. The end of the line range for
   * multi-line comments. Required if not using positioning.
   */
  line?: number | null | undefined;
  /** Path to the file being commented on. Required if not using positioning. */
  path?: string | null | undefined;
  /** The side of the diff on which the line resides. For multi-line comments, this is the side for the end of the line range. */
  side?: DiffSide | null | undefined;
  /** The first line of the range to which the comment refers. */
  startLine?: number | null | undefined;
  /** The side of the diff on which the start line resides. */
  startSide?: DiffSide | null | undefined;
};

/** The possible viewed states of a file . */
export type FileViewedState =
  /** The file has new changes since last viewed. */
  | 'DISMISSED'
  /** The file has not been marked as viewed. */
  | 'UNVIEWED'
  /** The file has been marked as viewed. */
  | 'VIEWED';

/** The possible states for a merge queue entry. */
export type MergeQueueEntryState =
  /** The entry is currently waiting for checks to pass. */
  | 'AWAITING_CHECKS'
  /** The entry is currently locked. */
  | 'LOCKED'
  /** The entry is currently mergeable. */
  | 'MERGEABLE'
  /** The entry is currently queued. */
  | 'QUEUED'
  /** The entry is currently unmergeable. */
  | 'UNMERGEABLE';

/** Detailed status information about a pull request merge. */
export type MergeStateStatus =
  /** The head ref is out of date. */
  | 'BEHIND'
  /** The merge is blocked. */
  | 'BLOCKED'
  /** Mergeable and passing commit status. */
  | 'CLEAN'
  /** The merge commit cannot be cleanly created. */
  | 'DIRTY'
  /** The merge is blocked due to the pull request being a draft. */
  | 'DRAFT'
  /** Mergeable with passing commit status and pre-receive hooks. */
  | 'HAS_HOOKS'
  /** The state cannot currently be determined. */
  | 'UNKNOWN'
  /** Mergeable with non-passing commit status. */
  | 'UNSTABLE';

/** Whether or not a PullRequest can be merged. */
export type MergeableState =
  /** The pull request cannot be merged due to merge conflicts. */
  | 'CONFLICTING'
  /** The pull request can be merged. */
  | 'MERGEABLE'
  /** The mergeability of the pull request is still being calculated. */
  | 'UNKNOWN';

/** The possible types of patch statuses. */
export type PatchStatus =
  /** The file was added. Git status 'A'. */
  | 'ADDED'
  /** The file's type was changed. Git status 'T'. */
  | 'CHANGED'
  /** The file was copied. Git status 'C'. */
  | 'COPIED'
  /** The file was deleted. Git status 'D'. */
  | 'DELETED'
  /** The file's contents were changed. Git status 'M'. */
  | 'MODIFIED'
  /** The file was renamed. Git status 'R'. */
  | 'RENAMED';

/** The possible methods for updating a pull request's head branch with the base branch. */
export type PullRequestBranchUpdateMethod =
  /** Update branch via merge */
  | 'MERGE'
  /** Update branch via rebase */
  | 'REBASE';

/** Represents available types of methods to use when merging a pull request. */
export type PullRequestMergeMethod =
  /** Add all commits from the head branch to the base branch with a merge commit. */
  | 'MERGE'
  /** Add all commits from the head branch onto the base branch individually. */
  | 'REBASE'
  /** Combine all commits from the head branch into a single commit in the base branch. */
  | 'SQUASH';

/** The possible states of a pull request review comment. */
export type PullRequestReviewCommentState =
  /** A comment that is part of a pending review */
  | 'PENDING'
  /** A comment that is part of a submitted review */
  | 'SUBMITTED';

/** The review status of a pull request. */
export type PullRequestReviewDecision =
  /** The pull request has received an approving review. */
  | 'APPROVED'
  /** Changes have been requested on the pull request. */
  | 'CHANGES_REQUESTED'
  /** A review is required before the pull request can be merged. */
  | 'REVIEW_REQUIRED';

/** The possible events to perform on a pull request review. */
export type PullRequestReviewEvent =
  /** Submit feedback and approve merging these changes. */
  | 'APPROVE'
  /** Submit general feedback without explicit approval. */
  | 'COMMENT'
  /** Dismiss review so it now longer effects merging. */
  | 'DISMISS'
  /** Submit feedback that must be addressed before merging. */
  | 'REQUEST_CHANGES';

/** The possible states of a pull request review. */
export type PullRequestReviewState =
  /** A review allowing the pull request to merge. */
  | 'APPROVED'
  /** A review blocking the pull request from merging. */
  | 'CHANGES_REQUESTED'
  /** An informational review. */
  | 'COMMENTED'
  /** A review that has been dismissed. */
  | 'DISMISSED'
  /** A review that has not yet been submitted. */
  | 'PENDING';

/** The possible subject types of a pull request review comment. */
export type PullRequestReviewThreadSubjectType =
  /** A comment that has been made against the file of a pull request */
  | 'FILE'
  /** A comment that has been made against the line of a pull request */
  | 'LINE';

/** The possible states of a pull request. */
export type PullRequestState =
  /** A pull request that has been closed without being merged. */
  | 'CLOSED'
  /** A pull request that has been closed by being merged. */
  | 'MERGED'
  /** A pull request that is still open. */
  | 'OPEN';

/** The access level to a repository */
export type RepositoryPermission =
  /**
   * Can read, clone, and push to this repository. Can also manage issues, pull
   * requests, and repository settings, including adding collaborators
   */
  | 'ADMIN'
  /** Can read, clone, and push to this repository. They can also manage issues, pull requests, and some repository settings */
  | 'MAINTAIN'
  /** Can read and clone this repository. Can also open and comment on issues and pull requests */
  | 'READ'
  /** Can read and clone this repository. Can also manage issues and pull requests */
  | 'TRIAGE'
  /** Can read and clone this repository. Can also manage issues and pull requests, plus additional triage abilities */
  | 'TRIAGE_PLUS'
  /** Can read, clone, and push to this repository. Can also manage issues and pull requests */
  | 'WRITE';

/** The possible commit status states. */
export type StatusState =
  /** Status is errored. */
  | 'ERROR'
  /** Status is expected. */
  | 'EXPECTED'
  /** Status is failing. */
  | 'FAILURE'
  /** Status is pending. */
  | 'PENDING'
  /** Status is successful. */
  | 'SUCCESS';

export type ViewerQueryVariables = Exact<{ [key: string]: never; }>;


export type ViewerQuery = { viewer: { login: string, avatarUrl: string } };

export type SearchPullsQueryVariables = Exact<{
  query: string;
  after?: string | null | undefined;
}>;


export type SearchPullsQuery = { search: { issueCount: number, pageInfo: { hasNextPage: boolean, endCursor: string | null }, nodes: Array<
      | { id: string, updatedAt: string, headRefOid: string, state: PullRequestState }
      | Record<PropertyKey, never>
     | null> | null } };

export type SweepQueryVariables = Exact<{
  ids: Array<string | number> | string | number;
}>;


export type SweepQuery = { nodes: Array<
    | { id: string, state: PullRequestState, isDraft: boolean, updatedAt: string, headRefOid: string, mergeable: MergeableState, mergeStateStatus: MergeStateStatus, reviewDecision: PullRequestReviewDecision | null, autoMergeRequest: { enabledAt: string | null } | null, mergeQueueEntry: { position: number, state: MergeQueueEntryState } | null, commits: { nodes: Array<{ commit: { statusCheckRollup: { state: StatusState } | null } } | null> | null } }
    | Record<PropertyKey, never>
   | null> };

export type HydrateQueryVariables = Exact<{
  ids: Array<string | number> | string | number;
}>;


export type HydrateQuery = { nodes: Array<
    | { id: string, number: number, title: string, url: string, body: string, state: PullRequestState, isDraft: boolean, createdAt: string, updatedAt: string, baseRefName: string, headRefName: string, baseRefOid: string, headRefOid: string, additions: number, deletions: number, changedFiles: number, mergeable: MergeableState, mergeStateStatus: MergeStateStatus, reviewDecision: PullRequestReviewDecision | null, author:
        | { __typename: 'Bot', login: string, avatarUrl: string }
        | { __typename: 'EnterpriseUserAccount', login: string, avatarUrl: string }
        | { __typename: 'Mannequin', login: string, avatarUrl: string }
        | { __typename: 'Organization', login: string, avatarUrl: string }
        | { __typename: 'User', login: string, avatarUrl: string }
       | null, repository: { id: string, nameWithOwner: string, isPrivate: boolean, viewerPermission: RepositoryPermission | null }, autoMergeRequest: { enabledAt: string | null, mergeMethod: PullRequestMergeMethod } | null, mergeQueueEntry: { position: number, state: MergeQueueEntryState } | null, labels: { nodes: Array<{ name: string, color: string } | null> | null } | null, assignees: { nodes: Array<{ login: string, avatarUrl: string } | null> | null }, milestone: { number: number, title: string, dueOn: string | null } | null, files: { totalCount: number, nodes: Array<{ path: string, additions: number, deletions: number, changeType: PatchStatus } | null> | null } | null, commits: { totalCount: number, nodes: Array<{ commit: { oid: string, message: string, committedDate: string, author: { name: string | null, email: string | null, user: { login: string } | null } | null, signature:
              | { isValid: boolean }
              | { isValid: boolean }
              | { isValid: boolean }
              | { isValid: boolean }
             | null } } | null> | null }, lastCommit: { nodes: Array<{ commit: { statusCheckRollup: { state: StatusState, contexts: { totalCount: number, nodes: Array<
                  | { __typename: 'CheckRun', name: string, status: CheckStatusState, conclusion: CheckConclusionState | null }
                  | { __typename: 'StatusContext', context: string, state: StatusState }
                 | null> | null } } | null } } | null> | null }, reviewRequests: { nodes: Array<{ asCodeOwner: boolean, requestedReviewer:
            | { __typename: 'Bot', login: string }
            | { __typename: 'EnterpriseTeam' }
            | { __typename: 'Mannequin' }
            | { __typename: 'Team', slug: string, organization: { login: string } }
            | { __typename: 'User', login: string }
           | null } | null> | null } | null, viewerLatestReview: { state: PullRequestReviewState, submittedAt: string | null, commit: { oid: string } | null } | null, latestOpinionatedReviews: { nodes: Array<{ state: PullRequestReviewState, author:
            | { login: string }
            | { login: string }
            | { login: string }
            | { login: string }
            | { login: string }
           | null, commit: { oid: string } | null } | null> | null } | null }
    | Record<PropertyKey, never>
   | null> };

export type ApproveMutationVariables = Exact<{
  prId: string | number;
  commit: string;
  body?: string | null | undefined;
}>;


export type ApproveMutation = { addPullRequestReview: { pullRequestReview: { id: string, state: PullRequestReviewState, submittedAt: string | null, commit: { oid: string } | null } | null } | null };

export type CommentMutationVariables = Exact<{
  subjectId: string | number;
  body: string;
}>;


export type CommentMutation = { addComment: { commentEdge: { node: { id: string, createdAt: string } | null } | null } | null };

export type ReviewsByAuthorQueryVariables = Exact<{
  prId: string | number;
  author: string;
}>;


export type ReviewsByAuthorQuery = { node:
    | { reviews: { nodes: Array<{ id: string, state: PullRequestReviewState, submittedAt: string | null, commit: { oid: string } | null } | null> | null } | null }
    | Record<PropertyKey, never>
   | null };

export type RateLimitQueryVariables = Exact<{ [key: string]: never; }>;


export type RateLimitQuery = { rateLimit: { limit: number, remaining: number, used: number, resetAt: string } | null };

export type PrDetailQueryVariables = Exact<{
  id: string | number;
}>;


export type PrDetailQuery = { node:
    | { id: string, headRefOid: string, bodyHTML: string, viewerLatestReview: { state: PullRequestReviewState, submittedAt: string | null, commit: { oid: string } | null } | null, pendingReviews: { nodes: Array<{ id: string, commit: { oid: string } | null, comments: { nodes: Array<{ id: string, body: string, path: string, line: number | null, startLine: number | null, originalLine: number | null, diffHunk: string } | null> | null } } | null> | null } | null, reviewThreads: { nodes: Array<{ id: string, isResolved: boolean, isOutdated: boolean, path: string, line: number | null, startLine: number | null, originalLine: number | null, originalStartLine: number | null, diffSide: DiffSide, startDiffSide: DiffSide | null, subjectType: PullRequestReviewThreadSubjectType, viewerCanResolve: boolean, viewerCanUnresolve: boolean, viewerCanReply: boolean, resolvedBy: { login: string } | null, comments: { nodes: Array<{ id: string, body: string, bodyHTML: string, createdAt: string, lastEditedAt: string | null, diffHunk: string, state: PullRequestReviewCommentState, author:
                | { login: string, avatarUrl: string }
                | { login: string, avatarUrl: string }
                | { login: string, avatarUrl: string }
                | { login: string, avatarUrl: string }
                | { login: string, avatarUrl: string }
               | null, originalCommit: { oid: string } | null } | null> | null } } | null> | null }, reviews: { nodes: Array<{ id: string, state: PullRequestReviewState, bodyHTML: string, body: string, submittedAt: string | null, author:
            | { login: string, avatarUrl: string }
            | { login: string, avatarUrl: string }
            | { login: string, avatarUrl: string }
            | { login: string, avatarUrl: string }
            | { login: string, avatarUrl: string }
           | null, commit: { oid: string } | null } | null> | null } | null, comments: { nodes: Array<{ id: string, body: string, bodyHTML: string, createdAt: string, lastEditedAt: string | null, author:
            | { login: string, avatarUrl: string }
            | { login: string, avatarUrl: string }
            | { login: string, avatarUrl: string }
            | { login: string, avatarUrl: string }
            | { login: string, avatarUrl: string }
           | null } | null> | null }, allCommits: { totalCount: number, nodes: Array<{ commit: { oid: string, messageHeadline: string, committedDate: string, author: { name: string | null, user: { login: string } | null } | null, statusCheckRollup: { state: StatusState } | null } } | null> | null }, timelineItems: { nodes: Array<
          | { __typename: 'AddedToMergeQueueEvent' }
          | { __typename: 'AddedToProjectEvent' }
          | { __typename: 'AddedToProjectV2Event' }
          | { __typename: 'AddedToStackEvent' }
          | { __typename: 'AssignedEvent', createdAt: string, actor:
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
             | null, assignee:
              | { login: string }
              | Record<PropertyKey, never>
             | null }
          | { __typename: 'AutoMergeDisabledEvent' }
          | { __typename: 'AutoMergeEnabledEvent' }
          | { __typename: 'AutoRebaseEnabledEvent' }
          | { __typename: 'AutoSquashEnabledEvent' }
          | { __typename: 'AutomaticBaseChangeFailedEvent' }
          | { __typename: 'AutomaticBaseChangeSucceededEvent' }
          | { __typename: 'BaseRefChangedEvent' }
          | { __typename: 'BaseRefDeletedEvent' }
          | { __typename: 'BaseRefForcePushedEvent', createdAt: string, actor:
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
             | null }
          | { __typename: 'BlockedByAddedEvent' }
          | { __typename: 'BlockedByRemovedEvent' }
          | { __typename: 'BlockingAddedEvent' }
          | { __typename: 'BlockingRemovedEvent' }
          | { __typename: 'ClosedEvent', createdAt: string, actor:
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
             | null }
          | { __typename: 'CommentDeletedEvent' }
          | { __typename: 'ConnectedEvent' }
          | { __typename: 'ConvertToDraftEvent', createdAt: string, actor:
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
             | null }
          | { __typename: 'ConvertedFromDraftEvent' }
          | { __typename: 'ConvertedNoteToIssueEvent' }
          | { __typename: 'ConvertedToDiscussionEvent' }
          | { __typename: 'CrossReferencedEvent' }
          | { __typename: 'DemilestonedEvent', createdAt: string, milestoneTitle: string, actor:
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
             | null }
          | { __typename: 'DeployedEvent' }
          | { __typename: 'DeploymentEnvironmentChangedEvent' }
          | { __typename: 'DisconnectedEvent' }
          | { __typename: 'HeadRefDeletedEvent' }
          | { __typename: 'HeadRefForcePushedEvent', createdAt: string, actor:
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
             | null, beforeCommit: { oid: string } | null, afterCommit: { oid: string } | null }
          | { __typename: 'HeadRefRestoredEvent' }
          | { __typename: 'IssueComment' }
          | { __typename: 'IssueCommentPinnedEvent' }
          | { __typename: 'IssueCommentUnpinnedEvent' }
          | { __typename: 'IssueFieldAddedEvent' }
          | { __typename: 'IssueFieldChangedEvent' }
          | { __typename: 'IssueFieldRemovedEvent' }
          | { __typename: 'IssueTypeAddedEvent' }
          | { __typename: 'IssueTypeChangedEvent' }
          | { __typename: 'IssueTypeRemovedEvent' }
          | { __typename: 'LabeledEvent', createdAt: string, actor:
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
             | null, label: { name: string } }
          | { __typename: 'LockedEvent' }
          | { __typename: 'MarkedAsDuplicateEvent' }
          | { __typename: 'MentionedEvent' }
          | { __typename: 'MergedEvent', createdAt: string, actor:
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
             | null }
          | { __typename: 'MilestonedEvent', createdAt: string, milestoneTitle: string, actor:
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
             | null }
          | { __typename: 'MovedColumnsInProjectEvent' }
          | { __typename: 'ParentIssueAddedEvent' }
          | { __typename: 'ParentIssueRemovedEvent' }
          | { __typename: 'PinnedEvent' }
          | { __typename: 'ProjectV2ItemStatusChangedEvent' }
          | { __typename: 'PullRequestCommit' }
          | { __typename: 'PullRequestCommitCommentThread' }
          | { __typename: 'PullRequestReview' }
          | { __typename: 'PullRequestReviewThread' }
          | { __typename: 'PullRequestRevisionMarker' }
          | { __typename: 'ReadyForReviewEvent', createdAt: string, actor:
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
             | null }
          | { __typename: 'ReferencedEvent' }
          | { __typename: 'RemovedFromMergeQueueEvent' }
          | { __typename: 'RemovedFromProjectEvent' }
          | { __typename: 'RemovedFromProjectV2Event' }
          | { __typename: 'RemovedFromStackEvent' }
          | { __typename: 'RenamedTitleEvent', createdAt: string, previousTitle: string, currentTitle: string, actor:
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
             | null }
          | { __typename: 'ReopenedEvent', createdAt: string, actor:
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
             | null }
          | { __typename: 'ReviewDismissedEvent', createdAt: string, actor:
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
             | null }
          | { __typename: 'ReviewRequestRemovedEvent', createdAt: string, actor:
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
             | null, requestedReviewer:
              | { __typename: 'Bot' }
              | { __typename: 'EnterpriseTeam' }
              | { __typename: 'Mannequin' }
              | { __typename: 'Team', slug: string }
              | { __typename: 'User', login: string }
             | null }
          | { __typename: 'ReviewRequestedEvent', createdAt: string, actor:
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
             | null, requestedReviewer:
              | { __typename: 'Bot' }
              | { __typename: 'EnterpriseTeam' }
              | { __typename: 'Mannequin' }
              | { __typename: 'Team', slug: string }
              | { __typename: 'User', login: string }
             | null }
          | { __typename: 'SubIssueAddedEvent' }
          | { __typename: 'SubIssueRemovedEvent' }
          | { __typename: 'SubscribedEvent' }
          | { __typename: 'TransferredEvent' }
          | { __typename: 'UnassignedEvent', createdAt: string, actor:
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
             | null, assignee:
              | { login: string }
              | Record<PropertyKey, never>
             | null }
          | { __typename: 'UnlabeledEvent', createdAt: string, actor:
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
              | { login: string }
             | null, label: { name: string } }
          | { __typename: 'UnlockedEvent' }
          | { __typename: 'UnmarkedAsDuplicateEvent' }
          | { __typename: 'UnpinnedEvent' }
          | { __typename: 'UnsubscribedEvent' }
          | { __typename: 'UserBlockedEvent' }
         | null> | null }, files: { nodes: Array<{ path: string, viewerViewedState: FileViewedState } | null> | null } | null }
    | Record<PropertyKey, never>
   | null };

export type SubmitReviewMutationVariables = Exact<{
  prId: string | number;
  commit: string;
  event: PullRequestReviewEvent;
  body?: string | null | undefined;
  threads?: Array<DraftPullRequestReviewThread> | DraftPullRequestReviewThread | null | undefined;
}>;


export type SubmitReviewMutation = { addPullRequestReview: { pullRequestReview: { id: string, state: PullRequestReviewState, submittedAt: string | null, commit: { oid: string } | null } | null } | null };

export type ReplyMutationVariables = Exact<{
  threadId: string | number;
  body: string;
}>;


export type ReplyMutation = { addPullRequestReviewThreadReply: { comment: { id: string, createdAt: string } | null } | null };

export type ResolveThreadMutationVariables = Exact<{
  threadId: string | number;
}>;


export type ResolveThreadMutation = { resolveReviewThread: { thread: { id: string, isResolved: boolean } | null } | null };

export type UnresolveThreadMutationVariables = Exact<{
  threadId: string | number;
}>;


export type UnresolveThreadMutation = { unresolveReviewThread: { thread: { id: string, isResolved: boolean } | null } | null };

export type MarkViewedMutationVariables = Exact<{
  prId: string | number;
  path: string;
}>;


export type MarkViewedMutation = { markFileAsViewed: { clientMutationId: string | null } | null };

export type UnmarkViewedMutationVariables = Exact<{
  prId: string | number;
  path: string;
}>;


export type UnmarkViewedMutation = { unmarkFileAsViewed: { clientMutationId: string | null } | null };

export type CommentsByQueryVariables = Exact<{
  prId: string | number;
}>;


export type CommentsByQuery = { node:
    | { comments: { nodes: Array<{ id: string, body: string, author:
            | { login: string }
            | { login: string }
            | { login: string }
            | { login: string }
            | { login: string }
           | null } | null> | null }, reviewThreads: { nodes: Array<{ comments: { nodes: Array<{ id: string, body: string, author:
                | { login: string }
                | { login: string }
                | { login: string }
                | { login: string }
                | { login: string }
               | null } | null> | null } } | null> | null } }
    | Record<PropertyKey, never>
   | null };

export type MergeInfoQueryVariables = Exact<{
  id: string | number;
}>;


export type MergeInfoQuery = { node:
    | { id: string, isDraft: boolean, mergeable: MergeableState, mergeStateStatus: MergeStateStatus, reviewDecision: PullRequestReviewDecision | null, viewerCanUpdateBranch: boolean, viewerCanEnableAutoMerge: boolean, viewerCanMergeAsAdmin: boolean, mergeHeadline: string, mergeBody: string, squashHeadline: string, squashBody: string, autoMergeRequest: { enabledAt: string | null, mergeMethod: PullRequestMergeMethod } | null, mergeQueueEntry: { position: number, state: MergeQueueEntryState } | null, repository: { mergeCommitAllowed: boolean, squashMergeAllowed: boolean, rebaseMergeAllowed: boolean, autoMergeAllowed: boolean, viewerDefaultMergeMethod: PullRequestMergeMethod } }
    | Record<PropertyKey, never>
   | null };

export type EnableAutoMergeMutationVariables = Exact<{
  prId: string | number;
  method: PullRequestMergeMethod;
  head: string;
}>;


export type EnableAutoMergeMutation = { enablePullRequestAutoMerge: { pullRequest: { id: string } | null } | null };

export type DisableAutoMergeMutationVariables = Exact<{
  prId: string | number;
}>;


export type DisableAutoMergeMutation = { disablePullRequestAutoMerge: { pullRequest: { id: string } | null } | null };

export type UpdateBranchMutationVariables = Exact<{
  prId: string | number;
  method: PullRequestBranchUpdateMethod;
  head: string;
}>;


export type UpdateBranchMutation = { updatePullRequestBranch: { pullRequest: { id: string } | null } | null };

export type ConvertToDraftMutationVariables = Exact<{
  prId: string | number;
}>;


export type ConvertToDraftMutation = { convertPullRequestToDraft: { pullRequest: { id: string } | null } | null };

export type MarkReadyMutationVariables = Exact<{
  prId: string | number;
}>;


export type MarkReadyMutation = { markPullRequestReadyForReview: { pullRequest: { id: string } | null } | null };

export type ClosePrMutationVariables = Exact<{
  prId: string | number;
}>;


export type ClosePrMutation = { closePullRequest: { pullRequest: { id: string } | null } | null };

export type ReopenPrMutationVariables = Exact<{
  prId: string | number;
}>;


export type ReopenPrMutation = { reopenPullRequest: { pullRequest: { id: string } | null } | null };

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>['__apiType']>;
  private value: string;
  public __meta__?: Record<string, any> | undefined;

  constructor(value: string, __meta__?: Record<string, any> | undefined) {
    super(value);
    this.value = value;
    this.__meta__ = __meta__;
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value;
  }
}

export const ViewerDocument = new TypedDocumentString(`
    query Viewer {
  viewer {
    login
    avatarUrl(size: 64)
  }
}
    `) as unknown as TypedDocumentString<ViewerQuery, ViewerQueryVariables>;
export const SearchPullsDocument = new TypedDocumentString(`
    query SearchPulls($query: String!, $after: String) {
  search(type: ISSUE_ADVANCED, query: $query, first: 100, after: $after) {
    issueCount
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      ... on PullRequest {
        id
        updatedAt
        headRefOid
        state
      }
    }
  }
}
    `) as unknown as TypedDocumentString<SearchPullsQuery, SearchPullsQueryVariables>;
export const SweepDocument = new TypedDocumentString(`
    query Sweep($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on PullRequest {
      id
      state
      isDraft
      updatedAt
      headRefOid
      mergeable
      mergeStateStatus
      reviewDecision
      autoMergeRequest {
        enabledAt
      }
      mergeQueueEntry {
        position
        state
      }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              state
            }
          }
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<SweepQuery, SweepQueryVariables>;
export const HydrateDocument = new TypedDocumentString(`
    query Hydrate($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on PullRequest {
      id
      number
      title
      url
      body
      state
      isDraft
      createdAt
      updatedAt
      baseRefName
      headRefName
      baseRefOid
      headRefOid
      additions
      deletions
      changedFiles
      mergeable
      mergeStateStatus
      reviewDecision
      author {
        __typename
        login
        avatarUrl(size: 64)
      }
      repository {
        id
        nameWithOwner
        isPrivate
        viewerPermission
      }
      autoMergeRequest {
        enabledAt
        mergeMethod
      }
      mergeQueueEntry {
        position
        state
      }
      labels(first: 20) {
        nodes {
          name
          color
        }
      }
      assignees(first: 10) {
        nodes {
          login
          avatarUrl(size: 64)
        }
      }
      milestone {
        number
        title
        dueOn
      }
      files(first: 100) {
        totalCount
        nodes {
          path
          additions
          deletions
          changeType
        }
      }
      commits(last: 10) {
        totalCount
        nodes {
          commit {
            oid
            message
            committedDate
            author {
              name
              email
              user {
                login
              }
            }
            signature {
              isValid
            }
          }
        }
      }
      lastCommit: commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              state
              contexts(first: 100) {
                totalCount
                nodes {
                  __typename
                  ... on CheckRun {
                    name
                    status
                    conclusion
                  }
                  ... on StatusContext {
                    context
                    state
                  }
                }
              }
            }
          }
        }
      }
      reviewRequests(first: 20) {
        nodes {
          asCodeOwner
          requestedReviewer {
            __typename
            ... on User {
              login
            }
            ... on Team {
              slug
              organization {
                login
              }
            }
            ... on Bot {
              login
            }
          }
        }
      }
      viewerLatestReview {
        state
        submittedAt
        commit {
          oid
        }
      }
      latestOpinionatedReviews(first: 20) {
        nodes {
          state
          author {
            login
          }
          commit {
            oid
          }
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<HydrateQuery, HydrateQueryVariables>;
export const ApproveDocument = new TypedDocumentString(`
    mutation Approve($prId: ID!, $commit: GitObjectID!, $body: String) {
  addPullRequestReview(
    input: { pullRequestId: $prId, commitOID: $commit, event: APPROVE, body: $body }
  ) {
    pullRequestReview {
      id
      state
      submittedAt
      commit {
        oid
      }
    }
  }
}
    `) as unknown as TypedDocumentString<ApproveMutation, ApproveMutationVariables>;
export const CommentDocument = new TypedDocumentString(`
    mutation Comment($subjectId: ID!, $body: String!) {
  addComment(input: { subjectId: $subjectId, body: $body }) {
    commentEdge {
      node {
        id
        createdAt
      }
    }
  }
}
    `) as unknown as TypedDocumentString<CommentMutation, CommentMutationVariables>;
export const ReviewsByAuthorDocument = new TypedDocumentString(`
    query ReviewsByAuthor($prId: ID!, $author: String!) {
  node(id: $prId) {
    ... on PullRequest {
      reviews(last: 20, author: $author) {
        nodes {
          id
          state
          submittedAt
          commit {
            oid
          }
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<ReviewsByAuthorQuery, ReviewsByAuthorQueryVariables>;
export const RateLimitDocument = new TypedDocumentString(`
    query RateLimit {
  rateLimit {
    limit
    remaining
    used
    resetAt
  }
}
    `) as unknown as TypedDocumentString<RateLimitQuery, RateLimitQueryVariables>;
export const PrDetailDocument = new TypedDocumentString(`
    query PrDetail($id: ID!) {
  node(id: $id) {
    ... on PullRequest {
      id
      headRefOid
      bodyHTML
      viewerLatestReview {
        state
        submittedAt
        commit {
          oid
        }
      }
      pendingReviews: reviews(states: PENDING, first: 1) {
        nodes {
          id
          commit {
            oid
          }
          comments(first: 100) {
            nodes {
              id
              body
              path
              line
              startLine
              originalLine
              diffHunk
            }
          }
        }
      }
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          startLine
          originalLine
          originalStartLine
          diffSide
          startDiffSide
          subjectType
          viewerCanResolve
          viewerCanUnresolve
          viewerCanReply
          resolvedBy {
            login
          }
          comments(first: 50) {
            nodes {
              id
              body
              bodyHTML
              createdAt
              lastEditedAt
              diffHunk
              state
              author {
                login
                avatarUrl(size: 64)
              }
              originalCommit {
                oid
              }
            }
          }
        }
      }
      reviews(last: 50) {
        nodes {
          id
          state
          bodyHTML
          body
          submittedAt
          author {
            login
            avatarUrl(size: 64)
          }
          commit {
            oid
          }
        }
      }
      comments(last: 100) {
        nodes {
          id
          body
          bodyHTML
          createdAt
          lastEditedAt
          author {
            login
            avatarUrl(size: 64)
          }
        }
      }
      allCommits: commits(last: 100) {
        totalCount
        nodes {
          commit {
            oid
            messageHeadline
            committedDate
            author {
              name
              user {
                login
              }
            }
            statusCheckRollup {
              state
            }
          }
        }
      }
      timelineItems(
        last: 100
        itemTypes: [
          HEAD_REF_FORCE_PUSHED_EVENT
          REVIEW_REQUESTED_EVENT
          READY_FOR_REVIEW_EVENT
          CONVERT_TO_DRAFT_EVENT
          MERGED_EVENT
          CLOSED_EVENT
          REOPENED_EVENT
          LABELED_EVENT
          UNLABELED_EVENT
          RENAMED_TITLE_EVENT
          REVIEW_DISMISSED_EVENT
          BASE_REF_FORCE_PUSHED_EVENT
          ASSIGNED_EVENT
          UNASSIGNED_EVENT
          MILESTONED_EVENT
          DEMILESTONED_EVENT
          REVIEW_REQUEST_REMOVED_EVENT
        ]
      ) {
        nodes {
          __typename
          ... on HeadRefForcePushedEvent {
            createdAt
            actor {
              login
            }
            beforeCommit {
              oid
            }
            afterCommit {
              oid
            }
          }
          ... on ReviewRequestedEvent {
            createdAt
            actor {
              login
            }
            requestedReviewer {
              __typename
              ... on User {
                login
              }
              ... on Team {
                slug
              }
            }
          }
          ... on ReadyForReviewEvent {
            createdAt
            actor {
              login
            }
          }
          ... on ConvertToDraftEvent {
            createdAt
            actor {
              login
            }
          }
          ... on MergedEvent {
            createdAt
            actor {
              login
            }
          }
          ... on ClosedEvent {
            createdAt
            actor {
              login
            }
          }
          ... on ReopenedEvent {
            createdAt
            actor {
              login
            }
          }
          ... on LabeledEvent {
            createdAt
            actor {
              login
            }
            label {
              name
            }
          }
          ... on UnlabeledEvent {
            createdAt
            actor {
              login
            }
            label {
              name
            }
          }
          ... on AssignedEvent {
            createdAt
            actor {
              login
            }
            assignee {
              ... on User {
                login
              }
            }
          }
          ... on UnassignedEvent {
            createdAt
            actor {
              login
            }
            assignee {
              ... on User {
                login
              }
            }
          }
          ... on MilestonedEvent {
            createdAt
            actor {
              login
            }
            milestoneTitle
          }
          ... on DemilestonedEvent {
            createdAt
            actor {
              login
            }
            milestoneTitle
          }
          ... on ReviewRequestRemovedEvent {
            createdAt
            actor {
              login
            }
            requestedReviewer {
              __typename
              ... on User {
                login
              }
              ... on Team {
                slug
              }
            }
          }
          ... on RenamedTitleEvent {
            createdAt
            actor {
              login
            }
            previousTitle
            currentTitle
          }
          ... on ReviewDismissedEvent {
            createdAt
            actor {
              login
            }
          }
          ... on BaseRefForcePushedEvent {
            createdAt
            actor {
              login
            }
          }
        }
      }
      files(first: 100) {
        nodes {
          path
          viewerViewedState
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<PrDetailQuery, PrDetailQueryVariables>;
export const SubmitReviewDocument = new TypedDocumentString(`
    mutation SubmitReview($prId: ID!, $commit: GitObjectID!, $event: PullRequestReviewEvent!, $body: String, $threads: [DraftPullRequestReviewThread!]) {
  addPullRequestReview(
    input: {
      pullRequestId: $prId
      commitOID: $commit
      event: $event
      body: $body
      threads: $threads
    }
  ) {
    pullRequestReview {
      id
      state
      submittedAt
      commit {
        oid
      }
    }
  }
}
    `) as unknown as TypedDocumentString<SubmitReviewMutation, SubmitReviewMutationVariables>;
export const ReplyDocument = new TypedDocumentString(`
    mutation Reply($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(
    input: { pullRequestReviewThreadId: $threadId, body: $body }
  ) {
    comment {
      id
      createdAt
    }
  }
}
    `) as unknown as TypedDocumentString<ReplyMutation, ReplyMutationVariables>;
export const ResolveThreadDocument = new TypedDocumentString(`
    mutation ResolveThread($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread {
      id
      isResolved
    }
  }
}
    `) as unknown as TypedDocumentString<ResolveThreadMutation, ResolveThreadMutationVariables>;
export const UnresolveThreadDocument = new TypedDocumentString(`
    mutation UnresolveThread($threadId: ID!) {
  unresolveReviewThread(input: { threadId: $threadId }) {
    thread {
      id
      isResolved
    }
  }
}
    `) as unknown as TypedDocumentString<UnresolveThreadMutation, UnresolveThreadMutationVariables>;
export const MarkViewedDocument = new TypedDocumentString(`
    mutation MarkViewed($prId: ID!, $path: String!) {
  markFileAsViewed(input: { pullRequestId: $prId, path: $path }) {
    clientMutationId
  }
}
    `) as unknown as TypedDocumentString<MarkViewedMutation, MarkViewedMutationVariables>;
export const UnmarkViewedDocument = new TypedDocumentString(`
    mutation UnmarkViewed($prId: ID!, $path: String!) {
  unmarkFileAsViewed(input: { pullRequestId: $prId, path: $path }) {
    clientMutationId
  }
}
    `) as unknown as TypedDocumentString<UnmarkViewedMutation, UnmarkViewedMutationVariables>;
export const CommentsByDocument = new TypedDocumentString(`
    query CommentsBy($prId: ID!) {
  node(id: $prId) {
    ... on PullRequest {
      comments(last: 30) {
        nodes {
          id
          body
          author {
            login
          }
        }
      }
      reviewThreads(last: 50) {
        nodes {
          comments(last: 10) {
            nodes {
              id
              body
              author {
                login
              }
            }
          }
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<CommentsByQuery, CommentsByQueryVariables>;
export const MergeInfoDocument = new TypedDocumentString(`
    query MergeInfo($id: ID!) {
  node(id: $id) {
    ... on PullRequest {
      id
      isDraft
      mergeable
      mergeStateStatus
      reviewDecision
      viewerCanUpdateBranch
      viewerCanEnableAutoMerge
      viewerCanMergeAsAdmin
      autoMergeRequest {
        enabledAt
        mergeMethod
      }
      mergeQueueEntry {
        position
        state
      }
      mergeHeadline: viewerMergeHeadlineText(mergeType: MERGE)
      mergeBody: viewerMergeBodyText(mergeType: MERGE)
      squashHeadline: viewerMergeHeadlineText(mergeType: SQUASH)
      squashBody: viewerMergeBodyText(mergeType: SQUASH)
      repository {
        mergeCommitAllowed
        squashMergeAllowed
        rebaseMergeAllowed
        autoMergeAllowed
        viewerDefaultMergeMethod
      }
    }
  }
}
    `) as unknown as TypedDocumentString<MergeInfoQuery, MergeInfoQueryVariables>;
export const EnableAutoMergeDocument = new TypedDocumentString(`
    mutation EnableAutoMerge($prId: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID!) {
  enablePullRequestAutoMerge(
    input: { pullRequestId: $prId, mergeMethod: $method, expectedHeadOid: $head }
  ) {
    pullRequest {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<EnableAutoMergeMutation, EnableAutoMergeMutationVariables>;
export const DisableAutoMergeDocument = new TypedDocumentString(`
    mutation DisableAutoMerge($prId: ID!) {
  disablePullRequestAutoMerge(input: { pullRequestId: $prId }) {
    pullRequest {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<DisableAutoMergeMutation, DisableAutoMergeMutationVariables>;
export const UpdateBranchDocument = new TypedDocumentString(`
    mutation UpdateBranch($prId: ID!, $method: PullRequestBranchUpdateMethod!, $head: GitObjectID!) {
  updatePullRequestBranch(
    input: { pullRequestId: $prId, updateMethod: $method, expectedHeadOid: $head }
  ) {
    pullRequest {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<UpdateBranchMutation, UpdateBranchMutationVariables>;
export const ConvertToDraftDocument = new TypedDocumentString(`
    mutation ConvertToDraft($prId: ID!) {
  convertPullRequestToDraft(input: { pullRequestId: $prId }) {
    pullRequest {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<ConvertToDraftMutation, ConvertToDraftMutationVariables>;
export const MarkReadyDocument = new TypedDocumentString(`
    mutation MarkReady($prId: ID!) {
  markPullRequestReadyForReview(input: { pullRequestId: $prId }) {
    pullRequest {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<MarkReadyMutation, MarkReadyMutationVariables>;
export const ClosePrDocument = new TypedDocumentString(`
    mutation ClosePr($prId: ID!) {
  closePullRequest(input: { pullRequestId: $prId }) {
    pullRequest {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<ClosePrMutation, ClosePrMutationVariables>;
export const ReopenPrDocument = new TypedDocumentString(`
    mutation ReopenPr($prId: ID!) {
  reopenPullRequest(input: { pullRequestId: $prId }) {
    pullRequest {
      id
    }
  }
}
    `) as unknown as TypedDocumentString<ReopenPrMutation, ReopenPrMutationVariables>;