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
