import { graphql } from "./gql";

// Every GraphQL operation pier runs. Each is priced with `rateLimit(dryRun: true)` in tests,
// so a query that quietly grows expensive fails CI rather than draining the hourly budget.

export const ViewerQuery = graphql(`
  query Viewer {
    viewer {
      login
      avatarUrl(size: 64)
    }
  }
`);

/** Discovery: which PRs exist in a scope, and whether they changed since we last looked. */
export const SearchPullsQuery = graphql(`
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
`);

/**
 * The volatile sweep. These fields change without bumping `updatedAt` (CI finishing,
 * mergeability recomputed after the base moves), so they are polled directly in batches.
 */
export const SweepQuery = graphql(`
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
`);

/**
 * Everything the queue and group canvas need about a PR, including the bot's PR body
 * (release notes) and recent commits (bump metadata and provenance).
 */
export const HydrateQuery = graphql(`
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
`);

export const ApproveMutation = graphql(`
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
`);

export const CommentMutation = graphql(`
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
`);

/** Used after a crash or timeout to find out whether an approval actually landed. */
export const ReviewsByAuthorQuery = graphql(`
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
`);

export const RateLimitQuery = graphql(`
  query RateLimit {
    rateLimit {
      limit
      remaining
      used
      resetAt
    }
  }
`);

/** Everything the PR canvas shows beyond the queue fields: threads, reviews, conversation, history. */
export const PrDetailQuery = graphql(`
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
`);

/** Submits a whole review in one write: the verdict, its body, and every new inline thread. */
export const SubmitReviewMutation = graphql(`
  mutation SubmitReview(
    $prId: ID!
    $commit: GitObjectID!
    $event: PullRequestReviewEvent!
    $body: String
    $threads: [DraftPullRequestReviewThread!]
  ) {
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
`);

export const ReplyMutation = graphql(`
  mutation Reply($threadId: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
      comment {
        id
        createdAt
      }
    }
  }
`);

export const ResolveThreadMutation = graphql(`
  mutation ResolveThread($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread {
        id
        isResolved
      }
    }
  }
`);

export const UnresolveThreadMutation = graphql(`
  mutation UnresolveThread($threadId: ID!) {
    unresolveReviewThread(input: { threadId: $threadId }) {
      thread {
        id
        isResolved
      }
    }
  }
`);

export const MarkViewedMutation = graphql(`
  mutation MarkViewed($prId: ID!, $path: String!) {
    markFileAsViewed(input: { pullRequestId: $prId, path: $path }) {
      clientMutationId
    }
  }
`);

export const UnmarkViewedMutation = graphql(`
  mutation UnmarkViewed($prId: ID!, $path: String!) {
    unmarkFileAsViewed(input: { pullRequestId: $prId, path: $path }) {
      clientMutationId
    }
  }
`);

/** Recent comments by one author, used to find out whether an interrupted reply or comment landed. */
export const CommentsByQuery = graphql(`
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
`);
