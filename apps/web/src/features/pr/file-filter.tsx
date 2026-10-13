import { Picker, type PickerOption } from "@/components/picker";
import { plural } from "@/lib/format";
import { codeOwnersMatcher } from "@pier/core/codeowners";
import type { CodeOwners, DiffFile, ViewedState } from "@pier/core/wire";

// Narrowing a PR's files the way GitHub's file filter does, raised with `d f`: only the files
// you own, and which kinds to show (viewed, deleted, each extension). Everything shows until
// you turn it off.

export type FileFilter = {
  onlyYours: boolean;
  /** "viewed", "deleted", or an extension like ".lock" ("" for files without one). */
  hidden: string[];
};

export const NO_FILTER: FileFilter = { onlyYours: false, hidden: [] };

export type Ownership = (path: string) => { owners: string[]; yours: boolean };

/** Who owns each path under the base branch's CODEOWNERS; null when there isn't one. */
export function ownershipOf(codeOwners: CodeOwners | null): Ownership | null {
  if (!codeOwners) return null;
  const ownersOf = codeOwnersMatcher(codeOwners.rules);
  // Logins and team names aren't case sensitive.
  const you = new Set(codeOwners.you.map((name) => name.toLowerCase()));
  return (path) => {
    const owners = ownersOf(path);
    return { owners, yours: owners.some((owner) => you.has(owner.toLowerCase())) };
  };
}

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

export function filterFiles<T extends DiffFile>(
  files: T[],
  filter: FileFilter,
  viewed: Record<string, ViewedState>,
  ownership: Ownership | null,
): T[] {
  if (!filter.onlyYours && filter.hidden.length === 0) return files;
  const hidden = new Set(filter.hidden);
  return files.filter(
    (file) =>
      !(filter.onlyYours && ownership && !ownership(file.path).yours) &&
      !(hidden.has("viewed") && viewed[file.path] === "viewed") &&
      !(hidden.has("deleted") && file.status === "removed") &&
      !hidden.has(extensionOf(file.path)),
  );
}

export function FileFilterPicker({
  files,
  filter,
  viewed,
  ownership,
  onChange,
  onClose,
}: {
  files: DiffFile[];
  filter: FileFilter;
  viewed: Record<string, ViewedState>;
  ownership: Ownership | null;
  onChange: (filter: FileFilter) => void;
  onClose: () => void;
}) {
  const count = (test: (file: DiffFile) => boolean) => plural(files.filter(test).length, "file");
  const extensions = Map.groupBy(files, (file) => extensionOf(file.path));
  const options: PickerOption[] = [
    ...(ownership
      ? [
          {
            key: "yours",
            label: "Only files you own",
            detail: count((f) => ownership(f.path).yours),
          },
        ]
      : []),
    { key: "viewed", label: "Viewed files", detail: count((f) => viewed[f.path] === "viewed") },
    ...(files.some((f) => f.status === "removed")
      ? [{ key: "deleted", label: "Deleted files", detail: count((f) => f.status === "removed") }]
      : []),
    ...[...extensions]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([extension, list]) => ({
        key: extension,
        label: extension || "No extension",
        detail: plural(list.length, "file"),
      })),
  ];
  // Checked means shown, except "Only files you own", which narrows when it's on.
  const selected = [
    ...(filter.onlyYours ? ["yours"] : []),
    ...options.map((o) => o.key).filter((key) => key !== "yours" && !filter.hidden.includes(key)),
  ];

  return (
    <Picker
      title="Show files"
      options={options}
      selected={selected}
      keepOrder
      onSave={({ add, remove }) =>
        onChange({
          onlyYours: add.includes("yours") || (filter.onlyYours && !remove.includes("yours")),
          hidden: [
            ...filter.hidden.filter((key) => !add.includes(key)),
            ...remove.filter((key) => key !== "yours"),
          ],
        })
      }
      onClose={onClose}
    />
  );
}
