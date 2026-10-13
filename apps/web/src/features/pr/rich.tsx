import { useQuery } from "@tanstack/react-query";
import { type } from "arktype";
import { useState } from "react";

import { Markdown } from "@/components/markdown";
import { q } from "@/lib/rpc";
import type { DiffFile } from "@pier/core/wire";

// Files that read better drawn than as text: images (before and after, side by side), and
// Markdown, CSV and notebooks rendered as they'd appear. Read only when shown.

export type RichKind = "image" | "markdown" | "csv" | "notebook";

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  // Drawn through <img>, an SVG's scripts never run.
  svg: "image/svg+xml",
};

function extension(path: string): string {
  return path.slice(path.lastIndexOf(".") + 1).toLowerCase();
}

export function richKindOf(path: string): RichKind | null {
  const ext = extension(path);
  if (IMAGE_TYPES[ext]) return "image";
  if (ext === "md" || ext === "markdown" || ext === "mdx") return "markdown";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "ipynb") return "notebook";
  return null;
}

type Range = { from: string | null; to: string | null };

export function RichView({
  prId,
  file,
  range,
  kind,
}: {
  prId: string;
  file: DiffFile;
  range: Range;
  kind: RichKind;
}) {
  return kind === "image" ? (
    <ImageDiff prId={prId} file={file} range={range} />
  ) : (
    <RenderedText prId={prId} file={file} range={range} kind={kind} />
  );
}

function ImageDiff({ prId, file, range }: { prId: string; file: DiffFile; range: Range }) {
  const { data, isPending } = useQuery(
    q("fileBytes", {
      prId,
      path: file.path,
      previousPath: file.previousPath,
      from: range.from,
      to: range.to,
    }),
  );
  if (isPending) return <p className="px-1 py-3 text-meta text-faint">Reading the image</p>;
  const mime = IMAGE_TYPES[extension(file.path)] ?? "application/octet-stream";
  const sides = [
    { label: "Before", base64: file.status === "added" ? null : (data?.before ?? null) },
    { label: "After", base64: file.status === "removed" ? null : (data?.after ?? null) },
  ].filter((side) => side.base64 !== null || side.label === "After");
  return (
    <div className="grid grid-cols-2 gap-4 py-3">
      {sides.map((side) => (
        <figure key={side.label} className="min-w-0">
          <figcaption className="mb-2 text-meta text-faint">{side.label}</figcaption>
          {side.base64 ? (
            <Picture
              src={`data:${mime};base64,${side.base64}`}
              bytes={(side.base64.length * 3) / 4}
            />
          ) : (
            <p className="text-meta text-faint">
              {file.status === "removed" ? "Removed" : "Too large to show here (over 5 MB)"}
            </p>
          )}
        </figure>
      ))}
    </div>
  );
}

function Picture({ src, bytes }: { src: string; bytes: number }) {
  const [size, setSize] = useState<string | null>(null);
  return (
    <>
      <div className="flex max-h-[480px] items-center justify-center overflow-hidden rounded-sm border border-line">
        <img
          src={src}
          alt=""
          onLoad={(e) =>
            setSize(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)
          }
          className="max-h-[480px] max-w-full object-contain"
        />
      </div>
      <p className="mt-1.5 font-code text-meta text-faint">
        {size && `${size}, `}
        {bytes < 1024 ? `${Math.round(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`}
      </p>
    </>
  );
}

function RenderedText({
  prId,
  file,
  range,
  kind,
}: {
  prId: string;
  file: DiffFile;
  range: Range;
  kind: Exclude<RichKind, "image">;
}) {
  const { data, isPending } = useQuery(
    q("fileContents", {
      prId,
      path: file.path,
      previousPath: file.previousPath,
      from: range.from,
      to: range.to,
    }),
  );
  if (isPending) return <p className="px-1 py-3 text-meta text-faint">Reading the file</p>;
  // What it says now; a removed file, what it said.
  const text = file.status === "removed" ? data?.before : data?.after;
  if (text === null || text === undefined) {
    return <p className="px-1 py-3 text-meta text-faint">This file can't be read as text.</p>;
  }
  return (
    <div className="max-w-[900px] py-4">
      {kind === "markdown" && <Markdown source={text} />}
      {kind === "csv" && <Table text={text} tabs={extension(file.path) === "tsv"} />}
      {kind === "notebook" && <Notebook text={text} />}
    </div>
  );
}

const ROW_LIMIT = 500;

function Table({ text, tabs }: { text: string; tabs: boolean }) {
  // Rows and columns have nothing but their place to tell them apart.
  const rows = parseDelimited(text, tabs ? "\t" : ",").map((cells) => positioned(cells));
  const [head, ...body] = positioned(rows);
  return (
    <div className="overflow-x-auto">
      <table className="w-max min-w-full border-collapse font-code text-meta">
        <thead>
          <tr>
            {(head?.value ?? []).map((cell) => (
              <th
                key={cell.key}
                className="border-b border-line-strong px-3 py-1.5 text-left font-medium text-muted"
              >
                {cell.value}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.slice(0, ROW_LIMIT).map((row) => (
            <tr key={row.key} className="border-b border-line">
              {row.value.map((cell) => (
                <td key={cell.key} className="px-3 py-1 text-fg">
                  {cell.value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {body.length > ROW_LIMIT && (
        <p className="mt-2 text-meta text-faint">
          The first {ROW_LIMIT} of {body.length} rows.
        </p>
      )}
    </div>
  );
}

/** Items keyed by where they sit, for lists whose items have nothing else to go by. */
function positioned<T>(items: T[]): { key: string; value: T }[] {
  return items.map((value, at) => ({ key: String(at), value }));
}

/** CSV/TSV rows, with quoted fields (and quotes doubled inside them), as RFC 4180 has it. */
export function parseDelimited(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === separator) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) rows.push([...row, field]);
  return rows;
}

const notebook = type({
  cells: type({
    cell_type: "string",
    source: "string | string[]",
    "outputs?": type({ "text?": "string | string[]", "data?": "Record<string, unknown>" }).array(),
  }).array(),
});

/** Notebook text fields come as a string or a list of lines. */
function textOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((line) => typeof line === "string"))
    return value.join("");
  return null;
}

function Notebook({ text }: { text: string }) {
  let parsed: typeof notebook.infer | type.errors;
  try {
    parsed = notebook(JSON.parse(text));
  } catch {
    return <p className="text-meta text-faint">This notebook isn't valid JSON.</p>;
  }
  if (parsed instanceof type.errors) {
    return <p className="text-meta text-faint">This doesn't look like a Jupyter notebook.</p>;
  }
  return (
    <ol className="space-y-4">
      {positioned(parsed.cells).map(({ key, value: cell }) => (
        <li key={key}>
          {cell.cell_type === "markdown" ? (
            <Markdown source={textOf(cell.source) ?? ""} />
          ) : (
            <>
              <pre className="overflow-x-auto rounded-sm border border-line px-3 py-2 font-code text-code text-fg">
                {textOf(cell.source)}
              </pre>
              {positioned(cell.outputs ?? []).map(({ key: at, value: output }) => {
                const plain = textOf(output.text) ?? textOf(output.data?.["text/plain"]);
                return plain === null ? null : (
                  <pre
                    key={at}
                    className="mt-1 overflow-x-auto px-3 font-code text-meta text-muted"
                  >
                    {plain}
                  </pre>
                );
              })}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
