import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gitEnv, spawnGit } from "@/git/exec";
import { GitStore, type Spawn, gitVersionOk } from "@/git/store";

// A throwaway "GitHub": a working repo where history is written, published to a bare repo that
// GitStore fetches from over file://, the same way it fetches from github.com.

let root: string;
let work: string;
let remoteRoot: string;
const argvSeen: string[][] = [];

function sh(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      // Hooks export the parent worktree's GIT_DIR; keep every fixture command in its own repo.
      ...gitEnv(null, null),
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function commit(message: string, files: Record<string, string | null>): string {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) sh(work, "rm", "-q", path);
    else {
      writeFileSync(join(work, path), content);
      sh(work, "add", path);
    }
  }
  sh(work, "commit", "-q", "-m", message);
  return sh(work, "rev-parse", "HEAD");
}

function publish(): void {
  sh(work, "push", "-q", "--force", join(remoteRoot, "acme", "api.git"), "--all");
}

const spy: Spawn = (argv, env) => {
  argvSeen.push(argv);
  return spawnGit(argv, env);
};

let store: GitStore;
const tokensAskedFor: string[] = [];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "pier-git-"));
  work = join(root, "work");
  remoteRoot = join(root, "remote");
  sh(root, "init", "-q", "-b", "main", work);
  sh(root, "init", "-q", "--bare", join(remoteRoot, "acme", "api.git"));
  const bare = join(remoteRoot, "acme", "api.git");
  sh(bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  sh(bare, "config", "uploadpack.allowFilter", "true");
  store = new GitStore(
    join(root, "store"),
    async (login) => {
      tokensAskedFor.push(login);
      return "ghp_secret_token_value";
    },
    { remoteBase: `file://${remoteRoot}`, spawn: spy },
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("diff", () => {
  test("changes, renames, deletions, additions, binaries and spaces in paths", async () => {
    const base = commit("base", {
      "app.js": "const a = 1;\nconst b = 2;\nconst c = 3;\n",
      "old name.js": "export const x = 1;\nexport const y = 2;\nexport const z = 3;\n",
      "gone.txt": "bye\n",
      "logo.bin": "\u0000\u0001\u0002",
    });
    const head = commit("change", {
      "app.js": "const a = 1;\nconst b = 20;\nconst c = 3;\n",
      "old name.js": null,
      "gone.txt": null,
      "logo.bin": "\u0000\u0003\u0004",
      "fresh file.js": "export const fresh = true;\n",
    });
    writeFileSync(
      join(work, "new name.js"),
      "export const x = 1;\nexport const y = 2;\nexport const z = 4;\n",
    );
    sh(work, "add", "new name.js");
    sh(work, "commit", "-q", "--amend", "--no-edit");
    const amended = sh(work, "rev-parse", "HEAD");
    publish();
    void head;

    const files = await store.diff("acme/api", "binbandit", base, amended);
    const byPath = new Map(files.map((f) => [f.path, f]));

    expect(byPath.get("app.js")).toMatchObject({ status: "modified", additions: 1, deletions: 1 });
    expect(byPath.get("app.js")?.patch).toContain("+const b = 20;");
    expect(byPath.get("new name.js")).toMatchObject({
      status: "renamed",
      previousPath: "old name.js",
      additions: 1,
      deletions: 1,
    });
    expect(byPath.get("gone.txt")).toMatchObject({ status: "removed", deletions: 1 });
    expect(byPath.get("fresh file.js")).toMatchObject({ status: "added", additions: 1 });
    expect(byPath.get("logo.bin")?.patch).toBeNull();
  });

  test("whitespace-only changes disappear when ignored", async () => {
    const before = sh(work, "rev-parse", "HEAD");
    const after = commit("indent", { "app.js": "const a = 1;\n  const b = 20;\nconst c = 3;\n" });
    publish();
    expect(await store.diff("acme/api", "binbandit", before, after)).toHaveLength(1);
    // With whitespace ignored, git leaves a whitespace-only file out of the diff entirely.
    expect(
      await store.diff("acme/api", "binbandit", before, after, { ignoreWhitespace: true }),
    ).toEqual([]);
  });
});

describe("interdiff", () => {
  test("a plain push shows only the new commit", async () => {
    const base = commit("main moves", { "service.js": "line 1\nline 2\nline 3\n" });
    sh(work, "checkout", "-q", "-b", "feature");
    const reviewed = commit("feature v1", { "service.js": "line 1\nline 2 (feature)\nline 3\n" });
    const pushed = commit("address review", {
      "service.js": "line 1\nline 2 (feature, tweaked)\nline 3\n",
    });
    publish();

    const result = await store.interdiff("acme/api", "binbandit", {
      oldBase: base,
      oldHead: reviewed,
      newBase: base,
      newHead: pushed,
    });
    expect(result.fallback).toBeNull();
    expect(result.files.map((f) => f.path)).toEqual(["service.js"]);
    expect(result.files[0]?.patch).toContain("+line 2 (feature, tweaked)");
    expect(result.files[0]?.patch).toContain("-line 2 (feature)");
  });

  test("a rebase onto a newer base hides upstream changes and keeps the author's", async () => {
    sh(work, "checkout", "-q", "main");
    const oldBase = commit("base for rebase", {
      "shared.js": "top\n\n\n\n\n\n\n\nmiddle\n\n\n\n\n\n\n\nbottom\n",
      "upstream-only.js": "v1\n",
    });
    sh(work, "checkout", "-q", "-b", "rebased");
    const oldHead = commit("author v1", {
      "shared.js": "top\n\n\n\n\n\n\n\nmiddle (author)\n\n\n\n\n\n\n\nbottom\n",
    });
    publish();
    // pier fetches every head the moment it sees one, so the reviewed version survives the
    // force-push that follows.
    await store.ensure("acme/api", "binbandit", [oldBase, oldHead]);
    sh(work, "checkout", "-q", "main");
    const newBase = commit("upstream work", {
      "shared.js": "top (upstream)\n\n\n\n\n\n\n\nmiddle\n\n\n\n\n\n\n\nbottom\n",
      "upstream-only.js": "v2\n",
    });
    sh(work, "checkout", "-q", "rebased");
    sh(work, "rebase", "-q", "main");
    const newHead = commit("author v2", {
      "shared.js": "top (upstream)\n\n\n\n\n\n\n\nmiddle (author v2)\n\n\n\n\n\n\n\nbottom\n",
    });
    publish();

    const result = await store.interdiff("acme/api", "binbandit", {
      oldBase,
      oldHead,
      newBase,
      newHead,
    });
    expect(result.fallback).toBeNull();
    expect(result.files.map((f) => f.path)).toEqual(["shared.js"]);
    const patch = result.files[0]?.patch ?? "";
    expect(patch).toContain("+middle (author v2)");
    expect(patch).not.toContain("top (upstream)\n+");
    expect(patch).not.toMatch(/^[+-]top/m);
  });

  test("a conflicting rebase falls back to the whole diff and says why", async () => {
    sh(work, "checkout", "-q", "main");
    const oldBase = commit("conflict base", { "clash.js": "value = 1\n" });
    sh(work, "checkout", "-q", "-b", "clash");
    const oldHead = commit("author sets 2", { "clash.js": "value = 2\n" });
    sh(work, "checkout", "-q", "main");
    const newBase = commit("upstream sets 3", { "clash.js": "value = 3\n" });
    sh(work, "checkout", "-q", "-b", "clash-v2");
    const newHead = commit("author sets 4", { "clash.js": "value = 4\n" });
    publish();

    const result = await store.interdiff("acme/api", "binbandit", {
      oldBase,
      oldHead,
      newBase,
      newHead,
    });
    expect(result.fallback).toMatch(/conflicted/);
    expect(result.files.map((f) => f.path)).toEqual(["clash.js"]);
  });
});

describe("show and auth", () => {
  test("show returns text, and null for missing paths", async () => {
    const head = sh(work, "rev-parse", "HEAD");
    expect(await store.show("acme/api", "binbandit", head, "clash.js")).toBe("value = 4\n");
    expect(await store.show("acme/api", "binbandit", head, "nope.js")).toBeNull();
  });

  test("tokens are read per account and never appear in argv", async () => {
    expect(tokensAskedFor).toContain("binbandit");
    expect(argvSeen.length).toBeGreaterThan(0);
    for (const argv of argvSeen) expect(argv.join(" ")).not.toContain("ghp_secret_token_value");
  });

  test("git is new enough for merge-tree --merge-base", async () => {
    expect(await gitVersionOk()).toBe(true);
  });
});

describe("conflicts", () => {
  test("names the files a merge would conflict on, and nothing when it's clean", async () => {
    sh(work, "checkout", "-q", "main");
    const mergeBase = commit("conflicts: base", { "notes.md": "one\n", "other.md": "a\n" });
    sh(work, "checkout", "-q", "-b", "conflicting");
    const head = commit("conflicts: change notes", { "notes.md": "head\n" });
    sh(work, "checkout", "-q", "main");
    const base = commit("conflicts: change notes on main", { "notes.md": "main\n" });
    publish();
    expect(await store.conflicts("acme/api", "alice", { mergeBase, base, head })).toEqual([
      "notes.md",
    ]);

    sh(work, "checkout", "-q", "-b", "clean", mergeBase);
    const cleanHead = commit("conflicts: change other", { "other.md": "b\n" });
    sh(work, "checkout", "-q", "main");
    publish();
    expect(
      await store.conflicts("acme/api", "alice", { mergeBase, base, head: cleanHead }),
    ).toEqual([]);
  });
});
