<!-- Source of truth for how pier is designed. Keep it in sync with the code; when a decision changes, change it here in the same commit. -->

# pier - a fresh pull request review system

## Context

Brayden reviews hundreds to thousands of PRs a day at work, across many repos, mostly **Dependabot/Renovate bumps** that often land identically in dozens of repos. GitHub's review UX is PR-at-a-time and split across tabs, is slow at scale, and doesn't say whose turn it is. At this volume most of the day goes on clicking through near-identical pages.

Earlier attempts in this folder (sift, paladin, Triage, in-the-loop) are **not reused, in code or shape**. They were all a GitHub-shaped list leading to a PR page, sitting on a request cache that spawns `gh` for every call. Writes were never tested live, and state was held in memory.

pier is a fresh design built on three pillars:

1. **A local replica, not a proxy.** A daemon continuously mirrors the GitHub data Brayden cares about into SQLite. The UI reads only local data, so nothing in the UI waits on the network. Writes go through a durable outbox that paces itself against GitHub's limits.
2. **Decisions attach to the change, not the PR.** A verdict on "lodash → 4.17.21" covers every PR carrying that bump, in any repo and from either bot. A human PR is just a change that lives in one PR.
3. **A "whose turn" queue, not lists and tabs.** The inbox holds only items where it's Brayden's turn, and each says why. Each item opens one focused canvas. Deciding moves straight on to the next item.

Outcome: a daily-driver installed web app at parity with GitHub for everything after a PR exists, so github.com is never needed for PR work. On top of that, throughput and safety features GitHub can't offer.

## Confirmed decisions
- Name **pier**. Lives at `/Users/brayden/Developer/systems/pier`.
- github.com only. A **unified inbox across all gh accounts**.
- Runs as an **installed web app**: a local Bun daemon plus a Chrome PWA window with dock badge and notifications.
- Most volume is bot bumps. **Brayden approves; repo automation merges.**
- Scope is **review and management of existing PRs**. No PR creation.
- The work account lives on **another machine**. Development and testing happen here, against:
  - a sandbox,
  - binbandit's real Dependabot backlog (201 open, read-only),
  - a stateful fake that runs at work scale.

  pier then gets installed on the work machine.
- Sandbox: private repos under **WastedHippie**, with **sage-smudge** opening human PRs. Approved. Making a repo public or creating an org needs a separate ask.

## Architecture

```
gh auth status --json hosts; gh auth token --user X      (startup and on 401; held in memory only)
[pier daemon: Bun.serve hostname=127.0.0.1 port=4477, single compiled binary, serves the SPA + API]
  guard     /api/* only (see Identity and security); pages/assets check Host only; no CORS;
            localhost:4477 redirects to 127.0.0.1:4477
  transport per account: serial GraphQL lane | REST lane (<=4 concurrent, ETag/Last-Modified store)
            | write lane (interactive reserve + bulk bucket) | governor driven by x-ratelimit-* headers
  store     cache.db (disposable: raw docs, projections, etags) + state.db (precious: outbox, verdicts,
            drafts, done/snooze, settings, action log)
  sync      notifications (free 304s) + delta search -> dirty; volatile sweep (hashed) -> dirty; tiered hydration
  derive    pure functions: bumps, verdict coverage, cohorts, attention -> projections (rebuilt, never migrated)
  outbox    plan -> hold -> preflight -> dispatch -> read-verify -> resolve
  git       bare partial clones per repo: diff, merge-tree interdiff, range-diff, -w, --color-moved
  api       contract-first RPC (POST /api/rpc/:name, contract in packages/core) + 1 SSE stream per
            window carrying "ids changed" (server.timeout(req, 0) on that route, 5s ping)
[web: Vite + React 19 PWA] TanStack Router/Query/Virtual, Zustand (UI state only), @pierre/diffs behind an adapter
```

### Stack and layout
- **Bun workspaces**:
  - `apps/daemon`
  - `apps/web`
  - `packages/core`: only code both sides run: the RPC contract (ArkType input schemas, plain TS output types), query-language parser, keymap and command ids. Uses relative imports only, because TypeScript resolves `@/` against whichever tsconfig is compiling. The bump parser, attention and cohort logic live in the daemon as pure modules.
