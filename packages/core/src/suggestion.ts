// A review comment's ```suggestion block: the code it proposes in place of the lines it's on.
// GitHub applies a comment's suggestion only when it has exactly one; an empty block deletes
// the lines.

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
