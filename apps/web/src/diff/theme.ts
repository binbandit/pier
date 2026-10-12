import { registerCustomTheme } from "@pierre/diffs";

// Syntax colours follow achroma: greyscale by default, so the only colour in a diff means
// "added" or "removed". Keywords stand out by weight and brightness, not hue.

export const THEME = "pier-oled";

let registered = false;

export function registerTheme(): void {
  if (registered) return;
  registered = true;
  registerCustomTheme(THEME, async () => ({
    name: THEME,
    type: "dark",
    colors: {
      "editor.background": "#000000",
      "editor.foreground": "#cccccc",
      "editorLineNumber.foreground": "#505050",
      "editorLineNumber.activeForeground": "#a4a4a4",
    },
    tokenColors: [
      { settings: { foreground: "#cccccc" } },
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: { foreground: "#7a7a7a", fontStyle: "italic" },
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
        settings: { foreground: "#e6e6e6", fontStyle: "bold" },
      },
      {
        scope: ["string", "string.quoted", "string.template", "constant.character"],
        settings: { foreground: "#a4a4a4" },
      },
      {
        scope: ["constant.numeric", "constant.language", "support.constant"],
        settings: { foreground: "#b8b8b8" },
      },
      {
        scope: ["entity.name.function", "support.function", "meta.function-call"],
        settings: { foreground: "#e0e0e0" },
      },
      {
        scope: ["entity.name.type", "entity.name.class", "support.type", "support.class"],
        settings: { foreground: "#d4d4d4" },
      },
      {
        scope: ["variable", "variable.parameter", "meta.definition.variable"],
        settings: { foreground: "#b8b8b8" },
      },
      {
        scope: ["punctuation", "meta.brace", "keyword.operator"],
        settings: { foreground: "#8f8f8f" },
      },
      {
        scope: ["entity.name.tag", "support.type.property-name", "meta.object-literal.key"],
        settings: { foreground: "#cccccc" },
      },
      { scope: ["markup.heading"], settings: { foreground: "#e6e6e6", fontStyle: "bold" } },
      { scope: ["markup.inserted"], settings: { foreground: "#89ad72" } },
      { scope: ["markup.deleted"], settings: { foreground: "#cc7b7b" } },
    ],
  }));
}
