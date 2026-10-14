# pier

Pull request review, one decision at a time.

pier replaces GitHub's PR pages for people who review a lot of them. A local daemon keeps a copy of every PR your gh accounts can see, so nothing you do waits on the network. Dependency bumps are decided once per bump across every repo they landed in, human PRs open on what changed since you last looked, and every write goes through a queue you can undo.

## Install

Needs macOS, [Bun](https://bun.sh), git 2.40 or newer, and [gh](https://cli.github.com) logged in to every account you review as (`gh auth login`).

```sh
git clone https://github.com/binbandit/pier.git && cd pier
bun install
bun run --filter @pier/daemon build       # builds apps/daemon/dist/pier
./apps/daemon/dist/pier install           # starts at login, restarts if it stops
./apps/daemon/dist/pier doctor --measure  # checks everything, and what syncing costs per hour
```

Then, once:

1. **Scopes.** Run the `gh auth switch … && gh auth refresh …` lines `pier doctor` prints, if any (projects, saved replies and watching PRs need them). `refresh` works on the active account, so switch back afterwards if you use several.
2. **Window.** Open http://127.0.0.1:4477 in Chrome and use its Install button: pier gets its own window and a dock badge.
3. **Bot PRs.** Settings (`⌘,`), What pier watches: watch each organisation whose Dependabot and Renovate PRs you approve. Organisations you already review in are suggested there.
4. **Notifications.** Settings, Display: send a notification when a PR becomes your turn.
5. **Links.** `./apps/daemon/dist/pier extension`, then load the folder it prints in `chrome://extensions` (Developer mode, Load unpacked). github.com PR links from Slack, email and bookmarks then open in pier; `Shift+O` still goes to GitHub.

Every github.com PR link also works with the host swapped: `github.com/acme/api/pull/12` is `127.0.0.1:4477/acme/api/pull/12`.

If the machine won't run an unsigned binary, run pier from the checkout instead: `bun apps/daemon/src/main.ts install` starts it at login the same way.

## Day to day

`g r` / `g d` / `g m` go to Review, Deps and Mine; `Tab` moves between them. `j`/`k` move, `Enter` opens, `e` marks done, `a` approves (a whole Clear bump group at once), `r` writes a review, `z` takes back anything still in its few seconds. `⌘K` finds any command or opens a pasted GitHub link, and `?` lists every key on the screen you're on.

## Develop

```sh
bun run --filter @pier/daemon dev       # daemon on :4477, restarts on change
bun run --filter @pier/web dev          # app on :4478 with hot reload
bun run check                           # format, lint, typecheck, tests
```

`PIER_HOME` keeps a separate data folder and `PIER_SANDBOX=<owner>` refuses every write outside that owner's repos, which is how live end-to-end runs stay off real work. `PIER_PORT` moves the daemon, and the app follows one port above it, so a sandbox setup can run beside your own.

## Docs

- [docs/design.md](docs/design.md): how pier works and why
- [docs/parity.md](docs/parity.md): every GitHub PR feature and where pier stands on it
