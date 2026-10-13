import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ContrastChoice } from "./contrast";

// How you like things shown, kept in the browser across PRs and restarts.

type Prefs = {
  /** Side by side instead of one column. */
  split: boolean;
  toggleSplit: () => void;
  /** Night contrast by the clock, or pinned to one. */
  contrast: ContrastChoice;
  setContrast: (contrast: ContrastChoice) => void;
};

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      split: false,
      toggleSplit: () => set((s) => ({ split: !s.split })),
      contrast: "auto",
      setContrast: (contrast) => set({ contrast }),
    }),
    { name: "pier.prefs" },
  ),
);
