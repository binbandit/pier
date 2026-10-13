import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { GitError, failure, gitEnv, spawnGit } from "@/git/exec";
import type { GitOutput, Spawn } from "@/git/exec";
import { parseDiff } from "@/git/parse";
import type { TokenSource } from "@/github/client";
import type { DiffFile } from "@pier/core/wire";

export { GitError, gitVersionOk } from "@/git/exec";
export type { GitErrorKind, GitOutput, Spawn } from "@/git/exec";
export type { TokenSource };

// The diff engine for human PRs. One bare partial clone per repo holds exactly the commits pier
// has seen (depth 1, trees only); file contents load lazily the first time a diff needs them.
// Every fetched commit gets a ref, so it outlives a force-push that removes it from GitHub.

export type GitStoreOptions = { gitBinary?: string; remoteBase?: string; spawn?: Spawn };
export type DiffOptions = { ignoreWhitespace?: boolean };
export type Versions = { oldBase: string; oldHead: string; newBase: string; newHead: string };
export type Interdiff = { files: DiffFile[]; fallback: string | null };

const OID = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
// Bumped on every use; prune ages repos by it, since git itself writes into the repo dir.
const MARKER = "pier-used";
const DAY_MS = 86_400_000;

const GONE = "Your last reviewed commit is no longer on GitHub; showing the whole diff";
const CONFLICT = "The rebase conflicted with your last reviewed version; showing the whole diff";

const decoder = new TextDecoder();
const noop = () => undefined;

export class GitStore {
  private readonly gitBinary: string;
  private readonly remoteBase: string;
  private readonly spawn: Spawn;
  private readonly tokens = new Map<string, string>();
  /** Per-repo promise chains: one git operation at a time per clone. */
  private readonly chains = new Map<string, Promise<unknown>>();
  /** Clones initialised (or re-checked) by this process. */
  private readonly opened = new Set<string>();

  constructor(
    private readonly root: string,
    private readonly readToken: TokenSource,
    options: GitStoreOptions = {},
  ) {
    this.gitBinary = options.gitBinary ?? "git";
    this.remoteBase = options.remoteBase ?? "https://github.com";
    this.spawn = options.spawn ?? spawnGit;
  }

  /** Ensures these commits (with trees; blobs lazily) exist locally for `repo` ("owner/name"), fetching as `account`. */
  ensure(repo: string, account: string, oids: string[]): Promise<void> {
    return this.exclusive(repo, (dir) => this.fetchMissing(dir, account, oids));
  }

  /** Per-file unified diff between two commits. */
  diff(
    repo: string,
    account: string,
    fromOid: string,
    toOid: string,
    options: DiffOptions = {},
  ): Promise<DiffFile[]> {
    return this.exclusive(repo, async (dir) => {
      await this.fetchMissing(dir, account, [fromOid, toOid]);
      return this.diffTrees(dir, account, fromOid, toOid, options);
    });
  }

  /**
   * What the author changed between two versions of a PR, without changes that came from
   * rebasing onto a newer base: the old head replayed onto the new base, diffed against the new
   * head. When that can't be computed, `files` is the whole PR diff and `fallback` says why.
   */
  interdiff(
    repo: string,
    account: string,
    versions: Versions,
    options: DiffOptions = {},
  ): Promise<Interdiff> {
    const { oldBase, oldHead, newBase, newHead } = versions;
    return this.exclusive(repo, async (dir) => {
      const whole = async (fallback: string) => ({
        files: await this.diffTrees(dir, account, newBase, newHead, options),
        fallback,
      });
      try {
        await this.fetchMissing(dir, account, [newBase, newHead, oldBase, oldHead]);
      } catch (error) {
        if (!(error instanceof GitError && error.kind === "missing")) throw error;
        // One fetch carries all four, so learn whether it was an old one that went missing.
        await this.fetchMissing(dir, account, [newBase, newHead]);
        return whole(GONE);
      }
      // Replaying onto an unchanged base is a no-op, so the old head itself is the replay.
      const replayed =
        oldBase === newBase ? oldHead : await this.replay(dir, account, oldBase, newBase, oldHead);
      if (replayed === null) return whole(CONFLICT);
      return {
        files: await this.diffTrees(dir, account, replayed, newHead, options),
        fallback: null,
      };
    });
  }

