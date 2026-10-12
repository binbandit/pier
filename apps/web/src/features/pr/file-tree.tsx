import { clsx } from "clsx";

import type { DiffFile, ViewedState } from "@pier/core/wire";

// A quiet list of the files in review order. Viewed files fade; files with conversation say so.

export function FileTree({
  files,
  viewed,
  threadCounts,
  current,
  onJump,
}: {
  files: DiffFile[];
  viewed: Record<string, ViewedState>;
  threadCounts: Map<string, number>;
  current: string | null;
  onJump: (path: string) => void;
}) {
  const done = files.filter((f) => viewed[f.path] === "viewed").length;
  return (
    <nav aria-label="Files" className="flex w-[260px] shrink-0 flex-col border-r border-line">
      <p className="flex h-11 shrink-0 items-center border-b border-line px-4 text-meta text-faint">
        {done} of {files.length} viewed
      </p>
      <ul className="min-h-0 flex-1 overflow-y-auto py-2">
        {files.map((file) => {
          const slash = file.path.lastIndexOf("/");
          const dir = slash === -1 ? "" : file.path.slice(0, slash + 1);
          const name = file.path.slice(slash + 1);
          const state = viewed[file.path] ?? "unviewed";
          const threads = threadCounts.get(file.path) ?? 0;
          return (
            <li key={file.path}>
              <button
                type="button"
                onClick={() => onJump(file.path)}
                title={file.path}
                className={clsx(
                  "relative flex h-7 w-full items-center gap-2 px-4 text-left text-meta",
                  file.path === current ? "bg-cursor" : "hover:bg-hover",
                )}
              >
                {file.path === current && (
                  <span
                    aria-hidden
                    className="absolute top-1.5 bottom-1.5 left-1 w-0.5 rounded-full bg-accent"
                  />
                )}
                <span
                  className={clsx(
                    "min-w-0 flex-1 truncate font-code",
                    state === "viewed" ? "text-off" : "text-fg",
                  )}
                >
                  <span className={state === "viewed" ? "" : "text-faint"}>{dir}</span>
                  {name}
                </span>
                {state === "changed" && <span className="text-warn">changed</span>}
                {threads > 0 && <span className="text-faint">{threads}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
