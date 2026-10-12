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

/** Represents available types of methods to use when merging a pull request. */
export type PullRequestMergeMethod =
  /** Add all commits from the head branch to the base branch with a merge commit. */
  | 'MERGE'
  /** Add all commits from the head branch onto the base branch individually. */
  | 'REBASE'
  /** Combine all commits from the head branch into a single commit in the base branch. */
  | 'SQUASH';

/** The review status of a pull request. */
export type PullRequestReviewDecision =
  /** The pull request has received an approving review. */
  | 'APPROVED'
  /** Changes have been requested on the pull request. */
  | 'CHANGES_REQUESTED'
  /** A review is required before the pull request can be merged. */
  | 'REVIEW_REQUIRED';

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
       | null, repository: { id: string, nameWithOwner: string, isPrivate: boolean, viewerPermission: RepositoryPermission | null }, autoMergeRequest: { enabledAt: string | null, mergeMethod: PullRequestMergeMethod } | null, mergeQueueEntry: { position: number, state: MergeQueueEntryState } | null, labels: { nodes: Array<{ name: string, color: string } | null> | null } | null, files: { totalCount: number, nodes: Array<{ path: string, additions: number, deletions: number, changeType: PatchStatus } | null> | null } | null, commits: { totalCount: number, nodes: Array<{ commit: { oid: string, message: string, committedDate: string, author: { name: string | null, email: string | null, user: { login: string } | null } | null, signature:
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