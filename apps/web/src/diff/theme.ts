import { registerCustomTheme } from "@pierre/diffs";

import type { Contrast } from "@/stores/contrast";

// Syntax colours follow achroma: greyscale by default, so the only colour in a diff means
// "added" or "removed". Keywords stand out by weight and brightness, not hue. At night every
// colour sits a tenth lower, as the rest of the app's text does.

export const THEMES: Record<Contrast, string> = { day: "pier-oled", night: "pier-oled-night" };

let registered = false;

export function registerTheme(): void {
  if (registered) return;
  registered = true;
  registerCustomTheme(THEMES.day, async () => theme(THEMES.day, 1));
  registerCustomTheme(THEMES.night, async () => theme(THEMES.night, 0.9));
}

/** `#rrggbb` with each channel scaled, so black stays black. */
function dim(hex: string, scale: number): string {
  const channels = [1, 3, 5].map((at) =>
    Math.round(Number.parseInt(hex.slice(at, at + 2), 16) * scale),
  );
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function theme(name: string, scale: number) {
  const c = (hex: string) => dim(hex, scale);
  return {
    name,
    type: "dark" as const,
    colors: {
      "editor.background": c("#000000"),
      "editor.foreground": c("#cccccc"),
      "editorLineNumber.foreground": c("#505050"),
      "editorLineNumber.activeForeground": c("#a4a4a4"),
    },
    tokenColors: [
      { settings: { foreground: c("#cccccc") } },
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: { foreground: c("#7a7a7a"), fontStyle: "italic" },
      },
      {
        scope: [
          "keyword",
          "storage",
          "storage.type",
          "storage.modifier",
          "keyword.operator.new",
          "keyword.control",
        ],
        settings: { foreground: c("#e6e6e6"), fontStyle: "bold" },
      },
      {
        scope: ["string", "string.quoted", "string.template", "constant.character"],
        settings: { foreground: c("#a4a4a4") },
      },
      {
        scope: ["constant.numeric", "constant.language", "support.constant"],
        settings: { foreground: c("#b8b8b8") },
      },
      {
        scope: ["entity.name.function", "support.function", "meta.function-call"],
        settings: { foreground: c("#e0e0e0") },
      },
      {
        scope: ["entity.name.type", "entity.name.class", "support.type", "support.class"],
        settings: { foreground: c("#d4d4d4") },
      },
      {
        scope: ["variable", "variable.parameter", "meta.definition.variable"],
        settings: { foreground: c("#b8b8b8") },
      },
      {
        scope: ["punctuation", "meta.brace", "keyword.operator"],
        settings: { foreground: c("#8f8f8f") },
      },
      {
        scope: ["entity.name.tag", "support.type.property-name", "meta.object-literal.key"],
        settings: { foreground: c("#cccccc") },
      },
      { scope: ["markup.heading"], settings: { foreground: c("#e6e6e6"), fontStyle: "bold" } },
      { scope: ["markup.inserted"], settings: { foreground: c("#89ad72") } },
      { scope: ["markup.deleted"], settings: { foreground: c("#cc7b7b") } },
    ],
  };
}
