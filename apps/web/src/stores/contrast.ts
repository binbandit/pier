import { useEffect } from "react";
import { create } from "zustand";

import { usePrefs } from "./prefs";

// Night contrast: from 20:00 to 07:00 every grey of text, and the code in diffs, sits 10% lower,
// so a late session on an OLED panel is easier on the eyes. Black stays black. You can pin day or
// night instead (palette: "contrast").

export type Contrast = "day" | "night";
export type ContrastChoice = Contrast | "auto";

const NIGHT_FROM = 20;
const NIGHT_UNTIL = 7;

export function contrastAt(choice: ContrastChoice, at: Date): Contrast {
  if (choice !== "auto") return choice;
  const hour = at.getHours();
  return hour >= NIGHT_FROM || hour < NIGHT_UNTIL ? "night" : "day";
}

// Set before the first paint, so a page opened at night doesn't flash day contrast first.
const initial = contrastAt(usePrefs.getState().contrast, new Date());
document.documentElement.dataset.contrast = initial;

export const useContrast = create<{ mode: Contrast }>(() => ({ mode: initial }));

/** Keeps the mode (and `data-contrast` on the page, which the CSS reads) in step with the clock. */
export function useContrastSchedule(): void {
  const choice = usePrefs((s) => s.contrast);
  useEffect(() => {
    const apply = () => {
      const mode = contrastAt(choice, new Date());
      document.documentElement.dataset.contrast = mode;
      useContrast.setState({ mode });
    };
    apply();
    const timer = setInterval(apply, 60_000);
    return () => clearInterval(timer);
  }, [choice]);
}
