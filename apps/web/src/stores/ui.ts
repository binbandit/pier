import { create } from "zustand";

import type { PlanPreview } from "@pier/core/wire";

// UI-only state. Server data lives in TanStack Query; nothing here is ever sent to the daemon.

export type Toast = {
  id: string;
  text: string;
  tone: "neutral" | "ok" | "bad";
  /** Shown as "z Undo" while present. */
  undo?: () => void;
};

export type Panel =
  | { kind: "plan"; preview: PlanPreview; label: string; onDone?: () => void }
  | { kind: "palette" }
  | { kind: "cheatsheet" }
  | { kind: "escape"; url: string }
  | null;

type UiState = {
  panel: Panel;
  toasts: Toast[];
  /** Selected row ids per list, for bulk actions. */
  selection: Record<string, string[]>;
  openPanel: (panel: Panel) => void;
  closePanel: () => void;
  toast: (toast: Omit<Toast, "id">, ttlMs?: number) => void;
  dismissToast: (id: string) => void;
  setSelection: (list: string, ids: string[]) => void;
};

export const useUi = create<UiState>((set, get) => ({
  panel: null,
  toasts: [],
  selection: {},
  openPanel: (panel) => set({ panel }),
  closePanel: () => set({ panel: null }),
  toast(toast, ttlMs = 6000) {
    const id = crypto.randomUUID();
    set({ toasts: [...get().toasts.slice(-2), { ...toast, id }] });
    setTimeout(() => get().dismissToast(id), ttlMs);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setSelection: (list, ids) => set({ selection: { ...get().selection, [list]: ids } }),
}));
