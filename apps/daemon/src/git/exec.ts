// Running git: one place that builds the environment, spawns the process, and turns failures into
// GitErrors. pier owns these repos outright, so the user's own git config is shut out: a global
// `diff.noprefix`, `url.insteadOf` or per-host credential helper would otherwise change what we
// parse or which account a fetch runs as.

const GITHUB = "https://github.com";
// A backstop for a stalled network; real fetches and diffs finish in seconds.
const TIMEOUT_MS = 5 * 60_000;

export type GitErrorKind =
  /** The token was rejected, or git wanted credentials it doesn't have. */
  | "auth"
  /** The remote doesn't have a requested commit (e.g. a head that was force-pushed away). */
  | "missing"
  | "failed";

export class GitError extends Error {
  constructor(
    message: string,
    readonly kind: GitErrorKind,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export type GitOutput = { exitCode: number; stdout: Uint8Array; stderr: string };

/** Starts git and collects its output. Injectable so tests can watch every argv and env. */
export type Spawn = (argv: string[], env: Record<string, string>) => Promise<GitOutput>;

export const spawnGit: Spawn = async (argv, env) => {
  let proc;
  try {
    proc = Bun.spawn(argv, {
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: TIMEOUT_MS,
    });
  } catch (error) {
    throw new GitError(`git could not start: ${String(error)}`, "failed", null);
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.bytes(),
    proc.stderr.text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
};

/**
 * The environment for one git process. With a token, network access (fetches and the lazy blob
 * loads a partial clone does mid-diff) authenticates as that token's account; without one, git
 * is kept offline so a lookup can never turn into a fetch.
 */
export function gitEnv(gitDir: string | null, token: string | null): Record<string, string> {
  const config: [string, string][] = [
    ["core.quotePath", "false"],
    // No credential helpers: gh's would answer as whichever account is active, not the one asked for.
    ["credential.helper", ""],
  ];
  // Config through the environment keeps the token off the command line and out of every file.
  if (token !== null) {
    const basic = btoa(`x-access-token:${token}`);
    config.push([`http.${GITHUB}/.extraheader`, `AUTHORIZATION: basic ${basic}`]);
  }

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_") && key !== "SSH_ASKPASS") env[key] = value;
  }
  Object.assign(env, {
    LC_ALL: "C",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_LITERAL_PATHSPECS: "1",
    GIT_CONFIG_COUNT: String(config.length),
  });
  for (const [index, [key, value]] of config.entries()) {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  }
  if (gitDir !== null) env.GIT_DIR = gitDir;
  if (token === null) env.GIT_NO_LAZY_FETCH = "1";
  return env;
}

const AUTH_FAILURE =
  /authentication failed|could not read (username|password)|terminal prompts disabled|invalid username or (password|token)|returned error: 40[13]/i;
const MISSING_OBJECT =
  /not our ref|unadvertised object|couldn't find remote ref|no such remote ref/i;

/** A git process that exited badly, named by subcommand. The token is never in argv, so never here. */
export function failure(args: string[], output: GitOutput): GitError {
  const stderr = output.stderr.trim();
  const kind = AUTH_FAILURE.test(stderr)
    ? "auth"
    : MISSING_OBJECT.test(stderr)
      ? "missing"
      : "failed";
  return new GitError(
    `git ${args[0] ?? ""} exited ${output.exitCode}: ${stderr}`,
    kind,
    output.exitCode,
  );
}

/** pier needs `git merge-tree --write-tree --merge-base`, which arrived in git 2.40. */
export async function gitVersionOk(gitBinary = "git"): Promise<boolean> {
  try {
    const output = await spawnGit([gitBinary, "--version"], gitEnv(null, null));
    const match = /(\d+)\.(\d+)/.exec(new TextDecoder().decode(output.stdout));
    const major = Number(match?.[1] ?? 0);
    const minor = Number(match?.[2] ?? 0);
    return output.exitCode === 0 && (major > 2 || (major === 2 && minor >= 40));
  } catch {
    return false;
  }
}
