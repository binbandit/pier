// Links to lines in a PR, the way github.com writes them, so a link copied in pier works for
// anyone and a link from github.com opens in pier at the same place:
// /owner/repo/pull/12/files#diff-<sha256 of the path>R10-R14 (L for the old side).

/** GitHub's anchor for a file in a PR: `diff-` and the SHA-256 of its path. */
export async function fileAnchor(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `diff-${hex}`;
}

export type LinkTarget = {
  anchor: string;
  lines: { side: "LEFT" | "RIGHT"; start: number; end: number } | null;
};

export function parseLink(hash: string): LinkTarget | null {
  const m = /^#?(diff-[0-9a-f]{64})(?:([LR])(\d+)(?:-[LR](\d+))?)?$/.exec(hash);
  if (!m?.[1]) return null;
  const start = Number(m[3]);
  return {
    anchor: m[1],
    lines: m[2]
      ? { side: m[2] === "L" ? "LEFT" : "RIGHT", start, end: m[4] ? Number(m[4]) : start }
      : null,
  };
}

export async function lineLink(
  repo: string,
  number: number,
  path: string,
  lines: { side: "LEFT" | "RIGHT"; start: number; end: number } | null,
): Promise<string> {
  const side = lines?.side === "LEFT" ? "L" : "R";
  const at = lines
    ? `${side}${lines.start}${lines.end !== lines.start ? `-${side}${lines.end}` : ""}`
    : "";
  return `https://github.com/${repo}/pull/${number}/files#${await fileAnchor(path)}${at}`;
}
