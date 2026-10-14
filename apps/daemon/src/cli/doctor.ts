import { accessSync, constants, mkdirSync } from "node:fs";

import { OPTIONAL_SCOPES, REQUIRED_SCOPES, discoverAccounts, missingScopes } from "@/accounts/gh";
import { ORIGIN, PORT, paths } from "@/config";
import { gitVersionOk } from "@/git/store";
import { scopeFix } from "@pier/core/accounts";

import { agentLoaded } from "./install";

// `pier doctor`: everything pier depends on, checked in the order you'd fix it, each line saying
// exactly what to run when something's wrong.

type Check = { ok: boolean | "warn"; label: string; fix?: string };

export async function doctor(): Promise<boolean> {
  const checks: Check[] = [];

  const gh = process.env.PIER_GH ?? Bun.which("gh");
  checks.push(
    gh
      ? { ok: true, label: `gh at ${gh}` }
      : { ok: false, label: "gh not found", fix: "brew install gh" },
  );

  if (gh) {
    const accounts = await discoverAccounts().catch(() => []);
    if (accounts.length === 0) {
      checks.push({ ok: false, label: "No github.com accounts in gh", fix: "gh auth login" });
    }
    for (const account of accounts) {
      const required = missingScopes(account, REQUIRED_SCOPES);
      const optional = missingScopes(account, OPTIONAL_SCOPES);
      if (required.length > 0) {
        checks.push({
          ok: false,
          label: `${account.login} is missing ${required.join(", ")}`,
          fix: scopeFix(account.login, required),
        });
      } else if (optional.length > 0) {
        checks.push({
          ok: "warn",
          label: `${account.login}: projects and saved replies need ${optional.join(", ")}`,
          fix: scopeFix(account.login, optional),
        });
      } else {
        checks.push({ ok: true, label: `${account.login} has every scope pier uses` });
      }
    }
  }

  const git = process.env.PIER_GIT ?? "git";
  checks.push(
    (await gitVersionOk(git))
      ? { ok: true, label: "git 2.40 or newer" }
      : {
          ok: false,
          label: 'git 2.40 or newer is needed for "since your last review"',
          fix: "brew install git",
        },
  );

  try {
    mkdirSync(paths.home, { recursive: true });
    accessSync(paths.home, constants.W_OK);
    checks.push({ ok: true, label: `Data in ${paths.home}` });
  } catch {
    checks.push({ ok: false, label: `Can't write to ${paths.home}` });
  }

  const running = await fetch(`${ORIGIN}/`, { signal: AbortSignal.timeout(2000) }).then(
    (r) => r.ok,
    () => false,
  );
  checks.push(
    running
      ? { ok: true, label: `Daemon answering on ${ORIGIN}` }
      : {
          ok: "warn",
          label: `Nothing answering on port ${PORT}`,
          fix: "pier install (or pier serve)",
        },
  );
  checks.push(
    agentLoaded()
      ? { ok: true, label: "Starts at login" }
      : { ok: "warn", label: "Not set to start at login", fix: "pier install" },
  );

  for (const check of checks) {
    const mark = check.ok === true ? "ok  " : check.ok === "warn" ? "warn" : "fail";
    console.log(`${mark}  ${check.label}`);
    if (check.ok !== true && check.fix) console.log(`      ${check.fix}`);
  }
  return checks.every((c) => c.ok !== false);
}
