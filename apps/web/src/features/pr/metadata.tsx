import { useQuery, useQueryClient } from "@tanstack/react-query";

import { type PickerOption, Picker } from "@/components/picker";
import { errorText } from "@/features/actions";
import { q, rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import { Avatar } from "@/ui/avatar";
import type { Label, Milestone, Person, PrView } from "@pier/core/wire";

// The `s` chord's pickers: labels, assignees, reviewers and milestone. Each save is one write,
// shown on the PR straight away, and `z` undoes it by sending the opposite change.

export type MetadataKind = "labels" | "assignees" | "reviewers" | "milestone";

type Change = { add: string[]; remove: string[] };

const TITLES: Record<MetadataKind, string> = {
  labels: "Labels",
  assignees: "Assignees",
  reviewers: "Reviewers",
  milestone: "Milestone",
};

const REVIEW_STATES: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "asked for changes",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};

export function MetadataPicker({
  pr,
  kind,
  onClose,
}: {
  pr: PrView;
  kind: MetadataKind;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  const repo = { repo: pr.repo };
  const labels = useQuery({ ...q("repoLabels", repo), enabled: kind === "labels" });
  const people = useQuery({
    ...q("assignable", repo),
    enabled: kind === "assignees" || kind === "reviewers",
  });
  const milestones = useQuery({ ...q("milestones", repo), enabled: kind === "milestone" });

  const { options, selected } = choices(pr, kind, {
    labels: labels.data,
    people: people.data,
    milestones: milestones.data,
  });
  const title = (key: string) =>
    milestones.data?.find((m) => String(m.number) === key)?.title ?? key;

  const save = async (change: Change) => {
    const send = (c: Change) =>
      kind === "milestone"
        ? rpc("setMilestone", { prId: pr.id, milestone: c.add[0] ? Number(c.add[0]) : null })
        : rpc("editMetadata", { prId: pr.id, field: kind, ...c });
    try {
      await send(change);
      void client.invalidateQueries();
      toast(
        {
          text: describe(kind, change, title),
          tone: "ok",
          undo: () => void send({ add: change.remove, remove: change.add }),
        },
        6_000,
      );
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };

  return (
    <Picker
      title={TITLES[kind]}
      options={options}
      selected={selected}
      single={kind === "milestone"}
      onSave={(change) => void save(change)}
      onClose={onClose}
    />
  );
}

function choices(
  pr: PrView,
  kind: MetadataKind,
  data: {
    labels: Label[] | undefined;
    people: Person[] | undefined;
    milestones: Milestone[] | undefined;
  },
): { options: PickerOption[] | undefined; selected: string[] } {
  switch (kind) {
    case "labels":
      return {
        options: data.labels?.map((label) => ({
          key: label.name,
          label: label.name,
          detail: label.description,
          lead: (
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: `#${label.color}` }}
            />
          ),
        })),
        selected: pr.labels.map((l) => l.name),
      };
    case "assignees":
      return {
        options: data.people?.map((person) => ({
          key: person.login,
          label: person.login,
          lead: <Avatar login={person.login} url={person.avatarUrl} size={16} />,
        })),
        selected: pr.assignees.map((a) => a.login),
      };
    case "reviewers": {
      const requested = pr.reviewers.filter((r) => r.state === "requested").map((r) => r.login);
      const reviewed = new Map(
        pr.reviewers.filter((r) => r.state !== "requested").map((r) => [r.login, r.state]),
      );
      // Teams can't be listed without org access, but ones already asked can still be removed.
      const teams = requested.filter((login) => login.includes("/"));
      const people = (data.people ?? []).filter((p) => p.login !== pr.author?.login);
      return {
        options: data.people && [
          ...teams.map((team) => ({ key: team, label: team, detail: "team" })),
          ...people.map((person) => {
            const state = reviewed.get(person.login);
            return {
              key: person.login,
              label: person.login,
              detail: state
                ? `${REVIEW_STATES[state] ?? state.toLowerCase()}; picking asks again`
                : null,
              lead: <Avatar login={person.login} url={person.avatarUrl} size={16} />,
            };
          }),
        ],
        selected: requested,
      };
    }
  }
  return {
    options: data.milestones?.map((m) => ({
      key: String(m.number),
      label: m.title,
      detail: m.dueOn ? `due ${new Date(m.dueOn).toLocaleDateString()}` : null,
    })),
    selected: pr.milestone ? [String(pr.milestone.number)] : [],
  };
}

/** "Added bug and docs; removed wontfix", in the words GitHub's timeline would use. */
function describe(kind: MetadataKind, { add, remove }: Change, title: (key: string) => string) {
  const parts =
    kind === "labels"
      ? [add.length > 0 && `added ${list(add)}`, remove.length > 0 && `removed ${list(remove)}`]
      : kind === "assignees"
        ? [
            add.length > 0 && `assigned ${list(add)}`,
            remove.length > 0 && `unassigned ${list(remove)}`,
          ]
        : kind === "reviewers"
          ? [
              add.length > 0 && `asked ${list(add)} to review`,
              remove.length > 0 && `withdrew the request to ${list(remove)}`,
            ]
          : [add[0] ? `moved to ${title(add[0])}` : `removed from ${title(remove[0] ?? "")}`];
  const text = parts.filter(Boolean).join("; ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function list(items: string[]): string {
  return items.length <= 2
    ? items.join(" and ")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
