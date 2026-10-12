import { PatchDiff } from "@pierre/diffs/react";
import { clsx } from "clsx";
import { useState } from "react";

import type { DiffFile } from "@pier/core/wire";

import { THEME, registerTheme } from "./theme";

// The only place pier touches @pierre/diffs. Its API is young and moving, so everything else in
// the app talks to these components instead. It renders inside a shadow DOM, so styling goes
// through CSS variables (app.css) and the `unsafeCSS` block below rather than Tailwind classes.

registerTheme();

const UNSAFE_CSS = /* css */ `
  :host { background: #000; }
  [data-diffs-header] {
    background: #000;
    border-bottom: 1px solid #1e1e1e;
    font-size: 13px;
  }
  [data-title] { color: #cccccc; font-family: var(--diffs-font-family); }
  [data-line-type="change-addition"] { background-color: #131810; }
  [data-line-type="change-deletion"] { background-color: #1d1111; }
  [data-line-type="change-addition"] [data-diff-span] { background-color: #263020; }
  [data-line-type="change-deletion"] [data-diff-span] { background-color: #3a2323; }
  [data-separator],
  [data-separator-wrapper],
  [data-separator-content] {
    background: #000;
    color: #7a7a7a;
  }
  [data-separator] {
    border-block: 1px solid #1e1e1e;
    font-family: var(--diffs-header-font-family);
    font-size: 12px;
  }
`;
export const DIFF_OPTIONS = {
  theme: THEME,
  themeType: "dark",
  diffStyle: "unified",
  diffIndicators: "bars",
  hunkSeparators: "line-info-basic",
  lineDiffType: "word-alt",
  overflow: "scroll",
  unsafeCSS: UNSAFE_CSS,
} as const;

export const LOCKFILE =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock)$/;

export function DiffFiles({ files }: { files: DiffFile[] }) {
  return (
    <div className="space-y-6">
      {files.map((file) => (
        <DiffFileView key={`${file.previousPath ?? ""}>${file.path}`} file={file} />
      ))}
    </div>
  );
}

function DiffFileView({ file }: { file: DiffFile }) {
  const isLockfile = LOCKFILE.test(file.path);
  const [open, setOpen] = useState(!isLockfile);

  if (file.patch === null || !open) {
    return (
      <div className="flex h-10 items-center gap-3 border-y border-line px-1 text-meta">
        <span className="font-code text-fg">{file.path}</span>
        <span className="font-code">
          <span className="text-ok">+{file.additions}</span>{" "}
          <span className="text-bad">−{file.deletions}</span>
        </span>
        <span className="ml-auto text-faint">
          {file.patch === null ? (
            "Too large for GitHub to send as a diff"
          ) : (
            <button type="button" onClick={() => setOpen(true)} className={clsx("hover:text-fg")}>
              Show lockfile diff
            </button>
          )}
        </span>
      </div>
    );
  }
  return <PatchDiff patch={toPatch(file)} options={DIFF_OPTIONS} />;
}

/** GitHub gives hunks only; the renderer wants a full git-style file patch. */
export function toPatch(file: DiffFile): string {
  const before = file.status === "added" ? "/dev/null" : `a/${file.previousPath ?? file.path}`;
  const after = file.status === "removed" ? "/dev/null" : `b/${file.path}`;
  return `diff --git a/${file.previousPath ?? file.path} b/${file.path}\n--- ${before}\n+++ ${after}\n${file.patch ?? ""}\n`;
}
