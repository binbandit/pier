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
        viewerCanUpdate
        viewerCanDeleteHeadRef
        isCrossRepository
        headRef {
          id
        }
        locked
        activeLockReason
        headChecks: commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun {
                      name
                      isRequired(pullRequestId: $id)
                    }
                    ... on StatusContext {
                      context
                      isRequired(pullRequestId: $id)
                    }
                  }
                }
              }
            }
          }
        }
        closingIssuesReferences(first: 10) {
          nodes {
            number
            title
            url
            state
            repository {
              nameWithOwner
            }
          }
        }
        reactionGroups {
          content
          viewerHasReacted
          reactors {
            totalCount
          }
        }
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
                viewerCanUpdate
                viewerCanDelete
                viewerCanMinimize
                isMinimized
                minimizedReason
                reactionGroups {
                  content
                  viewerHasReacted
                  reactors {
                    totalCount
                  }
                }
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
            lastEditedAt
            viewerCanUpdate
            reactionGroups {
              content
              viewerHasReacted
              reactors {
                totalCount
              }
            }
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
            viewerCanUpdate
            viewerCanDelete
            viewerCanMinimize
            isMinimized
            minimizedReason
            reactionGroups {
              content
              viewerHasReacted
              reactors {
                totalCount
              }
            }
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
              signature {
                isValid
              }
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
            LOCKED_EVENT
            UNLOCKED_EVENT
            BASE_REF_CHANGED_EVENT
            AUTOMATIC_BASE_CHANGE_SUCCEEDED_EVENT
            CROSS_REFERENCED_EVENT
            CONNECTED_EVENT
            DISCONNECTED_EVENT
            AUTO_MERGE_ENABLED_EVENT
            AUTO_MERGE_DISABLED_EVENT
            HEAD_REF_DELETED_EVENT
            HEAD_REF_RESTORED_EVENT
            ADDED_TO_MERGE_QUEUE_EVENT
            REMOVED_FROM_MERGE_QUEUE_EVENT
            MARKED_AS_DUPLICATE_EVENT
            COMMENT_DELETED_EVENT
            DEPLOYED_EVENT
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
            ... on LockedEvent {
              createdAt
              actor {
                login
              }
              lockReason
            }
            ... on UnlockedEvent {
              createdAt
              actor {
                login
              }
            }
            ... on BaseRefChangedEvent {
              createdAt
              actor {
                login
              }
              previousRefName
              currentRefName
            }
            ... on AutomaticBaseChangeSucceededEvent {
              createdAt
              actor {
                login
              }
              oldBase
              newBase
            }
            ... on CrossReferencedEvent {
              createdAt
              actor {
                login
              }
              willCloseTarget
              source {
                __typename
                ... on Issue {
                  number
                  title
                  url
                  repository {
                    nameWithOwner
                  }
                }
                ... on PullRequest {
                  number
                  title
                  url
                  repository {
                    nameWithOwner
                  }
                }
              }
            }
            ... on ConnectedEvent {
              createdAt
              actor {
                login
              }
              subject {
                __typename
                ... on Issue {
                  number
                  title
                  url
                  repository {
                    nameWithOwner
                  }
                }
                ... on PullRequest {
                  number
                  title
                  url
                  repository {
                    nameWithOwner
                  }
                }
              }
            }
            ... on DisconnectedEvent {
              createdAt
              actor {
                login
              }
              subject {
                __typename
                ... on Issue {
                  number
                  title
                  url
                  repository {
                    nameWithOwner
                  }
                }
                ... on PullRequest {
                  number
                  title
                  url
                  repository {
                    nameWithOwner
                  }
                }
              }
            }
            ... on AutoMergeEnabledEvent {
              createdAt
              actor {
                login
              }
            }
            ... on AutoMergeDisabledEvent {
              createdAt
              actor {
                login
              }
              reason
            }
            ... on HeadRefDeletedEvent {
              createdAt
              actor {
                login
              }
              headRefName
            }
            ... on HeadRefRestoredEvent {
              createdAt
              actor {
                login
              }
            }
            ... on AddedToMergeQueueEvent {
              createdAt
              actor {
                login
              }
            }
            ... on RemovedFromMergeQueueEvent {
              createdAt
              actor {
                login
              }
              reason
            }
            ... on MarkedAsDuplicateEvent {
              createdAt
              actor {
                login
              }
              canonical {
                __typename
                ... on Issue {
                  number
                  title
                  url
                  repository {
                    nameWithOwner
                  }
                }
                ... on PullRequest {
                  number
                  title
                  url
                  repository {
                    nameWithOwner
                  }
                }
              }
            }
            ... on CommentDeletedEvent {
              createdAt
              actor {
                login
              }
              deletedCommentAuthor {
                login
              }
            }
            ... on DeployedEvent {
              createdAt
              actor {
                login
              }
              deployment {
                environment
              }
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

/** What the merge runway needs: why the PR can't merge yet, and how this repo merges. */
export const MergeInfoQuery = graphql(`
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
        isMergeQueueEnabled
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
`);

export const EnableAutoMergeMutation = graphql(`
  mutation EnableAutoMerge($prId: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID!) {
    enablePullRequestAutoMerge(
      input: { pullRequestId: $prId, mergeMethod: $method, expectedHeadOid: $head }
    ) {
      pullRequest {
        id
      }
    }
  }
`);

export const DisableAutoMergeMutation = graphql(`
  mutation DisableAutoMerge($prId: ID!) {
    disablePullRequestAutoMerge(input: { pullRequestId: $prId }) {
      pullRequest {
        id
      }
    }
  }
`);

export const UpdateBranchMutation = graphql(`
  mutation UpdateBranch($prId: ID!, $method: PullRequestBranchUpdateMethod!, $head: GitObjectID!) {
    updatePullRequestBranch(
      input: { pullRequestId: $prId, updateMethod: $method, expectedHeadOid: $head }
    ) {
      pullRequest {
        id
      }
    }
  }
`);

export const ConvertToDraftMutation = graphql(`
  mutation ConvertToDraft($prId: ID!) {
    convertPullRequestToDraft(input: { pullRequestId: $prId }) {
      pullRequest {
        id
      }
    }
  }
`);

export const MarkReadyMutation = graphql(`
  mutation MarkReady($prId: ID!) {
    markPullRequestReadyForReview(input: { pullRequestId: $prId }) {
      pullRequest {
        id
      }
    }
  }
`);

export const ClosePrMutation = graphql(`
  mutation ClosePr($prId: ID!) {
    closePullRequest(input: { pullRequestId: $prId }) {
      pullRequest {
        id
      }
    }
  }
`);

export const ReopenPrMutation = graphql(`
  mutation ReopenPr($prId: ID!) {
    reopenPullRequest(input: { pullRequestId: $prId }) {
      pullRequest {
        id
      }
    }
  }
`);

export const AddReactionMutation = graphql(`
  mutation AddReaction($subjectId: ID!, $content: ReactionContent!) {
    addReaction(input: { subjectId: $subjectId, content: $content }) {
      reaction {
        content
      }
    }
  }
`);

export const RemoveReactionMutation = graphql(`
  mutation RemoveReaction($subjectId: ID!, $content: ReactionContent!) {
    removeReaction(input: { subjectId: $subjectId, content: $content }) {
      reaction {
        content
      }
    }
  }
`);

export const UpdateIssueCommentMutation = graphql(`
  mutation UpdateIssueComment($id: ID!, $body: String!) {
    updateIssueComment(input: { id: $id, body: $body }) {
      issueComment {
        id
      }
    }
  }
`);

export const UpdateReviewCommentMutation = graphql(`
  mutation UpdateReviewComment($id: ID!, $body: String!) {
    updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body }) {
      pullRequestReviewComment {
        id
      }
    }
  }
`);

export const UpdateReviewMutation = graphql(`
  mutation UpdateReview($id: ID!, $body: String!) {
    updatePullRequestReview(input: { pullRequestReviewId: $id, body: $body }) {
      pullRequestReview {
        id
      }
    }
  }
`);

export const UpdatePrMutation = graphql(`
  mutation UpdatePr($prId: ID!, $title: String, $body: String, $base: String) {
    updatePullRequest(
      input: { pullRequestId: $prId, title: $title, body: $body, baseRefName: $base }
    ) {
      pullRequest {
        id
      }
    }
  }
`);

export const DeleteIssueCommentMutation = graphql(`
  mutation DeleteIssueComment($id: ID!) {
    deleteIssueComment(input: { id: $id }) {
      clientMutationId
    }
  }
`);

export const DeleteReviewCommentMutation = graphql(`
  mutation DeleteReviewComment($id: ID!) {
    deletePullRequestReviewComment(input: { id: $id }) {
      clientMutationId
    }
  }
`);

export const MinimizeMutation = graphql(`
  mutation Minimize($id: ID!, $classifier: ReportedContentClassifiers!) {
    minimizeComment(input: { subjectId: $id, classifier: $classifier }) {
      minimizedComment {
        isMinimized
      }
    }
  }
`);

export const UnminimizeMutation = graphql(`
  mutation Unminimize($id: ID!) {
    unminimizeComment(input: { subjectId: $id }) {
      unminimizedComment {
        isMinimized
      }
    }
  }
`);

export const DismissReviewMutation = graphql(`
  mutation DismissReview($id: ID!, $message: String!) {
    dismissPullRequestReview(input: { pullRequestReviewId: $id, message: $message }) {
      pullRequestReview {
        id
      }
    }
  }
`);

export const PendingReviewQuery = graphql(`
  query PendingReview($prId: ID!) {
    node(id: $prId) {
      ... on PullRequest {
        reviews(states: PENDING, first: 1) {
          nodes {
            id
            comments(first: 100) {
              nodes {
                path
                body
              }
            }
          }
        }
      }
    }
  }
`);

export const StartReviewMutation = graphql(`
  mutation StartReview(
    $prId: ID!
    $commit: GitObjectID!
    $threads: [DraftPullRequestReviewThread!]
  ) {
    addPullRequestReview(input: { pullRequestId: $prId, commitOID: $commit, threads: $threads }) {
      pullRequestReview {
        id
      }
    }
  }
`);

export const AddReviewThreadMutation = graphql(`
  mutation AddReviewThread(
    $reviewId: ID!
    $path: String!
    $body: String!
    $subject: PullRequestReviewThreadSubjectType!
    $line: Int
    $side: DiffSide
    $startLine: Int
    $startSide: DiffSide
  ) {
    addPullRequestReviewThread(
      input: {
        pullRequestReviewId: $reviewId
        path: $path
        body: $body
        subjectType: $subject
        line: $line
        side: $side
        startLine: $startLine
        startSide: $startSide
      }
    ) {
      thread {
        id
      }
    }
  }
`);

export const SubmitPendingReviewMutation = graphql(`
  mutation SubmitPendingReview($reviewId: ID!, $event: PullRequestReviewEvent!, $body: String) {
    submitPullRequestReview(input: { pullRequestReviewId: $reviewId, event: $event, body: $body }) {
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

export const HistoryQuery = graphql(`
  query History($id: ID!) {
    node(id: $id) {
      ... on Comment {
        userContentEdits(first: 30) {
          nodes {
            editedAt
            diff
            editor {
              login
            }
          }
        }
      }
    }
  }
`);

export const SuggestedReviewersQuery = graphql(`
  query SuggestedReviewers($prId: ID!) {
    node(id: $prId) {
      ... on PullRequest {
        suggestedReviewerActors(first: 20) {
          nodes {
            reviewer {
              __typename
              ... on User {
                login
                avatarUrl(size: 64)
              }
              ... on Bot {
                login
                avatarUrl(size: 64)
              }
            }
          }
        }
      }
    }
  }
`);

export const RequestReviewsMutation = graphql(`
  mutation RequestReviews($prId: ID!, $users: [String!], $teams: [String!], $bots: [String!]) {
    requestReviewsByLogin(
      input: {
        pullRequestId: $prId
        userLogins: $users
        teamSlugs: $teams
        botLogins: $bots
        union: true
      }
    ) {
      pullRequest {
        id
      }
    }
  }
`);

export const EnqueueMutation = graphql(`
  mutation Enqueue($prId: ID!, $head: GitObjectID!, $jump: Boolean) {
    enqueuePullRequest(input: { pullRequestId: $prId, expectedHeadOid: $head, jump: $jump }) {
      mergeQueueEntry {
        position
      }
    }
  }
`);

export const DequeueMutation = graphql(`
  mutation Dequeue($prId: ID!) {
    dequeuePullRequest(input: { id: $prId }) {
      mergeQueueEntry {
        id
      }
    }
  }
`);

export const RevertMutation = graphql(`
  mutation Revert($prId: ID!, $title: String, $body: String) {
    revertPullRequest(input: { pullRequestId: $prId, title: $title, body: $body }) {
      revertPullRequest {
        number
        url
      }
    }
  }
`);

export const PrIdQuery = graphql(`
  query PrId($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        id
      }
    }
  }
`);

/** CODEOWNERS on a branch, from each place GitHub looks (it uses the first it finds). */
export const CodeOwnersQuery = graphql(`
  query CodeOwners(
    $owner: String!
    $name: String!
    $github: String!
    $root: String!
    $docs: String!
  ) {
    repository(owner: $owner, name: $name) {
      github: object(expression: $github) {
        ... on Blob {
          text
        }
      }
      root: object(expression: $root) {
        ... on Blob {
          text
        }
      }
      docs: object(expression: $docs) {
        ... on Blob {
          text
        }
      }
    }
  }
`);
