# Parity with GitHub

Everything GitHub.com does for a pull request after it exists, and where pier stands on each. This is the dogfood checklist: a row is only **dogfooded** once it has been used for real with no trip to github.com.

Status: `-` not started, `built`, `sandbox` (verified against the live sandbox repos), `dogfooded`
Milestones follow docs/design.md: M1a bots, M1b human review, I2 to I10 increments, gap = accepted gap (use Shift+O).

## A. Finding PRs

| ID | GitHub behaviour | API | Milestone | Status |
|---|---|---|---|---|
| FIND-REVIEW-REQUESTED | PRs where your review (or your team's) is requested | GraphQL search `review-requested:@me` | M1b | sandbox |
| FIND-REREVIEW | PRs with new commits since you reviewed | search + viewerLatestReview | M1b | sandbox |
| FIND-MINE | Your PRs that need you (changes requested, red, conflicts, approved and idle) | search `involves:@me` | M1b | sandbox |
| FIND-BOTS | Dependabot / Renovate PRs across owned repos and orgs | search `author:app/dependabot user:X` | M1a | sandbox |
| FIND-INFLIGHT | Things waiting on others | derived | M1a | built |
| FIND-SEARCH | Search with every qualifier (`is:`, `review:`, `label:`, `status:`, `sort:` ...), plus pier's (`turn:`, `checks:`, `size:`, `acct:`, `bot:`, `semver:`, `cohort:`); instant over the replica, ⌘⏎ asks GitHub for the rest | replica; search API | I8 | sandbox |
| FIND-VIEWS | Saved views / custom inbox sections (⌘S on a search; in the sidebar with counts) | local | I8 | sandbox |
| FIND-REPO-LIST | Per-repo PR list with filters, at github.com's `/:owner/:repo/pulls` | replica `repo:` | I8 | sandbox |
| NOTIF-FEED | Notifications as a change feed (304s free) | REST `/notifications` | M1a | built |
| NOTIF-DONE | Mark done also clears the GitHub notification | `DELETE /notifications/threads/:id` | M1b | built |
| NOTIF-SUBSCRIBE | Watch / stop watching a PR (`!`, `s n`) | REST thread subscription (`repo` scope); `updateSubscription` without a thread (needs `notifications`) | I8 | sandbox |
| NOTIF-READ | Opening a PR marks its notifications read, as github.com does (no unread API) | `PATCH` thread | I8 | sandbox |
| NOTIF-SAVED | "Saved" notifications | none | gap | - |
| NOTIF-FILTERS | Custom inbox filters | pier views | I8 | sandbox |

## B. Conversation and metadata

| ID | GitHub behaviour | API | Milestone | Status |
|---|---|---|---|---|
| CONV-BODY | Rendered description (mentions, refs, task lists, alerts) | `bodyHTML` | M1b | sandbox |
| CONV-MERMAID | Mermaid (in a sandboxed frame) and math (KaTeX); GeoJSON, TopoJSON and STL show as source | client render | I9 | sandbox |
| CONV-TIMELINE | Commits, reviews, comments, requests, force-pushes, labels, renames, merges | `timelineItems` | M1b | sandbox |
| CONV-TIMELINE-ALL | Every other timeline event type (about 70) with a generic fallback | `timelineItems` (the ~35 event types a reviewer sees; the rest are noise like subscriptions) | I6 | built |
| CONV-COMMENT | Add a conversation comment | `addComment` | M1b | sandbox |
| CONV-EDIT | Edit your comment (edit history not shown yet) | `updateIssueComment` / `userContentEdits` | I6 | sandbox |
| CONV-DELETE | Delete a comment | `deleteIssueComment` | I6 | sandbox |
| CONV-MINIMIZE | Hide a comment with a reason, unhide | `minimizeComment` | I6 | sandbox |
| CONV-REACT | Reactions | `addReaction` / `removeReaction` | I6 | sandbox |
| CONV-QUOTE | Quote reply | client | I6 | sandbox |
| CONV-SAVED-REPLIES | Saved replies (`Ctrl+.` in any comment box), kept in pier; GitHub's brought over with `read:user` | local; `viewer.savedReplies` | I10 | sandbox |
| CONV-UPLOAD | Paste or drop images and files | undocumented attachments endpoint | gap | - |
| META-TITLE | Edit title and body | `updatePullRequest` | I6 | sandbox |
| META-REVIEWERS | Request / re-request / remove reviewers (users, teams, Copilot), suggested reviewers | `requestReviewsByLogin` (users, team slugs, bots), REST removal, `suggestedReviewerActors`; listing every team needs org access, so only already-requested teams are offered | I6 | sandbox |
| META-ASSIGNEES | Assignees | REST issue `assignees` | I6 | sandbox |
| META-LABELS | Labels | REST issue `labels` | I6 | sandbox |
| META-MILESTONE | Milestone | REST issue `milestone` | I6 | sandbox |
| META-PROJECTS | Projects (v2): on/off a project, Status shown (`s p`); without the `project` scope pier says how to add it | `projectItems`, `addProjectV2ItemById`, `deleteProjectV2Item` | I10 | built |
| META-LINKED | Linked issues (Development) | `closingIssuesReferences` (shown); link by writing `Closes #n` in the description, as GitHub's API offers no other way | I6 | sandbox |
| LIFE-DRAFT | Draft ⇄ ready for review | `convertPullRequestToDraft` / `markPullRequestReadyForReview` | I6 | sandbox |
| LIFE-CLOSE | Close / reopen | `closePullRequest` / `reopenPullRequest` | I6 | sandbox |
| LIFE-BASE | Change base branch | `updatePullRequest` | I6 | sandbox |
| LIFE-LOCK | Lock / unlock conversation | `lockLockable` | I6 | sandbox |
| LIFE-ARCHIVE | Archive / unarchive a PR (palette); GitHub doesn't expose whether one is archived | `archivePullRequest` (preview, typed by hand) | I10 | sandbox |

## C. Files and code review

| ID | GitHub behaviour | API | Milestone | Status |
|---|---|---|---|---|
| FILES-UNIFIED | Unified diff with syntax and word highlighting | REST files / git store | M1b | sandbox |
| FILES-SPLIT | Split (side by side) view, remembered (`d s`) | renderer option | I9 | sandbox |
| FILES-WHITESPACE | Hide whitespace, without a reload | git store `-w` | M1b | sandbox |
| FILES-CONTEXT | Expand context around hunks | git store blobs | I9 | sandbox |
| FILES-TREE | File tree with viewed and comment markers | derived | M1b | built |
| FILES-FILTER | Filter by extension, owned by you, viewed, deleted | CODEOWNERS parse | I5 | sandbox |
| FILES-VIEWED | Viewed checkbox, synced to GitHub, resets when the file changes | `markFileAsViewed`, `viewerViewedState` | M1b | sandbox |
| FILES-SINCE-REVIEW | Only what changed since your last review, without rebase noise | git store merge-tree | M1b | sandbox |
| FILES-COMMITS | Commit list, single commit, any range | git store / `commits` | I4 | sandbox |
| FILES-RICH | Rich diffs: images side by side, SVG, rendered Markdown, CSV, notebooks (`d r`) | client | I9 | sandbox |
| FILES-LARGE | Very large PRs: lazy drawing, past 3,000 files and truncated patches from git | git store | I9 | built |
| FILES-LOCKFILE | Lockfiles collapsed, dependency summary | dependency review API | M1a | sandbox |
| FILES-PERMALINK | Line permalinks (`y`, github.com `#diff-` links open here) and `.diff` / `.patch` | client; REST diff media types | I9 | sandbox |
| COMMENT-LINE | Comment on a line | review `threads[]` | M1b | sandbox |
| COMMENT-RANGE | Comment on a range of lines | `startLine` | M1b | sandbox |
| COMMENT-DELETED-LINE | Comment on a removed line | `side: LEFT` | M1b | sandbox |
| COMMENT-FILE | Comment on a whole file | `subjectType: FILE` | I6 | sandbox |
| COMMENT-UNCHANGED | Comment on an unchanged line outside the hunks | undocumented in the API | gap | - |
| COMMENT-OUTSIDE | Threads on lines outside the shown diff stay visible | derived | M1b | sandbox |
| COMMENT-OUTDATED | Outdated threads shown with their original code | `diffHunk` | M1b | sandbox |
| SUGGEST-WRITE | Write a suggestion block from the selected code (Cmd+G) | client | M1b | sandbox |
| SUGGEST-APPLY | Apply one or a batch of suggestions as a commit (signed by GitHub, co-authored, threads resolved; keeps file modes, CRLF, BOM and a missing final newline, all checked live) | none; `createCommitOnBranch` with `expectedHeadOid` | I7 | sandbox |
| REVIEW-DRAFTS | Inline comments held as drafts until the review is sent | local | M1b | sandbox |
| REVIEW-SUBMIT | Comment / approve / request changes, with a summary | `addPullRequestReview` | M1b | sandbox |
| REVIEW-UNDO | Take a review back within 5 seconds | outbox hold | M1b | sandbox |
| REVIEW-WEB-PENDING | Continue a review started on github.com | `submitPullRequestReview` | I6 | sandbox |
| THREAD-REPLY | Reply to a thread | `addPullRequestReviewThreadReply` | M1b | sandbox |
| THREAD-RESOLVE | Resolve / unresolve | `resolveReviewThread` | M1b | sandbox |
| THREAD-NAV | Jump between open threads | client | M1b | sandbox |
| REVIEW-DISMISS | Dismiss someone's review | `dismissPullRequestReview` | I6 | sandbox |
| CODEOWNERS | Who owns what, code-owner requests | CODEOWNERS parse, `asCodeOwner` | I5 | sandbox |
| COPILOT-REVIEW | Request a Copilot review | `requestReviewsByLogin` bot `copilot-pull-request-reviewer`, offered when GitHub suggests it (the sandbox accounts don't have Copilot review, so not live-tested) | I6 | built |

## D. Checks

| ID | GitHub behaviour | API | Milestone | Status |
|---|---|---|---|---|
| CHECKS-ROLLUP | Overall state and each check | `statusCheckRollup` | M1a | sandbox |
| CHECKS-REQUIRED | Which checks are required | `isRequired` on the head's contexts (the sandbox's private repos can't have required checks, so shown in fake mode only) | I2 | built |
| CHECKS-LOGS | Step logs, failing step first (plus commit statuses from non-Actions CI) | jobs API steps + job log split by `##[group]`, colours stripped | I2 | sandbox |
| CHECKS-ANNOTATIONS | Annotations inline in the diff | check-run annotations: on their line in the diff, or under the check when the file isn't in the PR | I2 | sandbox |
| CHECKS-RERUN | Re-run failed / all / one job, with debug logging | Actions re-run APIs | I2 | sandbox |
| CHECKS-CANCEL | Cancel a run | Actions cancel | I2 | sandbox |
| CHECKS-FORK-APPROVE | Approve workflows from first-time contributors | `POST /actions/runs/:id/approve` (needs a fork contributor on a public repo to test live) | I2 | built |
| DEPLOY-ENV | Deployments and environment approvals | deployments + statuses (sandbox); environment approvals via `pending_deployments` (need environment reviewers, not on the free plan) | I2 | built |

## E. Merging

| ID | GitHub behaviour | API | Milestone | Status |
|---|---|---|---|---|
| MERGE-RUNWAY | Why it can't merge yet, with one-key fixes | `mergeStateStatus` + rollup (rules API not yet read, so a rule block is named only generically) | I3 | sandbox |
| MERGE-METHODS | Merge / squash / rebase with the message | `merge-async` | I3 | sandbox |
| MERGE-AUTO | Enable / disable auto-merge | `enablePullRequestAutoMerge` (private repos on a free plan can't use it, so not yet live-tested) | I3 | built |
| MERGE-QUEUE | Add to / jump / remove from merge queue | `enqueuePullRequest` (jump) / `dequeuePullRequest`; merging a queued base adds to the queue (needs an org repo to test live) | I3 | built |
| MERGE-UPDATE | Update branch by merge or rebase | `updatePullRequestBranch` | I3 | sandbox |
| MERGE-CONFLICTS | Web conflict editor (pier names the conflicting files, from a local merge) | none | gap | gap |
| MERGE-BRANCH | Delete / restore head branch | REST refs (delete; restore at the PR's last head) | I3 | sandbox |
| MERGE-REVERT | Revert a merged PR | `revertPullRequest` | I3 | sandbox |
| MERGE-BYPASS | Merge bypassing rules (with typed confirmation) | `merge-async` with `merge_action: direct_merge`, offered to admins after typing the repo's name (no rules on the sandbox's private repos, so tested in fake mode) | I3 | built |
| STACKS | Stack map, move between layers (`g j`/`g k`), merging says what it takes along, dissolve | stacks REST (2026-03-10), `merge-async` | I10 | sandbox |

## F. Dependency bumps (beyond GitHub)

| ID | Behaviour | Source | Milestone | Status |
|---|---|---|---|---|
| BOT-PARSE | Read every bump out of Dependabot and Renovate PRs | commit trailer, body, title, branch | M1a | dogfooded (202 real PRs) |
| BOT-GROUP | One decision per bump across every repo it landed in | derived | M1a | sandbox |
| BOT-GATES | Safety gates: version, release age, files, transitive deps, provenance, install scripts, advisories, checks | deps.dev, npm, GitHub | M1a | sandbox |
| BOT-APPROVE | Approve a cohort through a paced write plan | `addPullRequestReview` | M1a | sandbox |
| BOT-COMMANDS | `@dependabot rebase` / `recreate` (`b r`, `b c`); `b i` closes and skips the version (`@dependabot ignore this version`, or closing a Renovate PR) | `addComment`, `closePullRequest` | M1a | built |
| BOT-VERDICTS | Remember verdicts so new PRs for the same bump need one key | local | M1a | built |
| BOT-REVOKE | Hourly, every version with a standing verdict is looked up again; an advisory that wasn't known when you decided withdraws the verdict, cancels approvals not yet sent, and puts a notice on Deps (open PRs, with which can still merge; merged ones) until dismissed. Verified on the fake world (E2E); live needs a real advisory to land. | deps.dev | M3 | built |

## G. App

| ID | Behaviour | Milestone | Status |
|---|---|---|---|
| APP-ACCOUNTS | Every gh account in one inbox, each acting as itself | M1a | sandbox |
| APP-OUTBOX | Writes survive crashes and are never sent twice | M1a | sandbox |
| APP-INSTALL | One binary, starts at login, `pier doctor` | M1a | sandbox |
| APP-PWA | Installable window: dock badge counts PRs where it's your turn (Review and Mine); "Notify me when it's my turn" (palette) sends a system notification for each new one while pier is in the background; an open window takes captured links (`launchQueue`); dock icons on Apple's grid plus a maskable one | M1a | built |
| APP-LINKS | github.com PR links (and `/files#diff-…` line links, and `/pulls`) open in pier: `pier extension` writes a Chrome extension that redirects them. `?pier=0` (Shift+O) and links followed on github.com itself stay there. PR links inside comments open in pier directly. | M1a | sandbox |
| APP-OFFLINE | With the daemon stopped, a page load says pier isn't running (how to start it, the same page on GitHub) and opens by itself once it's back; checked in Chromium against the built binary | M1a | built |
| APP-CONTRAST | Night contrast: from 20:00 to 07:00 text and diff colours sit a tenth lower (black stays black); palette pins day or night | M3 | built |
