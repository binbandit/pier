import { existsSync } from "node:fs";
import { join } from "node:path";

import { discoverAccounts, readToken } from "@/accounts/gh";
import { createHandlers } from "@/api/handlers";
import { createApp } from "@/app";
import { doctor } from "@/cli/doctor";
import { install, uninstall } from "@/cli/install";
import { ORIGIN, paths } from "@/config";
import { GitStore, gitVersionOk } from "@/git/store";
import { GitHubClient } from "@/github/client";
import { LiveGitHub } from "@/github/live";
import type { GitHubPort } from "@/github/port";
import { serve } from "@/http/server";
import { openStores } from "@/store/db";

// The `pier` command: the daemon itself, plus the commands that install and check it.

const HELP = `pier: pull request review, one decision at a time

  pier serve        run the daemon in the foreground
  pier install      start pier at login (launchd) and keep it running
  pier uninstall    stop starting at login (your data stays)
  pier doctor       check gh, git, accounts and the daemon
`;

async function main(argv: string[]) {
  const [command = "serve", ...flags] = argv;
  switch (command) {
    case "serve":
      return runServe(flags.includes("--dev"));
    case "install":
      return install();
    case "uninstall":
      return uninstall();
    case "doctor":
      process.exit((await doctor()) ? 0 : 1);
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    default:
      console.error(`unknown command: ${command}\n\n${HELP}`);
      process.exit(1);
  }
}

async function runServe(dev: boolean) {
  const stores = openStores();
  const accounts = await discoverAccounts();
  if (accounts.length === 0) {
    console.error("No github.com accounts found in gh. Run `gh auth login` first.");
    process.exit(1);
  }
  const ports = new Map<string, GitHubPort>(
    accounts.map((account) => [
      account.login,
      new LiveGitHub(new GitHubClient(account.login, readToken, stores.cache)),
    ]),
  );

  const gitBinary = process.env.PIER_GIT ?? "git";
  const git = (await gitVersionOk(gitBinary))
    ? new GitStore(paths.git, readToken, { gitBinary })
    : null;
  if (!git)
    console.warn(
      "  git 2.40 or newer not found: diffs come from GitHub, without 'since your last review'",
    );
  const app = createApp({ stores, accounts, ports, ...(git ? { git } : {}) });
  const sandboxOwner = process.env.PIER_SANDBOX;
  if (sandboxOwner) applySandbox(app, sandboxOwner);
  const webDir = process.env.PIER_WEB_DIR ?? join(import.meta.dir, "../../web/dist");
  const server = serve({
    handlers: createHandlers(app),
    events: app.events,
    webDir: !dev && existsSync(webDir) ? webDir : null,
    dev,
  });
  await app.start();

  console.log(`pier ${dev ? "(dev) " : ""}listening on ${ORIGIN}`);
  console.log(`  accounts: ${accounts.map((a) => a.login).join(", ")}`);
  console.log(`  data: ${paths.home}`);

  const shutdown = (signal: string) => {
    console.log(`stopping (${signal})`);
    app.stop();
    void server.stop();
    stores.cache.close();
    stores.state.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));
}

/**
 * Live E2E mode: writes are refused outside the sandbox owner's repos, the accounts are treated
 * as separate people (so one can review another's PR), and the first account watches the
 * sandbox's bot PRs.
 */
function applySandbox(app: ReturnType<typeof createApp>, owner: string) {
  const first = app.accounts[0]!.login;
  app.settings.set("sandbox", { writeOwners: [owner] });
  app.settings.set("identity", { linked: false });
  const scopes = app.settings.get("scopes").filter((scope) => scope.id !== "sandbox:bots");
  scopes.push({
    id: "sandbox:bots",
    account: first,
    kind: "bots",
    query: `is:pr is:open archived:false (author:app/dependabot OR author:app/renovate) user:${owner}`,
  });
  app.settings.set("scopes", scopes);
  console.log(`  sandbox: writes limited to ${owner}`);
}

await main(process.argv.slice(2));