- **TypeScript**: TS 7, strict, with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`. `src/` everywhere, `@/` imports.
- **Daemon**:
  - Raw `bun:sqlite` in WAL mode with one writer, typed prepared statements, numbered `.sql` migrations via `user_version`, and FTS5. No Drizzle.
  - Contract-first RPC instead of tRPC: the web app never imports daemon code, so the daemon's `@/` aliases never leak into the web typecheck, and the wire format is explicit. Handlers are typed against the contract; inputs are validated with ArkType.
  - GraphQL types via graphql-codegen (client preset) against GitHub's published schema pinned at `apps/daemon/schema/github.graphql` (`bun run schema` refreshes it; the npm `@octokit/graphql-schema` lags behind and lacks stacks, advanced search and `requestReviewsByLogin`). About 15 operations, each priced with `rateLimit(dryRun:true)` in tests.
  - REST types from `@octokit/openapi-types`. No Octokit runtime.
- **Web**:
  - Vite, React 19 with React Compiler, Tailwind v4 with CSS-first tokens, base-ui primitives, lucide icons.
  - `@pierre/diffs` (v1.5.x, virtualised CodeView, line annotations, line selection, worker-pool Shiki) wrapped behind `src/diff/adapter.ts` so its fast-moving API stays contained.
    - It renders inside a shadow DOM, so Tailwind classes can't reach its rows. Style it with CSS variables, `unsafeCSS`, and a custom Shiki theme.
    - The adapter remounts by key `(range, whitespace, file)` to work around open issue #876 (a FileDiff inside the virtualizer doesn't re-render when its diff changes).
    - Spike S7 validates all of this before M1a builds on it.
- **Tooling**: oxlint and oxfmt, bun test, Playwright, lefthook.
- **Distribution**:
  - `bun build --compile` produces one `pier` binary with the web assets embedded.
  - `pier install|uninstall|doctor|status` manage it.
  - `install` writes a launchd LaunchAgent with KeepAlive and ThrottleInterval. It records the **absolute paths of `gh` and `git`** in the plist, because a LaunchAgent's PATH has no Homebrew.
  - `doctor` checks gh, git 2.40 or newer, token scopes and the port.
  - Logs go to `~/Library/Logs/pier/`.
  - Installing on the work machine means copying the binary and running `pier install`.
    - If the unsigned binary is quarantined or blocked by MDM (e.g. Santa), the fallback is a plist that runs `bun apps/daemon/src/main.ts` from a checkout.

### Storage: raw documents plus derived projections
- **cache.db**:
  - `pr_doc(id, reader_account, tier, fetched_at, json)` with generated columns (repo, state, head_oid, updated_at).
  - `pr_viewer(pr_id, account, json)` holds per-account fields so accounts never overwrite each other: your latest review, viewed files, requests to you, notification thread.
  - `blob`/etag tables.
  - Projections (`queue_row`, `bump`, `cohort`, `attention`) are rebuilt by pure functions whenever their documents change. A schema change means deleting cache.db and resyncing.
- **state.db**:
  - outbox, verdicts, drafts, done/snooze cursors, scopes, settings, action log, escape-hatch log.
  - Backed up with `VACUUM INTO` before every migration and daily (keep 7). Migrations only ever go forward.
- **Overlay**: pending outbox commands are layered on top when views are built. Stored GitHub documents are never edited optimistically.
- **Retention**: closed PRs keep full detail for 14 days and a summary for 90. The blob/git cache is capped at about 2 GB, LRU.

### Sync engine (per account, governed)
- **Change feed**: `GET /notifications` on `X-Poll-Interval` with `If-Modified-Since`. Unchanged responses (304) are free.
- **Delta search** every 60s: one aliased GraphQL `ISSUE_ADVANCED` request.
  - It covers the personal scopes (`review-requested`, `review-involves`, `author`, `assignee`, `mentions` @me) and the configured **owner/org × bot-author scopes**, filtered with `updated:>=watermark-3m`.
  - Any scope over 1,000 results is split by `created:` ranges. Delta search is how bot PRs are found at all; personal searches miss them.
- **Volatile sweep**: catches CI and mergeability changes, which don't bump `updatedAt`.
  - `nodes(ids:)` in batches of 100 fetches state, headRefOid, mergeable, mergeStateStatus, reviewDecision, autoMergeRequest and the rollup state.
  - Each result is hashed per PR; a changed hash marks the PR dirty.
  - Hot PRs (CI pending, on screen, just written to) are swept every 60s; warm ones every 10 min.
- **Tiered hydration**:
  - Bot tier: 100 per batch with file paths, stats and commits with author and signature. About 4 points per 100 PRs.
  - Full tier: 20 per batch (threads, timeline, reviews, rollup with `isRequired`). About 0.6 points per PR.
  - Viewer fields are fetched only for the involved account.
- **Focused PR**: conditional REST GETs every 5-10s on `/pulls/n` and `/commits/{sha}/check-runs`.
- **Budget**: about 900-1,000 of 5,000 GraphQL points/hr at work scale (300 repos, about 2,150 open PRs). The governor slows the sweeps when the remaining points fall below what's needed until the reset.
- **Background mode**: when the machine's UI hasn't been focused for 10 min, only the volatile sweep and hydration slow down, because rate limits are per user across all machines. Notification polling and delta search always run, so the dock badge and notifications stay live.
- **Multiple accounts**:
  - PRs are deduplicated by node id (`X-Github-Next-Global-ID: 1`).
  - Each repo has one reading account.
  - The acting account is the involved one. For bot PRs, where no account is involved, it's the repo's reading account, overridable per org.

### Git store (the diff engine)
- **Layout**: one bare repo per owner/repo. Fetch with `--filter=blob:none --depth=<commits+1>` for `refs/pull/N/head` plus the base commit. File contents download lazily.
- **Auth**: the token goes to each git process through `GIT_CONFIG_COUNT/KEY/VALUE` (`http.https://github.com/.extraheader`), never on the command line. `credential.helper=` is set empty and `GIT_TERMINAL_PROMPT=0`. gh's credential helper only serves the active account (verified).
- **Human PRs**: fetch every head as soon as it's seen, because force-pushed heads can become unfetchable later. "Since your last review" works like this:
  - `oldMB` and `newMB` are the merge bases from REST compare `merge_base_commit`.
  - Fetch oldHead, newHead, oldMB and newMB by SHA at depth 1 with `blob:none`.
  - Run `git merge-tree --write-tree --merge-base=oldMB newMB oldHead` and diff the resulting tree against newHead. The result is only the author's real changes, with rebase noise removed.
  - If merge-tree exits 1 (conflict) or the old head can't be fetched, show the full diff with a banner.
  - `range-diff` is used for the commit view.
  - Needs git 2.40 or newer (Homebrew git is 2.56 here).
