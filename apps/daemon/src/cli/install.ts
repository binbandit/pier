import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { ORIGIN, paths } from "@/config";

// `pier install` makes the daemon start at login and restart if it dies, via a launchd agent.
// launchd starts processes with a bare PATH (no Homebrew), so the absolute paths of gh and git
// are recorded in the agent rather than looked up at run time.

export const LABEL = "dev.pier.daemon";
const plistPath = () => join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);

function uid(): number {
  return process.getuid?.() ?? 501;
}

/** How to run this same daemon again: the compiled binary, or bun plus this source tree. */
function programArguments(): string[] {
  const compiled = !process.execPath.endsWith("/bun") && !process.execPath.endsWith("/bun.exe");
  if (compiled) return [process.execPath, "serve"];
  return [process.execPath, resolve(import.meta.dir, "..", "main.ts"), "serve"];
}

function launchctl(...args: string[]): { ok: boolean; output: string } {
  const result = Bun.spawnSync(["launchctl", ...args], { stdout: "pipe", stderr: "pipe" });
  return {
    ok: result.exitCode === 0,
    output: `${result.stdout.toString()}${result.stderr.toString()}`.trim(),
  };
}

export function install(): void {
  const gh = Bun.which("gh");
  const git = Bun.which("git");
  if (!gh) throw new Error("gh isn't on your PATH. Install it and run `gh auth login` first.");
  if (!git) throw new Error("git isn't on your PATH.");

  mkdirSync(paths.logs, { recursive: true });
  mkdirSync(dirname(plistPath()), { recursive: true });
  const env: Record<string, string> = {
    PIER_GH: gh,
    PIER_GIT: git,
    PATH: [...new Set([dirname(gh), dirname(git), "/usr/bin", "/bin", "/usr/sbin", "/sbin"])].join(
      ":",
    ),
  };
  // Carried through so a test or sandbox install keeps its own data, port and write limits.
  for (const key of ["PIER_HOME", "PIER_PORT", "PIER_SANDBOX"]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }

  writeFileSync(plistPath(), plist(programArguments(), env));
  // Replace any running copy so an upgrade takes effect immediately.
  launchctl("bootout", `gui/${uid()}/${LABEL}`);
  const loaded = launchctl("bootstrap", `gui/${uid()}`, plistPath());
  if (!loaded.ok) throw new Error(`launchctl couldn't load the agent: ${loaded.output}`);

  console.log("pier will now start at login and restart if it stops.");
  console.log(`  agent: ${plistPath()}`);
  console.log(`  logs:  ${paths.logs}`);
  console.log(`  open:  ${ORIGIN}, then use Chrome's Install button to give it its own window`);
}

export function uninstall(): void {
  launchctl("bootout", `gui/${uid()}/${LABEL}`);
  rmSync(plistPath(), { force: true });
  console.log("pier no longer starts at login. Your data is still in:");
  console.log(`  ${paths.home}`);
}

export function agentLoaded(): boolean {
  return launchctl("print", `gui/${uid()}/${LABEL}`).ok;
}

function plist(args: string[], env: Record<string, string>): string {
  const strings = (values: string[]) =>
    values.map((v) => `      <string>${escape(v)}</string>`).join("\n");
  const dict = Object.entries(env)
    .map(([k, v]) => `      <key>${escape(k)}</key>\n      <string>${escape(v)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${strings(args)}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
${dict}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>StandardOutPath</key>
    <string>${escape(join(paths.logs, "pier.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${escape(join(paths.logs, "pier.log"))}</string>
  </dict>
</plist>
`;
}

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
