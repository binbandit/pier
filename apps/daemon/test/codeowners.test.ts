import { expect, test } from "bun:test";

import { CodeOwnersCache } from "@/domain/codeowners";
import { createFakePorts, generateScenario } from "@/github/fake/scenario";
import { codeOwnersMatcher, parseCodeOwners } from "@pier/core/codeowners";

// The example file from GitHub's "About code owners" docs, with the owners it says each path gets.
const GITHUB_EXAMPLE = `
# Each line is a file pattern followed by one or more owners.
*       @global-owner1 @global-owner2
*.js    @js-owner #This is an inline comment.
*.go docs@example.com
*.txt @octo-org/octocats
/build/logs/ @doctocat
docs/*  docs@example.com
apps/ @octocat
/docs/ @doctocat
/scripts/ @doctocat @octocat
**/logs @octocat
/apps/ @octocat
/apps/github
/apps/ @octocat
/apps/github @doctocat
\\#notes.md @hash-owner
`;

test("the last matching rule owns a file, as GitHub's example says", () => {
  const ownersOf = codeOwnersMatcher(parseCodeOwners(GITHUB_EXAMPLE));
  expect(ownersOf("README.md")).toEqual(["@global-owner1", "@global-owner2"]);
  expect(ownersOf("src/app/index.js")).toEqual(["@js-owner"]);
  expect(ownersOf("cmd/main.go")).toEqual(["docs@example.com"]);
  expect(ownersOf("notes/todo.txt")).toEqual(["@octo-org/octocats"]);
  // `/build/logs/` matches, but `**/logs` comes later and matches too.
  expect(ownersOf("build/logs/today.txt")).toEqual(["@octocat"]);
  expect(ownersOf("deep/logs/today.txt")).toEqual(["@octocat"]);
  // `/docs/` comes after `docs/*`, so it wins for both.
  expect(ownersOf("docs/getting-started.md")).toEqual(["@doctocat"]);
  expect(ownersOf("docs/build-app/troubleshooting.md")).toEqual(["@doctocat"]);
  expect(ownersOf("lib/apps/server.rb")).toEqual(["@octocat"]);
  expect(ownersOf("scripts/deploy.sh")).toEqual(["@doctocat", "@octocat"]);
  expect(ownersOf("apps/github/server.rb")).toEqual(["@doctocat"]);
  expect(ownersOf("#notes.md")).toEqual(["@hash-owner"]);
});

test("a final star stays in its folder, and a rule without owners clears them", () => {
  const ownersOf = codeOwnersMatcher(
    parseCodeOwners(["docs/* @writer", "/vendor/ @platform", "/vendor/generated/"].join("\n")),
  );
  expect(ownersOf("docs/intro.md")).toEqual(["@writer"]);
  expect(ownersOf("docs/api/intro.md")).toEqual([]);
  expect(ownersOf("vendor/lib.go")).toEqual(["@platform"]);
  expect(ownersOf("vendor/generated/lib.go")).toEqual([]);
});

test("your teams count as you, and a repo without CODEOWNERS has no owners", async () => {
  const world = generateScenario({ preset: "sandbox" });
  world.addTeam("WastedHippie", "reviewers", ["binbandit"]);
  const api = world.repos.get("WastedHippie/sandbox-api")!;
  api.codeOwners = "* @WastedHippie/reviewers\n";
  const cache = new CodeOwnersCache(createFakePorts(world));

  const owners = await cache.forPr(api.fullName, "main", "binbandit");
  expect(owners?.you).toEqual(["@binbandit", "@WastedHippie/reviewers"]);
  expect(owners && codeOwnersMatcher(owners.rules)("go.mod")).toEqual(["@WastedHippie/reviewers"]);
  expect(await cache.forPr("WastedHippie/sandbox-cli", "main", "binbandit")).toBeNull();
});
