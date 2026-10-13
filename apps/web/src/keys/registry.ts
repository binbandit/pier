import { useLayoutEffect, useState } from "react";
import { create } from "zustand";

// Every action in pier is a command. The same registry drives keyboard shortcuts, chords with
// which-key hints in the status line, the Cmd+K palette and the `?` cheatsheet.
//
// Scopes stack: panel > surface > global. While a panel (plan strip, palette, picker) is open,
// only its commands fire, so its `a`/`e`/`Enter` can never approve, mark done or open by accident.

export type Scope = "global" | "surface" | "panel";

export type Command = {
  id: string;
  title: string;
  /** Key sequences: "j", "shift+o", "mod+k", or chords like "g i". */
  keys?: string[];
  scope: Scope;
  run: () => void;
  /** Short label shown in the status line while this command's scope is on top. */
  hint?: string | undefined;
  /** Section in the palette and cheatsheet. */
  group?: string;
  /** Fire even while typing in an input (Escape, Cmd+Enter). */
  inInputs?: boolean;
  /** Hidden from the palette (e.g. plain j/k movement). */
  hidden?: boolean;
};

type KeyState = {
  commands: Map<string, Command>;
  pending: string | null;
  /** Each mounted user of `useCommands`, with what it registered last. */
  owners: Map<symbol, Command[]>;
  /** Sets (or, with null, removes) what one owner registers. */
  publish: (owner: symbol, commands: Command[] | null) => void;
  setPending: (pending: string | null) => void;
};

export const useKeys = create<KeyState>((set, get) => ({
  commands: new Map(),
  pending: null,
  owners: new Map(),
  publish(owner, commands) {
    const { owners, commands: current } = get();
    const before = owners.get(owner);
    if (commands && before && sameCommands(before, commands)) {
      // The same commands with fresh closures: swap them in without telling anyone, since nothing
      // anyone shows has changed. Telling them would re-render, re-register, and so on forever.
      owners.set(owner, commands);
      for (const command of commands) current.set(command.id, command);
      return;
    }
    const next = new Map(owners);
    if (commands) next.set(owner, commands);
    else next.delete(owner);
    // Later owners win a shared id, as the most recently mounted surface should.
    const merged = new Map<string, Command>();
    for (const list of next.values()) for (const command of list) merged.set(command.id, command);
    set({ owners: next, commands: merged });
  },
  setPending: (pending) => set({ pending }),
}));

/** Whether two lists show the same commands, whatever their `run` closures. */
function sameCommands(a: Command[], b: Command[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return (
        y !== undefined &&
        x.id === y.id &&
        x.title === y.title &&
        x.scope === y.scope &&
        x.hint === y.hint &&
        x.group === y.group &&
        x.inInputs === y.inInputs &&
        x.hidden === y.hidden &&
        (x.keys ?? []).join("|") === (y.keys ?? []).join("|")
      );
    })
  );
}

/**
 * Registers commands for as long as the calling component is mounted. They're published before
 * the browser paints, so whatever is on screen already answers its keys.
 */
export function useCommands(commands: Command[]): void {
  const publish = useKeys((s) => s.publish);
  const [owner] = useState(() => Symbol("commands"));
  // Every render: the latest closures, quietly unless what's shown changed.
  useLayoutEffect(() => publish(owner, commands));
  useLayoutEffect(() => () => publish(owner, null), [owner, publish]);
}

const SCOPE_RANK: Record<Scope, number> = { panel: 2, surface: 1, global: 0 };

/** Commands that can fire right now: a raised panel shadows everything below it. */
export function activeCommands(commands: Map<string, Command>): Command[] {
  const all = [...commands.values()];
  const top = all.some((c) => c.scope === "panel") ? "panel" : null;
  return all
    .filter((c) => (top ? c.scope === "panel" : true))
    .toSorted((a, b) => SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope]);
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** "shift+o", "mod+k", "?", "]" … the same spelling commands declare. */
export function keyToken(event: KeyboardEvent): string | null {
  if (["Shift", "Meta", "Control", "Alt", "CapsLock"].includes(event.key)) return null;
  const parts: string[] = [];
  if (isMac ? event.metaKey : event.ctrlKey) parts.push("mod");
  if (isMac && event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  const key = event.key.toLowerCase();
  const isLetter = /^[a-z]$/.test(key);
  // Shift is part of the token only for letters and named keys; "?" already implies it.
  if (event.shiftKey && (isLetter || event.key.length > 1)) parts.push("shift");
  parts.push(key === " " ? "space" : key);
  return parts.join("+");
}

/** How a key sequence reads in hints and the cheatsheet. */
export function displayKeys(sequence: string): string[] {
  return sequence.split(" ").map((token) =>
    token
      .split("+")
      .map(
        (part) =>
          DISPLAY[part] ?? (part.length === 1 ? part : part[0]!.toUpperCase() + part.slice(1)),
      )
      .join(""),
  );
}

const DISPLAY: Record<string, string> = {
  mod: isMac ? "⌘" : "Ctrl+",
  ctrl: "⌃",
  alt: isMac ? "⌥" : "Alt+",
  shift: "⇧",
  enter: "⏎",
  escape: "Esc",
  space: "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  tab: "Tab",
  backspace: "⌫",
};

/** Where keys type text. A checkbox you just clicked (Viewed) keeps focus but takes no typing. */
function isEditable(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return !NOT_TYPED.has(target.type);
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["TEXTAREA", "SELECT"].includes(target.tagName);
}

const NOT_TYPED = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color"]);

const CHORD_TIMEOUT_MS = 1500;

/** The single window keydown listener. Mounted once at the root. */
export function useKeyDispatcher(): void {
  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clearPending = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      useKeys.getState().setPending(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const token = keyToken(event);
      if (!token) return;
      const { commands, pending } = useKeys.getState();
      const editable = isEditable(event.target);
      const active = activeCommands(commands).filter((c) => !editable || c.inInputs);

      const attempt = (sequence: string): "ran" | "prefix" | "none" => {
        const exact = active.find((c) => c.keys?.includes(sequence));
        if (exact) {
          event.preventDefault();
          clearPending();
          exact.run();
          return "ran";
        }
        if (active.some((c) => c.keys?.some((k) => k.startsWith(`${sequence} `)))) {
          event.preventDefault();
          if (timer) clearTimeout(timer);
          useKeys.getState().setPending(sequence);
          timer = setTimeout(clearPending, CHORD_TIMEOUT_MS);
          return "prefix";
        }
        return "none";
      };

      if (pending) {
        if (attempt(`${pending} ${token}`) !== "none") return;
        clearPending();
        if (token === "escape") return;
      }
      attempt(token);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (timer) clearTimeout(timer);
    };
  }, []);
}
