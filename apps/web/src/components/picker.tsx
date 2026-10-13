import { clsx } from "clsx";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useCommands } from "@/keys/registry";
import { Dock } from "@/ui/dock";
import { Keys } from "@/ui/kbd";

// Choose from a list without leaving the keyboard: type to filter, ↑/↓ to move, Enter to pick.
// Several-of pickers stage their changes and save them on Esc, like GitHub's sidebar saves when
// its menu closes; one-of pickers save the moment you pick.

export type PickerOption = {
  key: string;
  label: string;
  detail?: string | null;
  lead?: ReactNode;
};

type PickerProps = {
  title: string;
  /** Undefined while loading. */
  options: PickerOption[] | undefined;
  selected: string[];
  /** One-of (a milestone) rather than several-of (labels, people). */
  single?: boolean;
  /** For one-of pickers: whether picking the current value clears it. */
  clearable?: boolean;
  onSave: (change: { add: string[]; remove: string[] }) => void;
  onClose: () => void;
};

export function Picker({
  title,
  options,
  selected,
  single = false,
  clearable = true,
  onSave,
  onClose,
}: PickerProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [chosen, setChosen] = useState(() => new Set(selected));
  // Raised by a key, so typing should filter straight away.
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  // What's set already comes first, so it's easy to see and undo.
  const needle = query.trim().toLowerCase();
  const visible = (options ?? [])
    .filter((o) => !needle || `${o.label} ${o.detail ?? ""}`.toLowerCase().includes(needle))
    .toSorted((a, b) => Number(selected.includes(b.key)) - Number(selected.includes(a.key)));
  const index = Math.min(cursor, Math.max(0, visible.length - 1));
  const add = [...chosen].filter((key) => !selected.includes(key));
  const remove = selected.filter((key) => !chosen.has(key));

  const close = () => {
    if (add.length > 0 || remove.length > 0) onSave({ add, remove });
    onClose();
  };
  const pick = (option: PickerOption | undefined) => {
    if (!option) return;
    if (single) {
      const current = selected[0];
      // Picking what's already set clears it, where clearing makes sense.
      if (current !== option.key) onSave({ add: [option.key], remove: current ? [current] : [] });
      else if (clearable) onSave({ add: [], remove: [current] });
      onClose();
      return;
    }
    setChosen((now) => {
      const next = new Set(now);
      if (next.has(option.key)) next.delete(option.key);
      else next.add(option.key);
      return next;
    });
  };

  useCommands([
    {
      id: "picker.close",
      title: "Save and close",
      keys: ["escape"],
      scope: "panel",
      inInputs: true,
      run: close,
    },
    {
      id: "picker.pick",
      title: "Pick",
      keys: ["enter"],
      scope: "panel",
      inInputs: true,
      run: () => pick(visible[index]),
    },
    {
      id: "picker.down",
      title: "Next",
      keys: ["arrowdown", "ctrl+n"],
      scope: "panel",
      inInputs: true,
      run: () => setCursor(Math.min(index + 1, visible.length - 1)),
    },
    {
      id: "picker.up",
      title: "Previous",
      keys: ["arrowup", "ctrl+p"],
      scope: "panel",
      inInputs: true,
      run: () => setCursor(Math.max(0, index - 1)),
    },
  ]);

  const changes = add.length + remove.length;
  return (
    <Dock label={title}>
      <div className="max-w-[900px]">
        <div className="mb-2 flex items-baseline gap-4">
          <h2 className="text-ui font-medium text-strong">{title}</h2>
          <span className="ml-auto flex items-center gap-4 text-meta text-faint">
            <span className="flex items-center gap-1.5">
              <Keys sequence="enter" /> {single ? "choose" : "toggle"}
            </span>
            <span className="flex items-center gap-1.5">
              <Keys sequence="escape" />{" "}
              {single
                ? "close"
                : changes > 0
                  ? `save ${changes === 1 ? "1 change" : `${changes} changes`}`
                  : "close"}
            </span>
          </span>
        </div>
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          aria-label={`Filter ${title.toLowerCase()}`}
          placeholder="Filter"
          className="mb-1 h-9 w-full rounded-sm border border-line-strong bg-canvas px-3 text-ui text-strong outline-none placeholder:text-faint"
        />
        <ul className="max-h-[36vh] overflow-y-auto">
          {options === undefined && <li className="px-3 py-2 text-meta text-faint">Loading</li>}
          {options !== undefined && visible.length === 0 && (
            <li className="px-3 py-2 text-meta text-faint">
              {needle ? `Nothing matches “${query}”` : "Nothing to choose from"}
            </li>
          )}
          {visible.map((option, i) => {
            const on = single ? selected.includes(option.key) : chosen.has(option.key);
            return (
              <li key={option.key}>
                <button
                  type="button"
                  onMouseMove={() => setCursor(i)}
                  onClick={() => pick(option)}
                  className={clsx(
                    "flex h-8 w-full items-center gap-3 rounded-sm px-3 text-left text-ui",
                    i === index ? "bg-cursor text-strong" : "text-fg",
                  )}
                >
                  {/* One-of pickers get a round marker, several-of a box, as forms do. */}
                  <span
                    aria-hidden
                    className={clsx(
                      "flex size-3.5 shrink-0 items-center justify-center border text-[10px] leading-none",
                      single ? "rounded-full" : "rounded-[3px]",
                      on ? "border-accent bg-accent text-canvas" : "border-line-max",
                    )}
                  >
                    {on && !single ? "✓" : ""}
                  </span>
                  {option.lead}
                  <span className="truncate">{option.label}</span>
                  {option.detail && (
                    <span className="truncate text-meta text-faint">{option.detail}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Dock>
  );
}
