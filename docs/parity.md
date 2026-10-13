# Parity with GitHub

Everything GitHub.com does for a pull request after it exists, and where pier stands on each. This is the dogfood checklist: a row is only **dogfooded** once it has been used for real with no trip to github.com.

Status: `-` not started, `built`, `sandbox` (verified against the live sandbox repos), `dogfooded`
Milestones follow docs/design.md: M1a bots, M1b human review, I2 to I10 increments, gap = accepted gap (use Shift+O).

## A. Finding PRs

| ID | GitHub behaviour | API | Milestone | Status |
|---|---|---|---|---|
| FIND-REVIEW-REQUESTED | PRs where your review (or your team's) is requested | GraphQL search `review-requested:@me` | M1b | sandbox |
| FIND-REREVIEW | PRs with new commits since you reviewed | search + viewerLatestReview | M1b | sandbox |
| FIND-MINE | Your PRs that need you (changes requested, red, conflicts, approved and idle) | search `involves:@me` | M1b | built |
| FIND-BOTS | Dependabot / Renovate PRs across owned repos and orgs | search `author:app/dependabot user:X` | M1a | sandbox |
| FIND-INFLIGHT | Things waiting on others | derived | M1a | built |
| FIND-SEARCH | Search with every qualifier (`is:`, `review:`, `label:`, `status:`, `sort:` ...) | search API | I8 | - |
| FIND-VIEWS | Saved views / custom inbox sections | local | I8 | - |
| FIND-REPO-LIST | Per-repo PR list with filters | search `repo:` | I8 | - |
| NOTIF-FEED | Notifications as a change feed (304s free) | REST `/notifications` | M1a | built |
| NOTIF-DONE | Mark done also clears the GitHub notification | `DELETE /notifications/threads/:id` | M1b | built |
| NOTIF-SUBSCRIBE | Subscribe / unsubscribe / mute a PR | thread subscription | I8 | - |
| NOTIF-READ | Mark read / unread | `PATCH` thread (read only; no unread API) | I8 | - |
| NOTIF-SAVED | "Saved" notifications | none | gap | - |
| NOTIF-FILTERS | Custom inbox filters | none (use pier views) | I8 | - |

## B. Conversation and metadata

| ID | GitHub behaviour | API | Milestone | Status |
|---|---|---|---|---|
| CONV-BODY | Rendered description (mentions, refs, task lists, alerts) | `bodyHTML` | M1b | sandbox |
| CONV-MERMAID | Mermaid, math, GeoJSON rendering | client render | I9 | - |
| CONV-TIMELINE | Commits, reviews, comments, requests, force-pushes, labels, renames, merges | `timelineItems` | M1b | sandbox |
| CONV-TIMELINE-ALL | Every other timeline event type (about 70) with a generic fallback | `timelineItems` (the ~35 event types a reviewer sees; the rest are noise like subscriptions) | I6 | built |
| CONV-COMMENT | Add a conversation comment | `addComment` | M1b | built |
| CONV-EDIT | Edit your comment (edit history not shown yet) | `updateIssueComment` / `userContentEdits` | I6 | sandbox |
| CONV-DELETE | Delete a comment | `deleteIssueComment` | I6 | sandbox |
| CONV-MINIMIZE | Hide a comment with a reason, unhide | `minimizeComment` | I6 | sandbox |
| CONV-REACT | Reactions | `addReaction` / `removeReaction` | I6 | sandbox |
| CONV-QUOTE | Quote reply | client | I6 | sandbox |
| CONV-SAVED-REPLIES | Saved replies | read-only `viewer.savedReplies` (needs `read:user`) | I10 | - |
| CONV-UPLOAD | Paste or drop images and files | undocumented attachments endpoint | gap | - |
| META-TITLE | Edit title and body | `updatePullRequest` | I6 | sandbox |
| META-REVIEWERS | Request / re-request / remove reviewers (users, teams, Copilot), suggested reviewers | `requestReviewsByLogin` (users, team slugs, bots), REST removal, `suggestedReviewerActors`; listing every team needs org access, so only already-requested teams are offered | I6 | sandbox |
| META-ASSIGNEES | Assignees | REST issue `assignees` | I6 | sandbox |
| META-LABELS | Labels | REST issue `labels` | I6 | sandbox |
| META-MILESTONE | Milestone | REST issue `milestone` | I6 | sandbox |
| META-PROJECTS | Projects (v2) fields | `addProjectV2ItemById` (needs `project` scope) | I10 | - |
| META-LINKED | Linked issues (Development) | `closingIssuesReferences` (shown); link by writing `Closes #n` in the description, as GitHub's API offers no other way | I6 | sandbox |
| LIFE-DRAFT | Draft ⇄ ready for review | `convertPullRequestToDraft` / `markPullRequestReadyForReview` | I6 | sandbox |
| LIFE-CLOSE | Close / reopen | `closePullRequest` / `reopenPullRequest` | I6 | sandbox |
| LIFE-BASE | Change base branch | `updatePullRequest` | I6 | sandbox |
| LIFE-LOCK | Lock / unlock conversation | `lockLockable` | I6 | sandbox |
| LIFE-ARCHIVE | Archive a PR | `archivePullRequest` | I10 | - |

## C. Files and code review

| ID | GitHub behaviour | API | Milestone | Status |
|---|---|---|---|---|
| FILES-UNIFIED | Unified diff with syntax and word highlighting | REST files / git store | M1b | sandbox |
| FILES-SPLIT | Split (side by side) view | renderer option | I9 | - |
| FILES-WHITESPACE | Hide whitespace, without a reload | git store `-w` | M1b | built |
| FILES-CONTEXT | Expand context around hunks | git store blobs | I9 | - |
| FILES-TREE | File tree with viewed and comment markers | derived | M1b | built |
| FILES-FILTER | Filter by extension, owned by you, viewed, deleted | CODEOWNERS parse | I5 | - |
| FILES-VIEWED | Viewed checkbox, synced to GitHub, resets when the file changes | `markFileAsViewed`, `viewerViewedState` | M1b | built |
| FILES-SINCE-REVIEW | Only what changed since your last review, without rebase noise | git store merge-tree | M1b | sandbox |
| FILES-COMMITS | Commit list, single commit, any range | git store / `commits` | I4 | - |
| FILES-RICH | Rich diffs: images, markdown prose, notebooks, CSV, SVG | client | I9 | - |
| FILES-LARGE | Very large PRs (over 300 / 3,000 files, truncated patches) | git store | I9 | - |
| FILES-LOCKFILE | Lockfiles collapsed, dependency summary | dependency review API | M1a | built |
| FILES-PERMALINK | Line permalinks and `.diff` / `.patch` | client | I9 | - |
| COMMENT-LINE | Comment on a line | review `threads[]` | M1b | sandbox |
| COMMENT-RANGE | Comment on a range of lines | `startLine` | M1b | built |
| COMMENT-DELETED-LINE | Comment on a removed line | `side: LEFT` | M1b | built |
| COMMENT-FILE | Comment on a whole file | `subjectType: FILE` | I6 | sandbox |
| COMMENT-UNCHANGED | Comment on an unchanged line outside the hunks | undocumented in the API | gap | - |
| COMMENT-OUTSIDE | Threads on lines outside the shown diff stay visible | derived | M1b | sandbox |
| COMMENT-OUTDATED | Outdated threads shown with their original code | `diffHunk` | M1b | built |
| SUGGEST-WRITE | Write a suggestion block from the selected code (Cmd+G) | client | M1b | built |
| SUGGEST-APPLY | Apply one or a batch of suggestions as a commit | none; `createCommitOnBranch` | I7 | - |
| REVIEW-DRAFTS | Inline comments held as drafts until the review is sent | local | M1b | sandbox |
| REVIEW-SUBMIT | Comment / approve / request changes, with a summary | `addPullRequestReview` | M1b | sandbox |
| REVIEW-UNDO | Take a review back within 5 seconds | outbox hold | M1b | sandbox |
| REVIEW-WEB-PENDING | Continue a review started on github.com | `submitPullRequestReview` | I6 | sandbox |
| THREAD-REPLY | Reply to a thread | `addPullRequestReviewThreadReply` | M1b | built |
| THREAD-RESOLVE | Resolve / unresolve | `resolveReviewThread` | M1b | built |
| THREAD-NAV | Jump between open threads | client | M1b | built |
| REVIEW-DISMISS | Dismiss someone's review | `dismissPullRequestReview` | I6 | sandbox |
| CODEOWNERS | Who owns what, code-owner requests | CODEOWNERS parse, `asCodeOwner` | I5 | - |
| COPILOT-REVIEW | Request a Copilot review | `requestReviewsByLogin` bot `copilot-pull-request-reviewer`, offered when GitHub suggests it (the sandbox accounts don't have Copilot review, so not live-tested) | I6 | built |

## D. Checks

| ID | GitHub behaviour | API | Milestone | Status |
|---|---|---|---|---|
| CHECKS-ROLLUP | Overall state and each check | `statusCheckRollup` | M1a | sandbox |
| CHECKS-REQUIRED | Which checks are required | `isRequired` | I2 | - |
| CHECKS-LOGS | Step logs, failing step first | Actions jobs logs | I2 | - |
| CHECKS-ANNOTATIONS | Annotations inline in the diff | check run annotations | I2 | - |
| CHECKS-RERUN | Re-run failed / all / one job, with debug logging | Actions re-run APIs | I2 | - |
| CHECKS-CANCEL | Cancel a run | Actions cancel | I2 | - |
| CHECKS-FORK-APPROVE | Approve workflows from first-time contributors | Actions approve | I2 | - |
| DEPLOY-ENV | Deployments and environment approvals | deployments API | I2 | - |

## E. Merging

| ID | GitHub behaviour | API | Milestone | Status |
|---|---|---|---|---|
| MERGE-RUNWAY | Why it can't merge yet, with one-key fixes | `mergeStateStatus` + rollup (rules API not yet read, so a rule block is named only generically) | I3 | sandbox |
| MERGE-METHODS | Merge / squash / rebase with the message | `merge-async` | I3 | sandbox |
| MERGE-AUTO | Enable / disable auto-merge | `enablePullRequestAutoMerge` (private repos on a free plan can't use it, so not yet live-tested) | I3 | built |
| MERGE-QUEUE | Add to / jump / remove from merge queue | `enqueuePullRequest` | I3 | - |
| MERGE-UPDATE | Update branch by merge or rebase | `updatePullRequestBranch` | I3 | sandbox |
| MERGE-CONFLICTS | Web conflict editor | none | gap | - |
| MERGE-BRANCH | Delete / restore head branch | refs API | I3 | - |
| MERGE-REVERT | Revert a merged PR | `revertPullRequest` | I3 | - |
| MERGE-BYPASS | Merge bypassing rules (with typed confirmation) | `merge-async bypass_rules` | I3 | - |
| STACKS | Stack map, move between layers, merge a stack | stacks REST, `merge-async` | I10 | - |

## F. Dependency bumps (beyond GitHub)

| ID | Behaviour | Source | Milestone | Status |
|---|---|---|---|---|
| BOT-PARSE | Read every bump out of Dependabot and Renovate PRs | commit trailer, body, title, branch | M1a | dogfooded (202 real PRs) |
| BOT-GROUP | One decision per bump across every repo it landed in | derived | M1a | sandbox |
| BOT-GATES | Safety gates: version, release age, files, transitive deps, provenance, install scripts, advisories, checks | deps.dev, npm, GitHub | M1a | sandbox |
| BOT-APPROVE | Approve a cohort through a paced write plan | `addPullRequestReview` | M1a | sandbox |
| BOT-COMMANDS | `@dependabot rebase` / `recreate` / `ignore` | `addComment` | M1a | built |
| BOT-VERDICTS | Remember verdicts so new PRs for the same bump need one key | local | M1a | built |
| BOT-REVOKE | Revoke verdicts when an advisory lands | deps.dev | M3 | - |

## G. App

| ID | Behaviour | Milestone | Status |
|---|---|---|---|
| APP-ACCOUNTS | Every gh account in one inbox, each acting as itself | M1a | sandbox |
| APP-OUTBOX | Writes survive crashes and are never sent twice | M1a | built |
| APP-INSTALL | One binary, starts at login, `pier doctor` | M1a | sandbox |
| APP-PWA | Installable window with dock badge | M1a | built |
| APP-LINKS | github.com PR links open in pier (browser extension) | M1a | - |
| APP-OFFLINE | Says "daemon offline" instead of a browser error | M1a | built |