- **Bot PRs**: classify from GraphQL file paths and commit metadata. The representative diff comes from REST `GET /pulls/{n}/files` in M1a (so M1a doesn't depend on the git store) and from the git store once M1b lands.
- **Lockfile changes** (including "+N new transitive"): use the dependency review API (`/dependency-graph/compare/{basehead}`) where it's available, otherwise a git diff of the lockfile.
- **Maintenance**: `git gc`, and refs expire 14 days after a PR closes. `pier doctor` checks for git 2.40 or newer.

### Writes: outbox and write planner
- **Outbox states**: `held → queued → claimed (saved to disk before sending) → acked | unknown → resolved`.
  - Writes left unknown after a crash or timeout are confirmed by reading GitHub, never by blindly retrying:
    - reviews: match account + commit + state + body hash
    - comments: body hash
    - merges: 409 UUID or merged state
    - commits: parent and message
  - Writes that are safe to repeat (labels, resolve, viewed) are simply retried. Anything still ambiguous is put to Brayden.
  - M1a only needs the review probe. The others arrive with the writes they protect.
- **Write plan per PR, minimum writes**:
  - Brayden's flow is **approve-only**, and automation merges.
  - Skip PRs he has already approved at the current head, PRs that are closed or superseded, and PRs where no review is required (unless he opts into approving anyway).
  - Flag PRs where approving won't lead to a merge ("nothing armed to merge"), and offer to enable auto-merge.
- **Pacing**:
  - The limit that matters is content creation: 500/hr per user, shared with github.com and every other machine.
  - M1a uses one prioritised bucket per account: at most 350/hr, 60/min, writes at least 1s apart.
  - M1b, which adds human-PR writes, splits it into an interactive reserve (about 100/hr) and a bulk bucket. Human-PR writes always go ahead of bulk sweeps.
  - A 403/429 for secondary limits pauses that account's lane until `retry-after` passes.
  - Before any fan-out, a preview strip shows the write count, time estimate, share of the hour and per-account split.
- **Merge path**: `PUT /pulls/{n}/merge-async` is the only merge path, with `sha`, `bypass_rules:false` and an explicit `merge_action`.
  - Use `enqueuePullRequest(jump)` for jumping the queue.
  - Use `mergePullRequest(authorEmail)` only for the author-email edge case.
  - At most one merge in flight per repo. Sibling PRs get marked "expect rebase".
  - Repos that dismiss stale approvals get approved one bump at a time.
- **Undo**:
  - Single approve, merge or close waits 5s before sending, with an undo toast.
  - For bulk actions, the queue is the undo: anything not yet sent can be cancelled.
  - A merge always shows as "merging…", never optimistically as "merged".
- **Head guards**: every mutation carries `commitOID`/`expectedHeadOid` = the SHA on screen. The preflight step re-reads heads just before sending.

### Identity and security
- **One person**: all linked gh accounts are treated as one person.
  - Hard-block approving your own PR with an alt account.
  - Hard-block two linked accounts approving the same PR.
  - Never move a write to another account for more rate limit (GitHub's terms).
  - A 401 holds the queue and never switches accounts.
  - Sandbox config can mark accounts as separate people, for testing.
- **Threat model**: other websites, other localhost origins, and **content written by PR authors**. XSS on pier's origin could approve and merge. Programs running as Brayden are out of scope: they can already run `gh auth token`.
- **API guard**:
  - RPC accepts POST only and requires an exact Origin (including port), the `X-Pier` header and `Sec-Fetch-Site=same-origin`.
  - The SSE GET checks Host and `Sec-Fetch-Site=same-origin`. `EventSource` can't send custom headers, and browsers omit `Origin` on same-origin GETs.
  - Pages and assets check Host only, because typed URLs and PWA launches arrive with `Sec-Fetch-Site: none`.
  - Nothing that changes state is reachable by GET.
- **CSP**: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; img-src 'self' data: blob:; frame-src 'self'`. No Trusted Types, because @pierre/diffs writes `innerHTML`.
- **Untrusted content**:
  - DOMPurify runs over every `bodyHTML`; raw changelog markdown is never rendered.
  - Mermaid, SVG and notebooks render in sandboxed iframes or as `<img>`.
  - Private-repo images are cached by the daemon at hydration time, because their signed URLs expire.
- **Bypassing branch rules** needs a separate confirmation where Brayden types the repo name.

## Domain model

### Bumps, verdicts, cohorts
- **Bump**: `(ecosystem, package, from, to, directory, dependency-type)`.
  - Parsed from Dependabot's `updated-dependencies` commit metadata, falling back to title/body.
  - Renovate bumps come from the body table and branch name.
  - Normalised for casing, `in /dir` suffixes and group names.
  - A PR (including grouped Dependabot PRs) contains one or more bumps.
- **Verdict**: Brayden's decision on `(ecosystem, package, to-version, semver class)`.
  - Pressing `a` in a group records a verdict for each semver class present in the cohort being approved. A major in Look needs its own decision.
  - A PR is **covered** when every bump in it has a verdict.
  - Verdicts expire after 14 days by default.
  - New PRs that a verdict covers arrive as "+5 covered by your verdict (2h ago)" and need one key.
  - Advisories are checked at preflight against the GitHub advisory database (`securityVulnerabilities`). The revocation banner, with lists of unmerged PRs to close and merged ones to revert, comes in M3.
- **Multi-bump PRs** (grouped Dependabot): the PR shows up in each of its bump groups.
  - It is Clear only if **every** bump in it passes the gates.
  - The preview strip lists the other bumps it carries, and approving it records verdicts for all of them.
- **Group view**: all open PRs sharing a `(package, to-version)`, split into three cohorts:
  - **Clear** passes every safety gate.
  - **Look** fails a gate, and each row shows why.
  - **Stuck** covers failing CI, conflicts, **no checks at all** (never counted as green), or **stale** (old, or the base's manifest/lockfile has moved). The default action for Stuck is `@dependabot recreate`/`rebase`, or re-running failed jobs.
- **Safety gates for Clear**, all in M1:
  - semver patch or minor;
  - target release at least 3 days old (npm `time` / deps.dev; lookups are skipped for configured private scopes);
  - only the ecosystem's manifest and lockfile paths touched;
  - no unexpected new transitive dependencies;
  - commit provenance passes the bot's policy (see below);
  - no new install script;
  - no advisory against the target version;
  - at least one check reported.

  The transitive-dependency and install-script gates are only evaluated where it's cheap: npm lockfiles, or where the dependency review API is available. Elsewhere they show "n/a" rather than failing.
- **Commit provenance** is a per-bot setting in deps policy:
  - allowed author apps or users;
  - whether signed commits are required (self-hosted Renovate is often unsigned);
  - whether base-only merge commits ("Update branch") are allowed.

  Any other human commit on the branch moves the PR to Look.
- **Merges**: Dependabot's `merge`, `close` and `reopen` comment commands were retired (2026-01-27). Only `rebase`, `recreate` and `ignore` remain. These are fire-and-observe: wait for the bot's push or reply, time out, and report what happened.

### Attention ("whose turn"), per PR and per account
It's Brayden's turn when:
- he's requested and hasn't reviewed since the last push;
- he reviewed and the author has since pushed or replied;
- it's his own PR with changes requested, red checks, conflicts or new comments;
- it's his PR, approved and green, with nothing armed to merge;
- he's mentioned;
- or it's a bump group with uncovered Clear/Look PRs.

How done and snooze behave:
- **Done** stores an event cursor. The item comes back only on activity from someone other than his accounts. For bot PRs, that means a version change or a human comment, not a Dependabot rebase.
- Marking done also marks the GitHub notification done, in every account that has it.
- **Snooze** takes a time or a condition: until checks finish, next push, author reply, or approval.

## UX

### Surfaces (URLs mirror github.com where they overlap)
| Surface | URL | Purpose |
|---|---|---|
| Inbox | `/inbox/:split` | Only items where it's your turn. **Review** (human PRs), **Deps** (bump groups by cohort), **Mine** (your PRs needing you). Saved searches can become extra splits. `Tab` cycles splits. |
| PR canvas | `/:owner/:repo/pull/:n?v=3..5&f=path:L120` | One focused page, no tabs. Swapping github.com for pier's host on any URL just works. |
| Group canvas | `/deps/:ecosystem/:package/:version` | One bump across every repo. |
| In flight | `/flight` | Everything that isn't your turn: waiting on others, CI running, merging and queue position, your sent reviews, "nothing armed to merge". |
| Search / views | `/search?q=`, `/v/:slug` | GitHub qualifiers plus `cohort: verdict: turn: semver: acct: checks: size:`. |
| Log | `/log` | The outbox per account: queued, sent, failed, budget, retry, cancel. |

Settings (`Cmd+,`): accounts and scope health, watched orgs and repos, deps policy and gates, keymap, contrast schedule.

### First run
1. **Accounts**: one dot per scope for each detected account. Where a scope is missing, show the exact `gh auth switch -u X && gh auth refresh -s …` commands (refresh only works on the active account); `y` copies them.
2. **Orgs**: discovered from recent notifications and review requests, with counts. On by default; you exclude repos rather than picking them. Each org has one toggle: "all bot PRs" or "only where I or my team is requested".
3. **Deps policy**: pre-filled with the safety gates.
4. **Initial sync**: the inbox fills in while it runs, and the status line shows "syncing 1,284 PRs · ~2 min". No blocking spinner.

### Rows (40px; 32px in compact mode)
Each row reads `status dot · subject · context · reason · age · acting-account avatar`.
- A human PR: `#4821 Fix token refresh · acme/api · alice +120 −34 · pushed 2 commits since your approval · 3h`
- A bump group: `lodash 4.17.20→4.17.21 · npm patch · 37 repos · ▮▮▮▮▯ 34 clear 1 look 2 stuck`
- `Space` opens an inline peek. `w` explains why the item is here, listing each rule with failures in amber.

### Group canvas
- **Header**: package, from-version spread, semver class, release age, advisory and provenance, changelog and registry links, and a safety-gate checklist.
- **Cohort tables**: one row per repo showing directory, checks, mergeable, whether approval is required, merge path (auto-merge, queue or none armed) and acting account.
- **Shown once**: sanitised release notes, one representative manifest diff, and the lockfile summary. A repo whose changed-file set or +/− stats differ from the representative gets a badge.
- **Actions**:
  - `a` approves the whole Clear cohort through the preview strip.
  - `x` selects rows to act on a subset.
  - `D` detaches the selected rows into standalone items.
  - `b` chord sends bot commands.

### PR canvas
- **Layout**: file tree (260px, hidden for 10 files or fewer) | diff stream | activity rail (380px, `i` toggles, shown by default at 1600px and wider).
- **The stream, top to bottom**:
  1. Header with title, a single metadata line (base←head, author, labels, assignees, reviewers with turn markers, milestone, projects, linked issues; each edited inline through an `s` chord picker).
  2. Turn line ("Your turn: alice pushed after you requested changes").
  3. "Since you last looked" digest of new commits, comments and CI changes.
  4. Files in review order: source, then tests, then config. Generated files, lockfiles and snapshots start collapsed.
- **Threads**: inline in the diff. Outdated threads render from their `diffHunk` next to the nearest hunk; threads on unchanged lines are never dropped.
- **Versions**: a version strip `v1 v2 v3◆ v4 v5` (◆ = your last review). **Re-reviews open on "since your last review"** by default, computed via merge-tree. `p` picks a range.
- **Large PRs**: a progress line ("14/63 files · 1,240/3,100 lines") with lazy loading, plus pier's own find, because Cmd+F can't see virtualised lines.
- **Status line**: a 28px bar along the bottom showing:
  - acting account, sync freshness, outbox progress;
  - which-key hints for chords;
  - a one-glance merge-readiness summary.
- **Review composer**: `r` raises it from the status line as an inline panel. **New threads are drafts; replies post immediately.**
  - Drafts are stored locally per account+PR+SHA, re-anchored after a push or flagged as outdated, and submitted with the review event (comment / approve / request changes) in one write.
  - A pending review started on github.com is detected and adopted.
- **Merge runway**: `m` raises it. It explains blockers using the rules API, `mergeStateStatus` and `isRequired`, with one-key fixes (update branch, re-run failed jobs, enable auto-merge, request a code owner).
- **After deciding**: submitting or pressing `e` moves to the next item in the same split. When the split is empty: "Review clear · Tab → Deps (31)".

### Keymap
A single command registry drives the shortcuts, the `Cmd+K` palette (which also opens pasted URLs) and the `?` cheatsheet.

- **Scope stack**: panel, then canvas, then global. A raised panel (composer, merge runway, picker) owns the keys until `Esc`, so its `a`/`e`/`Enter` never fire approve, done or open.
- **Superhuman muscle memory is kept.** Vim keys are limited to `j/k`, `G` and `Ctrl-d/u`, so there's no `gg` clash with the `g` chord.

| Key | Action |
|---|---|
| `j/k`, `J/K` | Next/prev row or line · next/prev hunk (in the queue, `J/K` extends the selection) |
| `/` | Find within the canvas (also `Cmd+F`, since virtualised lines defeat browser find). Search everywhere else. |
| `]/[` `}/{` | Next/prev file · next/prev queue item |
| `n/N` | Next/prev unresolved thread |
| `Enter`/`o`, `u`/`Esc` | Open, back/close |
| `Space`, `x`, `w` | Peek, select, why |
| `e/E`, `h`, `z` | Done and advance / undo done, snooze (time or condition), undo (anything not yet sent) |
| `a`, `A`, `R`, `r` | Approve, approve and ship, request changes, review composer |
| `c`, `C`, `V`, `v` | Comment, comment with suggestion, select line range, mark viewed and jump to next unviewed |
| `t/T`, `i`, `p` | File finder / toggle tree, activity rail, version range |
| `m`, `M` | Merge runway, merge now if nothing blocks |
| `s` chord | `l` labels `a` assignees `r` reviewers `m` milestone `p` projects `d` draft/ready `b` base `k` lock `c` close/reopen |
| `f` chord | `r` re-run failed `a` re-run all `u`/`U` update branch (merge/rebase) `x` cancel run `l` failing log |
| `b` chord | `r` rebase `c` recreate `i` ignore (version/minor/major/dependency) |
| `d` chord | `w` whitespace (no reload) `s` split/unified `g` generated files `p` syntax colour |
| `g` chord | `i` inbox `r` Review `d` Deps `m` Mine `f` In flight `l` Log `s` views |
| `D`, `y/Y`, `!`, `@` | Detach rows, copy URL/branch, mute thread, choose acting account |
| `Shift+O` | Open on github.com. Appends `?pier=0` so the link-capture extension lets it through, and logs a free-text reason. |
| `Cmd+K`, `?` | Palette, cheatsheet |
| Composer | `Cmd+Enter` draft (a reply sends) · `Cmd+Shift+Enter` post now · `Cmd+G` suggestion · `Ctrl+1/2/3` review event |
| Merge runway | `1/2/3` merge method · `e` edit message · `q` merge queue · `a` auto-merge · `Enter` merge |

### AMOLED design system
Grounded in Brayden's achroma OLED ramp and Eventide's rule that "nothing screams".
```
/* OLED rule: scrolling areas use only #000 or fills >= #121212. No values between #010101 and #0f0f0f, no gradients. */
--bg:#000; --raise:#0d0d0d (static overlays only)
--fill-hover:#121212; --fill-cursor:#171717; --fill-press:#1e1e1e; --fill-selected:rgb(157 124 216/.14)
--line:#1e1e1e; --line-strong:#282828; --line-max:#3c3c3c
--text-strong:#e6e6e6 (titles); --text:#cccccc (body+code); --text-muted:#a4a4a4; --text-faint:#7a7a7a; --text-off:#505050
--accent:#9d7cd8 (cursor bar, focus ring, selection only)
--ok:#89ad72; --bad:#cc7b7b; --warn:#d4a84e; --info:#7294ba; --auto:#6aadad (bot/queued/covered)
merged/closed = --text-faint (finished items fade)
--add-row:#131810; --del-row:#1d1111; --add-word:#263020; --del-word:#3a2323; 2px gutter bar in --ok/--bad
syntax: achroma mono by default (keyword #e6e6e6 w500, fn #cccccc, ident #b8b8b8, string #a4a4a4,
        comment #7a7a7a italic); optional "pop" mode uses violet/teal/amber/blue, never green or red
```
- **Type**:
  - UI uses Inter Variable with tabular numerals: 13 metadata, 15 UI, 16 prose (max 72ch, line-height 1.6), 20 section, 24 PR title at weight 600.
  - Code uses MonoLisa Variable at 14px on a 22px line, falling back to Ioskeley and JetBrains Mono.
- **Spacing**: 4px grid. Diff lines are 22px.
- **Motion**:
  - The keyboard cursor moves instantly; jumps flash the target for 160ms.
  - Panels animate over 120ms with a fade and 4px slide.
  - No fades over large areas (they smear on OLED).
  - Reduced motion turns all motion off.
- **Focus**: the keyboard cursor is `--fill-cursor` plus a 2px accent bar. Hover only changes the fill. Status uses 6px dots with muted labels; badges are for counts only. No modals where an inline panel works.
- **Contrast schedule**: ported from achroma's `adaptive_contrast`. From 20:00 to 07:00 every text grey, and the diff syntax theme, is scaled to 90% (`--text` #cccccc becomes #b8b8b8); black stays black. The palette pins day or night (`stores/contrast.ts`).
- **Dock badge**: counts human PRs where it's your turn only. Bumps are batched chores, not interruptions.

## Parity
`docs/parity.md` is the source of truth and the dogfood checklist. It is written from the research inventory, with one row per feature and a stable id (for example `FILES-COMMENT-UNCHANGED`).

Columns:
- ID
- Area
- GitHub behaviour (doc link)
- API (or "none")
- Milestone
- Status: `not started → built → sandbox-verified → dogfooded`

Usage tooling waits until after dogfooding starts, and only if the free-text escape log turns out not to be enough. That includes escape counts per parity id and promotion rules.

The inventory covers these areas:
- **A, finding PRs**: inbox sections, search qualifiers, views, notifications triage.
- **B, conversation**: GFM, all timeline event types (with a generic fallback), comment actions, sidebar metadata, lifecycle.
- **C, files**: commit picker, filters, viewed state, comments of every kind, suggestions, pending reviews, rich diffs, annotations.
- **D, checks**: runs, logs, re-runs, fork approvals, deployments.
- **E, merge**: methods, auto-merge, queue, update branch, conflicts, branch delete/restore, revert, stacks.
- **F, review management**: requests, re-requests, dismissals, CODEOWNERS.
- **G, Copilot and stacks.**
- **H, miscellaneous**: `.diff`/`.patch`, checkout command.

Known API gaps and their workarounds:
| Gap | Workaround |
|---|---|
| Applying suggestions | Build the commit with `createCommitOnBranch` using `expectedHeadOid` and Co-authored-by trailers |
| "Owned by you" | Parse CODEOWNERS (last match wins) |
| Merge blockers | Reconstruct from `rules/branches/{b}` plus the rollup |
| Saved replies | Store locally; import needs the `read:user` scope |
| Projects | Needs a `read:project`/`project` scope refresh |
| Image upload | No token API; accepted gap, use the escape hatch |
| Conflict editor | Accepted gap; `recreate` covers bot PRs |
| "Saved" notifications | Accepted gap |

## Delivery sequence
Each step ships on its own and is verified against the fake, then the sandbox, then real use.

0. **Scaffold**:
   - Repo with `git init`, commits as Brayden, conventional commits, no attribution trailers.
   - Workspaces, tooling, `docs/parity.md` written from the inventory.
   - A design-token route (`/_tokens`) that renders every token, type size and diff state for the pixel pass.
1. **Sandbox setup**: private repos under WastedHippie.
   - First check whether rulesets, required reviews and auto-merge actually work on them. On a free plan they may not.
   - If not, **ask Brayden** before making any sandbox repo public or creating a free org. A merge-queue test needs an org-owned repo.
2. **Spikes**, run against the sandbox; results go into parity.md:
   - **S1 write semantics**:
     - Does an approval with an old `commit_id` count toward required reviews?
     - What happens to a pending review started on the web?
     - How does `addPullRequestReviewThread` anchor when head has moved?
     - Can we comment on unchanged lines through the API?
     - merge-async: 409 and SHA mismatch.
   - **S3 install**:
     - PWA install on `127.0.0.1:4477`.
     - Badge plus notification permission.
     - Redirected links open in the PWA window (`launch_handler: focus-existing`), not a tab.
     - `?pier=0` passes through the extension.
     - The launchd binary can read gh's keychain tokens.
     - Service-worker update.
   - **S4 content-creation accounting**: which writes count. Ramp slowly and stop at the first 403.
   - **S6 git store**: partial-clone fetch by SHA and auth per account, plus the merge-tree interdiff on a real force-push.
   - **S7 diff renderer**: @pierre/diffs with the AMOLED theme (CSS variables, `unsafeCSS`, Shiki theme), 22px rows, gutter bar, line cursor, annotations, the remount-key workaround, and j/k performance on a 5,000-line diff.
   - Deferred spikes: S2 (`createCommitOnBranch` on forks, file modes, CRLF, signed-commit rules) runs just before I7, and S5 (stacks through merge-async) just before I10.
3. **M1a, bot throughput**:
   - accounts, transport, governor, cache and state databases, sync (delta search with owner × bot scopes, volatile sweep, bot tier);
   - bump parser, verdicts, cohorts and safety gates;
   - Deps split and group canvas (representative diff from REST files through the diff adapter);
   - write planner and outbox (approve-only flow, preview strip, a single pacing bucket, undo, review probe);
   - In flight and Log;
   - status line, command registry with scope stack, palette;
   - PWA, `pier install`, a small MV3 link-capture extension (redirects github.com PR URLs to pier unless `?pier=0`);
   - `Shift+O` escape hatch with reason logging.
4. **M1b, human review**:
   - PR canvas with the git-store diff through @pierre/diffs, file tree, threads (read, reply, resolve);
   - drafts and one-shot submit bound to the SHA, pending-review adoption;
   - since-last-review interdiff, viewed sync (`markFileAsViewed`, files that changed after being viewed);
   - checks list, basic merge runway;
   - Review and Mine splits, notification done-sync;
   - interactive/bulk write buckets.

   After M1b: **install on the work machine**. Run `pier doctor --measure` (read-only: volume, query costs, scope health) and tune the budgets. Then add the contrast schedule and the screenshot baselines.
5. **Increments to full parity**, in order:
   - I2 checks depth: annotations inline, logs, re-run single job, debug logging, cancel, fork approvals, deployments.
   - I3 merge completeness: update branch, queue jump, delete/restore branch, revert, bypass.
   - I4 commit picker: list with signatures, single commit, range.
   - I5 CODEOWNERS: owned-by-you and filters.
   - I6 conversation and sidebar: edits, history, reactions, minimize, delete, quote, reviewers including teams/Copilot/suggested, labels, assignees, milestone, draft, close, base, lock, subscribe, archive.
   - I7 suggestions: single and batch apply.
   - I8 search and inbox: full query language, saved views, notifications parity.
   - I9 rendering: rich diffs, mermaid, math, large PRs, `.diff`/`.patch`.
   - I10 the rest: stacks UI, projects, saved replies.
6. **M3, beyond GitHub**: user-editable gate rules, advisory revocation of verdicts, moved-code and formatting-noise suppression, provenance and maintainer-change signals, local-state sync across machines (dotfiles or iCloud; never a gist), review stats.

## Correctness guards
| Trap | Guard |
|---|---|
| Comment lands on the wrong line after a push | Drafts store SHA, path, side, line(s) and the anchored line text. At submit, re-map through the interdiff. If the text changed, block with "re-anchor"; never shift silently. |
| Commenting in a range view | Only the RIGHT side, or LEFT lines that exist in the base. Lines that exist only in an old head are disabled. |
| Outdated thread placement | `line == null` means outdated: render from `diffHunk`/`originalCommit`. |
| Pending review started on the web | Query that account's PENDING review when the PR opens. Offer adopt, submit, or open on GitHub. Never create a duplicate. |
| Applying suggestions | Head must equal the SHA seen. The thread must not be outdated. Original lines must still match. Overlapping suggestions are rejected. Splice bottom-up and keep EOL, final newline and BOM. Refuse binary, LFS and symlinks. Fork PRs need maintainer edit access. |
| Approving after the head moved | `commit_id` = the SHA on screen. Preflight aborts with "N new commits". Bulk approvals re-check head SHAs and the commit-provenance gate at preflight. |
| Merging a stale head | merge-async with `sha` and `bypass_rules:false`. Auto-merge uses `expectedHeadOid`. |
| Bulk run on stale data | Re-read the selected PRs with the light query (100 per call) before dispatch. |
| Crash during a write | Probe states as described in the outbox section. Unsent commands older than 10 min need re-confirmation. |
| Wrong account | Acting-account avatar on every review bar and preview. Self-approval and alt-account approvals are blocked. A 401 holds the queue. |
| Clock drift | Compare GitHub server timestamps only. Echo `Last-Modified` back exactly. Snoozes are stored as UTC instants. |
| Concurrent body or task-list edits | Fetch, 3-way merge the toggle, abort on conflict. |

## Verification
- **Unit and property tests** (bun test):
  - bump parsing against a corpus of real Dependabot/Renovate titles, bodies and commit metadata (built from binbandit's 201 PRs, kept local);
  - cohorts and gates, attention, query parser;
  - line anchoring and re-mapping on randomly generated diffs;
  - suggestion splicing (CRLF, no final newline, overlaps), CODEOWNERS matching, blocker explanation;
  - write planner and outbox state machine.
- **Schema drift**: codegen typecheck against the pinned GraphQL schema. Every operation's point cost is asserted with `rateLimit(dryRun:true)`.
- **Stateful fake GitHub** at the operation level, with matching local git remotes (`file://`).
  - **Scale scenario**: 300 repos, 2,000+ PRs, realistic bump distribution. This stands in for work volume.
  - **Fault injection**: 403/429 with `retry-after`, 409 head mismatch, 502, and a write that succeeds but whose response is dropped.
- **Playwright**: runs against the built binary in fake mode, including killing the daemon mid-run. Flows covered: sweep a group, approve with undo, re-review with interdiff, draft → submit, merge runway.
- **Visual pass**:
  - Chrome screenshots of every surface and the `/_tokens` page, reviewed for pixel issues.
  - j/k must stay instant on a 5,000-line diff (perf budget asserted in E2E).
  - Playwright `toHaveScreenshot` baselines come after M1b.
- **Live sandbox**:
  - Repos under WastedHippie with deliberately outdated npm, cargo, go, actions and docker dependencies, a `dependabot.yml` with daily schedule and groups, and the same package outdated in several repos.
  - Rulesets with required review and auto-merge workflows. Plan limits are handled per step 1.
  - sage-smudge opens human PRs and force-pushes, with linked identities turned off in sandbox config.
  - In test mode the transport refuses any write outside the sandbox owners.
- **Dogfood**: on the work machine after M1b. Parity rows move to "dogfooded" once the feature is used for real with no escape.
- **Before every commit**, run `/verify`.
- **At the end of each milestone**, run an adversarial code review and a UX critique of fresh screenshots against this spec, then fix what they find.
