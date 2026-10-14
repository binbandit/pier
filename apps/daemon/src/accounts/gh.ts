import { type } from "arktype";

// gh is only used to discover accounts and read their tokens. Every API call after that is a
// direct HTTP request, so there is no per-request process spawn.

export type Account = {
  login: string;
  scopes: string[];
  active: boolean;
};

/** Scopes pier needs on every account. Missing ones degrade features rather than block startup. */
export const REQUIRED_SCOPES = ["repo", "read:org"] as const;
export const OPTIONAL_SCOPES = ["project", "read:user", "notifications"] as const;

const ghBinary = () => process.env.PIER_GH ?? Bun.which("gh") ?? "gh";

const statusSchema = type({
  hosts: {
    "[string]": type({
      state: "string",
      active: "boolean",
      host: "string",
      login: "string",
      "scopes?": "string",
    }).array(),
  },
});

async function gh(args: string[]): Promise<string> {
  const proc = Bun.spawn([ghBinary(), ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`gh ${args[0]} ${args[1] ?? ""} failed: ${stderr.trim()}`);
  return stdout;
}

/** Every github.com account gh is logged into, in gh's order (active account first). */
export async function discoverAccounts(): Promise<Account[]> {
  // `gh auth status` exits 1 if any account has a problem but still prints JSON for the rest.
  const proc = Bun.spawn(
    [ghBinary(), "auth", "status", "--json", "hosts", "--hostname", "github.com"],
    {
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    },
  );
  const raw = await new Response(proc.stdout).text();
  await proc.exited;
  const status = statusSchema.assert(JSON.parse(raw));
  const entries = status.hosts["github.com"] ?? [];
  return entries
    .filter((entry) => entry.state === "success")
    .map((entry) => ({
      login: entry.login,
      active: entry.active,
      scopes: (entry.scopes ?? "")
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
    }))
    .toSorted((a, b) => Number(b.active) - Number(a.active));
}

/** Reads a token fresh from gh's keyring. Called at startup and again after any 401. */
export async function readToken(login: string): Promise<string> {
  const token = (await gh(["auth", "token", "--hostname", "github.com", "--user", login])).trim();
  if (!token) throw new Error(`gh returned an empty token for ${login}`);
  return token;
}

export function missingScopes(account: Account, wanted: readonly string[]): string[] {
  return wanted.filter((scope) => !account.scopes.includes(scope));
}
