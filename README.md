# pier

Pull request review, one decision at a time.

pier replaces GitHub's PR pages for people who review a lot of them. A local daemon keeps a copy of every PR your gh accounts can see, so nothing you do waits on the network. Dependency bumps are decided once per bump across every repo they landed in, human PRs open on what changed since you last looked, and every write goes through a queue you can undo.

## Install

Needs [gh](https://cli.github.com) (logged in with `gh auth login`) and git 2.40 or newer.

```sh
bun install
bun run --filter @pier/daemon build     # builds apps/daemon/dist/pier
./apps/daemon/dist/pier install         # starts at login, restarts if it stops
./apps/daemon/dist/pier doctor          # checks everything pier needs
```

Then open http://127.0.0.1:4477 in Chrome and use its Install button to give pier its own window.

Every github.com PR link works with the host swapped: `github.com/acme/api/pull/12` is `127.0.0.1:4477/acme/api/pull/12`.

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
