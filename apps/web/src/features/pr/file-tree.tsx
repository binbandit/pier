import type { GitStatusEntry } from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import { useEffect, useLayoutEffect, useRef } from "react";

import { formatNumber } from "@/lib/format";
import type { DiffFile, ViewedState } from "@pier/core/wire";

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
  // Pierre creates its model once. Its callbacks read current review data without rebuilding it.
  const latest = useRef({ viewed, threadCounts, onJump });
  const syncing = useRef(false);
  useLayoutEffect(() => {
    latest.current = { viewed, threadCounts, onJump };
  });
  const { model } = useFileTree({
    paths: files.map((file) => file.path),
    initialExpansion: "open",
    flattenEmptyDirectories: true,
    itemHeight: 28,
    search: true,
    fileTreeSearchMode: "hide-non-matches",
    onSelectionChange: (paths) => {
      const path = paths.at(-1);
      if (!syncing.current && path && !path.endsWith("/")) latest.current.onJump(path);
    },
    renderRowDecoration: ({ row }) => {
      if (row.kind !== "file") return null;
      const state = latest.current.viewed[row.path];
      const threads = latest.current.threadCounts.get(row.path) ?? 0;
      const parts = [];
      const labels = [];
      if (state === "viewed") {
        parts.push({ text: "✓", color: "var(--color-off)" });
        labels.push("Viewed");
      } else if (state === "changed") {
        parts.push({ text: "changed", color: "var(--color-warn)" });
        labels.push("Changed since viewed");
      }
      if (threads > 0) {
        parts.push({
          text: `${parts.length ? " " : ""}${formatNumber(threads)}`,
          color: "var(--color-faint)",
        });
        labels.push(`${threads} ${threads === 1 ? "thread" : "threads"}`);
      }
      return parts.length > 0
        ? { text: parts.map((part) => part.text).join(" "), parts, title: labels.join(" · ") }
        : null;
    },
  });
  const pathsKey = JSON.stringify(files.map((file) => file.path));
  const previousPaths = useRef(pathsKey);
  useEffect(() => {
    if (pathsKey === previousPaths.current) return;
    syncing.current = true;
    model.resetPaths(files.map((file) => file.path));
    previousPaths.current = pathsKey;
    syncing.current = false;
  }, [files, model, pathsKey]);

  useEffect(() => {
    const status: GitStatusEntry[] = files.flatMap((file) =>
      file.status === "unchanged"
        ? []
        : [
            {
              path: file.path,
              status:
                file.status === "removed"
                  ? "deleted"
                  : file.status === "copied"
                    ? "added"
                    : file.status === "changed"
                      ? "modified"
                      : file.status,
            },
          ],
    );
    model.setGitStatus(status);
    // Decorations can change even when the file paths and Git statuses stay the same.
    if (model.getFileTreeContainer()) model.render({});
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- refresh decorations read through latest
  }, [files, model, viewed, threadCounts]);

  useEffect(() => {
    syncing.current = true;
    for (const selected of model.getSelectedPaths())
      if (selected !== current) model.getItem(selected)?.deselect();
    if (current && model.getItem(current)) {
      const segments = current.split("/");
      for (let depth = 1; depth < segments.length; depth++) {
        const parent = model.getItem(`${segments.slice(0, depth).join("/")}/`);
        if (parent && "expand" in parent) parent.expand();
      }
      model.getItem(current)?.select();
      model.scrollToPath(current, { focus: false, offset: "nearest" });
    }
    syncing.current = false;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- resetPaths above can replace the selected item
  }, [current, model, pathsKey]);

  const done = files.filter((file) => viewed[file.path] === "viewed").length;
  return (
    <nav aria-label="Files" className="flex w-[260px] shrink-0 flex-col border-r border-line">
      <p className="flex h-11 shrink-0 items-center border-b border-line px-4 text-meta text-faint">
        {formatNumber(done)} of {formatNumber(files.length)} viewed
      </p>
      <PierreFileTree
        model={model}
        className="pr-file-tree min-h-0 flex-1"
        onKeyDown={(event) => event.stopPropagation()}
      />
    </nav>
  );
}
