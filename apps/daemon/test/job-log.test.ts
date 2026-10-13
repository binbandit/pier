import { expect, test } from "bun:test";

import { byStep, parseJobLog } from "@/github/job-log";

test("a job log splits into its steps, with errors pointing at the right lines", () => {
  const log = [
    "2026-10-13T08:00:00.0000000Z Current runner version: '2.320.0'",
    "2026-10-13T08:00:01.0000000Z ##[group]Run actions/checkout@v4",
    "2026-10-13T08:00:01.1000000Z with:",
    "2026-10-13T08:00:01.2000000Z ##[endgroup]",
    "2026-10-13T08:00:02.0000000Z Syncing repository",
    "2026-10-13T08:00:03.0000000Z ##[group]Run npm test",
    "2026-10-13T08:00:03.1000000Z npm test",
    "2026-10-13T08:00:03.2000000Z ##[endgroup]",
    "2026-10-13T08:00:04.0000000Z  ✗ returns a cursor",
    "2026-10-13T08:00:05.0000000Z ##[error]Process completed with exit code 1.",
    "",
  ].join("\n");
  const { sections, truncated } = parseJobLog(log);
  expect(truncated).toBe(false);
  expect(sections.map((s) => [s.title, s.lines, s.errors])).toEqual([
    ["Set up job", ["Current runner version: '2.320.0'"], []],
    ["Run actions/checkout@v4", ["with:", "Syncing repository"], []],
    [
      "Run npm test",
      ["npm test", " ✗ returns a cursor", "Process completed with exit code 1."],
      [2],
    ],
  ]);
});

test("only the end of a very long log is kept", () => {
  const log = Array.from({ length: 6_000 }, (_, i) => `line ${i}`).join("\n");
  const { sections, truncated } = parseJobLog(log);
  expect(truncated).toBe(true);
  expect(sections[0]?.title).toBe("Earlier output");
  expect(sections[0]?.lines.at(-1)).toBe("line 5999");
  expect(sections[0]?.lines.length).toBe(5_000);
});

test("an action's own groups nest under the step that ran it", () => {
  const { sections } = parseJobLog(
    [
      "##[group]Runner Image",
      "ubuntu-24.04",
      "##[group]Run actions/checkout@v7",
      "with: ...",
      "##[group]Fetching the repository",
      "git fetch",
      "##[group]Run npm test",
      "\u001b[36;1mnpm test\u001b[0m",
      "##[error]Process completed with exit code 1.",
    ].join("\n"),
  );
  const steps = byStep(
    [
      { name: "Set up job", state: "success" },
      { name: "Run actions/checkout@v7", state: "success" },
      { name: "Run npm test", state: "failure" },
    ],
    sections,
  );
  expect(steps.map((s) => [s.name, s.state, s.sections.map((x) => x.title)])).toEqual([
    ["Set up job", "success", ["Runner Image"]],
    ["Run actions/checkout@v7", "success", ["Run actions/checkout@v7", "Fetching the repository"]],
    ["Run npm test", "failure", ["Run npm test"]],
  ]);
  expect(steps[2]?.sections[0]?.lines[0]).toBe("npm test");
});
