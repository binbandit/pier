import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ContrastChoice } from "./contrast";

// How you like things shown, kept in the browser across PRs and restarts.

type Prefs = {
  /** Side by side instead of one column. */
  split: boolean;
  toggleSplit: () => void;
  /** Include commits, pushes and metadata updates in the PR conversation. */
  showHistoryUpdates: boolean;
  toggleHistoryUpdates: () => void;
  /** Night contrast by the clock, or pinned to one. */
  contrast: ContrastChoice;
  setContrast: (contrast: ContrastChoice) => void;
  /** A system notification when a PR becomes your turn while pier is in the background. */
  notify: boolean;
  setNotify: (notify: boolean) => void;
};

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      split: false,
      toggleSplit: () => set((s) => ({ split: !s.split })),
      showHistoryUpdates: true,
      toggleHistoryUpdates: () => set((s) => ({ showHistoryUpdates: !s.showHistoryUpdates })),
      contrast: "auto",
      setContrast: (contrast) => set({ contrast }),
      notify: false,
      setNotify: (notify) => set({ notify }),
    }),
    { name: "pier.prefs" },
  ),
);
