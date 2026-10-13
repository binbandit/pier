// A review comment's ```suggestion block: the code it proposes in place of the lines it's on.
// GitHub applies a comment's suggestion only when it has exactly one; an empty block deletes
// the lines. What counts is what people can see: a block hidden in an HTML comment or nested in
// another fence isn't drawn as a suggestion on GitHub, so it isn't one here either.

/**
 * The suggestion a comment visibly makes: one block in the raw text, and GitHub's rendering of
 * the comment drawing exactly one suggested change.
 */
export function visibleSuggestion(body: string, bodyHTML: string): string[] | null {
  const drawn = bodyHTML.split("js-suggested-changes-blob").length - 1;
  return drawn === 1 ? suggestionIn(body) : null;
}

/** The suggested lines, or null when the comment doesn't hold exactly one block. */
export function suggestionIn(body: string): string[] | null {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const found: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})\s*suggestion\s*$/.exec(lines[i] ?? "");
    if (!open?.[1]) continue;
    const fence = open[1];
    const block: string[] = [];
    let closed = false;
    for (i++; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const closer = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (closer && closer[0] === fence[0] && closer.length >= fence.length) {
        closed = true;
        break;
      }
      block.push(line);
    }
    // An unclosed fence runs to the end of the comment, as in Markdown.
    found.push(block);
    if (!closed) break;
  }
  return found.length === 1 ? (found[0] ?? null) : null;
}