  /**
   * The files that conflict when merging `head` into `base`, given their merge base (the clones
   * are shallow, so git can't find it itself). Empty when the merge would be clean.
   */
  conflicts(
    repo: string,
    account: string,
    commits: { mergeBase: string; base: string; head: string },
  ): Promise<string[]> {
    const { mergeBase, base, head } = commits;
    return this.exclusive(repo, async (dir) => {
      await this.fetchMissing(dir, account, [mergeBase, base, head]);
      const output = await this.online(
        dir,
        account,
        [
          "merge-tree",
          "--write-tree",
          "--name-only",
          "--no-messages",
          `--merge-base=${mergeBase}`,
          base,
          head,
        ],
        [0, 1],
      );
      if (output.exitCode === 0) return [];
      // The new tree's id, then one line per conflicted file.
      const [, ...files] = decoder.decode(output.stdout).trim().split("\n");
      return [...new Set(files.filter(Boolean))];
    });
  }

  /** File text at a commit, or null if missing/binary. */
  show(repo: string, account: string, oid: string, path: string): Promise<string | null> {
    return this.exclusive(repo, async (dir) => {
      await this.fetchMissing(dir, account, [oid]);
      // Trees are local, so ls-tree finds the blob without touching the network; asking for
      // `<oid>:<path>` directly would try to fetch a submodule's commit as if it were ours.
      const listing = await this.offline(dir, ["ls-tree", "-z", oid, "--", path]);
      const blob = decoder
        .decode(listing.stdout)
        .split("\0")
        .map((entry) => /^\d+ (\w+) (\w+)\t(.*)$/s.exec(entry))
        .find((match) => match?.[3] === path);
      if (blob?.[1] !== "blob" || blob[2] === undefined) return null;
      const content = (await this.online(dir, account, ["cat-file", "blob", blob[2]])).stdout;
      // Git's own binary test: a NUL byte in the first 8000 bytes.
      if (content.subarray(0, 8000).includes(0)) return null;
      return decoder.decode(content);
    });
  }

  /** Deletes repos not touched for `maxAgeDays` and runs `git gc --auto` on the rest. */
  async prune(maxAgeDays: number): Promise<number> {
    const cutoff = Date.now() - maxAgeDays * DAY_MS;
    const glob = new Bun.Glob("*/*.git/HEAD");
    let removed = 0;
    for await (const head of glob.scan({ cwd: this.root, onlyFiles: false })) {
      const dir = join(this.root, head.slice(0, -"/HEAD".length));
      const deleted = await this.lock(dir, async () => {
        if ((await lastUsed(dir)) >= cutoff) {
          await this.offline(dir, ["gc", "--auto", "--quiet"]);
          return false;
        }
        await rm(dir, { recursive: true, force: true });
        this.opened.delete(dir);
        return true;
      });
      if (deleted) removed++;
    }
    return removed;
  }

  // -------------------------------------------------------------------------

  /** Runs `task` against the repo's clone, after every earlier operation on it has finished. */
  private async exclusive<T>(repo: string, task: (dir: string) => Promise<T>): Promise<T> {
    const [owner, name] = repo.split("/");
    if (!REPO.test(repo) || !owner || !name || [owner, name].some((part) => /^\.+$/.test(part))) {
      throw new GitError(`not a repository name: ${repo}`, "failed", null);
    }
    const dir = join(this.root, owner, `${name}.git`);
    return this.lock(dir, async () => {
      await this.open(repo, dir);
      await writeFile(join(dir, MARKER), "");
      return task(dir);
    });
  }

  private lock<T>(dir: string, task: () => Promise<T>): Promise<T> {
    const result = (this.chains.get(dir) ?? Promise.resolve()).then(task);
    this.chains.set(dir, result.then(noop, noop));
    return result;
  }

