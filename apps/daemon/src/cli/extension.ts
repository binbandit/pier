import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ORIGIN, VERSION, paths } from "@/config";

// Embedded in the compiled binary, so it's there to copy wherever pier runs from.
import icon from "../../../web/public/icon-192.png" with { type: "file" };

// `pier extension`: a small Chrome extension that opens github.com pull request links in pier,
// so a link from Slack, an email or a bookmark lands here instead. It only redirects (Chrome's
// declarativeNetRequest), and never reads pages. Two kinds of link stay on GitHub: ones carrying
// `?pier=0` (pier's own "open on github.com"), and ones followed from github.com itself, so once
// you've gone to GitHub on purpose you can move around there.

const GITHUB = String.raw`^https://github\.com/([^/?#]+)/([^/?#]+)`;

type Rule = {
  id: number;
  priority: number;
  action: { type: "allow" } | { type: "redirect"; redirect: { regexSubstitution: string } };
  condition: {
    regexFilter: string;
    resourceTypes: ["main_frame"];
    excludedInitiatorDomains?: string[];
  };
};

/** The redirect rules, sending GitHub's PR pages to the same paths on `origin`. */
export function linkRules(origin: string): Rule[] {
  const redirect = (id: number, regexFilter: string, to: string): Rule => ({
    id,
    priority: 1,
    action: { type: "redirect", redirect: { regexSubstitution: `${origin}${to}` } },
    condition: {
      regexFilter,
      resourceTypes: ["main_frame"],
      excludedInitiatorDomains: ["github.com"],
    },
  });
  return [
    {
      id: 1,
      priority: 2,
      action: { type: "allow" },
      condition: {
        regexFilter: String.raw`^https://github\.com/[^?#]*\?(?:[^#]*&)?pier=0(?:[&#]|$)`,
        resourceTypes: ["main_frame"],
      },
    },
    // A PR and any page in it (/files, /commits, /checks). Rules see the whole URL, line anchor
    // and all, so /files#diff-…R12 carries its anchor over explicitly.
    redirect(
      2,
      String.raw`${GITHUB}/pull/(\d+)(/files)?(?:[/?][^#]*)?(#.*)?$`,
      String.raw`/\1/\2/pull/\3\4\5`,
    ),
    // A repo's PR list. A filtered one (?q=...) stays on GitHub; pier's search reads differently.
    redirect(3, String.raw`${GITHUB}/pulls/?$`, String.raw`/\1/\2/pulls`),
  ];
}

export function extensionFiles(origin: string): Record<string, string> {
  const manifest = {
    manifest_version: 3,
    name: "pier links",
    version: VERSION,
    description: `Opens github.com pull request links in pier (${origin}).`,
    permissions: ["declarativeNetRequest"],
    host_permissions: ["https://github.com/*"],
    icons: { "128": "icon.png" },
    declarative_net_request: {
      rule_resources: [{ id: "links", enabled: true, path: "rules.json" }],
    },
  };
  return {
    "manifest.json": JSON.stringify(manifest, null, 2),
    "rules.json": JSON.stringify(linkRules(origin), null, 2),
  };
}

export async function writeExtension(): Promise<void> {
  const dir = join(paths.home, "extension");
  mkdirSync(dir, { recursive: true });
  for (const [name, contents] of Object.entries(extensionFiles(ORIGIN))) {
    writeFileSync(join(dir, name), `${contents}\n`);
  }
  // Read through Bun, which can see inside the compiled binary.
  writeFileSync(join(dir, "icon.png"), await Bun.file(icon).bytes());
  console.log(`Wrote the pier links extension for ${ORIGIN} to:`);
  console.log(`  ${dir}`);
  console.log("");
  console.log("To add it to Chrome:");
  console.log("  1. Open chrome://extensions and turn on Developer mode (top right)");
  console.log("  2. Click Load unpacked and choose the folder above");
  console.log("");
  console.log("github.com PR links now open in pier. pier's Shift+O still goes to GitHub.");
  console.log("Run this again if pier's port changes, then press reload on the extension.");
}
