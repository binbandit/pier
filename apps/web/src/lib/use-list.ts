import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";

import { type Command, useCommands } from "@/keys/registry";
import { useUi } from "@/stores/ui";

// Keyboard-first list behaviour shared by every list surface: a cursor that survives the list
// changing underneath it (rows vanish as you act), x to select, and virtualised rendering so a
// list of thousands scrolls as smoothly as a list of ten.

export type ListOptions<T> = {
  id: string;
  items: T[];
  keyOf: (item: T) => string;
  rowHeight: number;
  onOpen?: (item: T) => void;
  /** Extra commands that act on the item under the cursor. */
  commands?: (current: T | undefined, selected: T[]) => Command[];
  /** For lists rendered without the virtualizer: bring row `index` into view. */
  scrollTo?: (index: number, container: HTMLElement) => void;
};

const NO_SELECTION: string[] = [];

export function useList<T>({
  id,
  items,
  keyOf,
  rowHeight,
  onOpen,
  commands,
  scrollTo,
}: ListOptions<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Track the cursor by key, remembering its index so that when the row disappears the cursor
  // lands on whatever took its place, the way Superhuman's `e` advances.
  const [cursor, setCursor] = useState<{ key: string | null; index: number }>({
    key: null,
    index: 0,
  });
  const selectedKeys = useUi((s) => s.selection[id] ?? NO_SELECTION);
  const setSelection = useUi((s) => s.setSelection);

  const found = cursor.key === null ? -1 : items.findIndex((item) => keyOf(item) === cursor.key);
  const index =
    items.length === 0 ? -1 : found >= 0 ? found : Math.min(cursor.index, items.length - 1);
  const current = index >= 0 ? items[index] : undefined;
  const selected = items.filter((item) => selectedKeys.includes(keyOf(item)));

  // TanStack Virtual hands back functions the React Compiler can't memoise, so it skips this
  // hook; that's expected and harmless here because rows re-render from the virtualizer's state.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  const move = (to: number) => {
    if (items.length === 0) return;
    const next = Math.max(0, Math.min(items.length - 1, to));
    setCursor({ key: keyOf(items[next]!), index: next });
    if (scrollTo && scrollRef.current) scrollTo(next, scrollRef.current);
    else virtualizer.scrollToIndex(next, { align: "auto" });
  };

  // Drop selections that no longer exist (acted on, or filtered away).
  useEffect(() => {
    const live = selectedKeys.filter((key) => items.some((item) => keyOf(item) === key));
    if (live.length !== selectedKeys.length) setSelection(id, live);
  }, [items, selectedKeys, id, keyOf, setSelection]);

  const toggle = (item: T) => {
    const key = keyOf(item);
    setSelection(
      id,
      selectedKeys.includes(key) ? selectedKeys.filter((k) => k !== key) : [...selectedKeys, key],
    );
  };

  useCommands([
    {
      id: `${id}.down`,
      title: "Next",
      keys: ["j", "arrowdown"],
      scope: "surface",
      hidden: true,
      run: () => move(index + 1),
    },
    {
      id: `${id}.up`,
      title: "Previous",
      keys: ["k", "arrowup"],
      scope: "surface",
      hidden: true,
      run: () => move(index - 1),
    },
    {
      id: `${id}.top`,
      title: "First",
      keys: ["home"],
      scope: "surface",
      hidden: true,
      run: () => move(0),
    },
    {
      id: `${id}.bottom`,
      title: "Last",
      keys: ["shift+g", "end"],
      scope: "surface",
      hidden: true,
      run: () => move(items.length - 1),
    },
    {
      id: `${id}.select`,
      title: "Select",
      keys: ["x"],
      scope: "surface",
      group: "Selection",
      run: () => current && toggle(current),
    },
    {
      id: `${id}.extend-down`,
      title: "Extend selection down",
      keys: ["shift+j"],
      scope: "surface",
      group: "Selection",
      run: () => {
        if (!current) return;
        const next = items[index + 1];
        setSelection(id, [
          ...new Set([...selectedKeys, keyOf(current), ...(next ? [keyOf(next)] : [])]),
        ]);
        move(index + 1);
      },
    },
    {
      id: `${id}.clear`,
      title: "Clear selection",
      keys: ["escape"],
      scope: "surface",
      hidden: true,
      run: () => setSelection(id, []),
    },
    ...(onOpen
      ? [
          {
            id: `${id}.open`,
            title: "Open",
            keys: ["enter", "o"],
            scope: "surface" as const,
            hint: "open",
            run: () => current && onOpen(current),
          },
        ]
      : []),
    ...(commands?.(current, selected) ?? []),
  ]);

  return { scrollRef, virtualizer, index, current, selected, selectedKeys, move, toggle };
}