  /** Creates the clone, or re-asserts its config once per process; both steps are idempotent. */
  private async open(repo: string, dir: string): Promise<void> {
    if (this.opened.has(dir)) return;
    await mkdir(dir, { recursive: true });
    await this.offline(null, ["init", "--bare", "--quiet", dir]);
    const config = [
      ["remote.origin.url", `${this.remoteBase}/${repo}.git`],
      // A promisor remote is what lets diffs fetch missing blobs on demand.
      ["remote.origin.promisor", "true"],
      ["remote.origin.partialclonefilter", "blob:none"],
      // Maintenance runs from prune(), not as a side effect of whichever fetch trips it.
      ["maintenance.auto", "false"],
    ];
    for (const [key, value] of config) await this.offline(dir, ["config", key ?? "", value ?? ""]);
    this.opened.add(dir);
  }

  private async fetchMissing(dir: string, account: string, oids: string[]): Promise<void> {
    const missing: string[] = [];
    for (const oid of new Set(oids)) {
      if (!OID.test(oid)) throw new GitError(`not a commit id: ${oid}`, "failed", null);
      const present = await this.offline(dir, ["cat-file", "-e", `${oid}^{commit}`], [0, 1, 128]);
      if (present.exitCode !== 0) missing.push(oid);
    }
    if (missing.length === 0) return;
    await this.online(dir, account, [
      "fetch",
      "--quiet",
      "--filter=blob:none",
      "--depth=1",
      "--no-tags",
      "--no-write-fetch-head",
      "origin",
      ...missing.map((oid) => `${oid}:refs/pier/${oid}`),
    ]);
  }

  private async diffTrees(
    dir: string,
    account: string,
    from: string,
    to: string,
    options: DiffOptions,
  ): Promise<DiffFile[]> {
    const args = ["diff", "--no-color", "--no-ext-diff", "--find-renames", "-U3"];
    if (options.ignoreWhitespace) args.push("--ignore-all-space");
    const output = await this.online(dir, account, [...args, from, to]);
    return parseDiff(decoder.decode(output.stdout));
  }

  /** The old head replayed onto the new base, as a tree id; null when the replay conflicts. */
  private async replay(
    dir: string,
    account: string,
    oldBase: string,
    newBase: string,
    oldHead: string,
  ): Promise<string | null> {
    const output = await this.online(
      dir,
      account,
      ["merge-tree", "--write-tree", "--no-messages", `--merge-base=${oldBase}`, newBase, oldHead],
      [0, 1],
    );
    if (output.exitCode === 1) return null;
    const tree = decoder.decode(output.stdout).trim();
    if (!OID.test(tree)) throw new GitError(`git merge-tree printed no tree: ${tree}`, "failed", 0);
    return tree;
  }

  /** Git that never touches the network: a missing object is an answer, not a fetch. */
  private offline(dir: string | null, args: string[], accept = [0]): Promise<GitOutput> {
    return this.exec(args, gitEnv(dir, null), accept);
  }

  /** Git that may fetch, authenticated as `account`. A rejected token is re-read once. */
  private async online(
    dir: string,
    account: string,
    args: string[],
    accept = [0],
    retried = false,
  ): Promise<GitOutput> {
    const token = this.tokens.get(account) ?? (await this.readToken(account));
    this.tokens.set(account, token);
    try {
      return await this.exec(args, gitEnv(dir, token), accept);
    } catch (error) {
      if (retried || !(error instanceof GitError) || error.kind !== "auth") throw error;
      this.tokens.delete(account);
      return this.online(dir, account, args, accept, true);
    }
  }

  private async exec(
    args: string[],
    env: Record<string, string>,
    accept: number[],
  ): Promise<GitOutput> {
    const output = await this.spawn([this.gitBinary, ...args], env);
    if (accept.includes(output.exitCode)) return output;
    throw failure(args, output);
  }
}

async function lastUsed(dir: string): Promise<number> {
  const stats = await stat(join(dir, MARKER)).catch(() => stat(dir));
  return stats.mtimeMs;
}
