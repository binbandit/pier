import { create } from "zustand";
import { persist } from "zustand/middleware";

// How you like things shown, kept in the browser across PRs and restarts.

type Prefs = {
  /** Side by side instead of one column. */
  split: boolean;
  toggleSplit: () => void;
};

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      split: false,
      toggleSplit: () => set((s) => ({ split: !s.split })),
    }),
    { name: "pier.prefs" },
  ),
);
