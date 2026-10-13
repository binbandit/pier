import { useQuery, useQueryClient } from "@tanstack/react-query";

import { type PickerOption, Picker } from "@/components/picker";
import { errorText } from "@/features/actions";
import { q, rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import { Avatar } from "@/ui/avatar";
import type { LockReason, PrView } from "@pier/core/wire";

// The `s` chord's pickers: labels, assignees, reviewers, milestone, base branch and lock. Each
// save is one write, shown on the PR straight away, and `z` undoes it by sending the opposite.

export type MetadataKind = "labels" | "assignees" | "reviewers" | "milestone" | "base" | "lock";

type Change = { add: string[]; remove: string[] };

/** Everything a picker needs to know about one field of the PR. */
type Field = {
  title: string;
  single: boolean;
  /** Whether picking the current value clears it (a milestone can be cleared, a base can't). */
  clearable: boolean;
  options: PickerOption[] | undefined;
  selected: string[];
  send: (change: Change) => Promise<unknown>;
  describe: (change: Change) => string;
};

const REVIEW_STATES: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "asked for changes",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};

const LOCK_REASONS: { reason: LockReason; label: string }[] = [
  { reason: "resolved", label: "Resolved" },
  { reason: "off-topic", label: "Off topic" },
  { reason: "too heated", label: "Too heated" },
  { reason: "spam", label: "Spam" },
];

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
  const field = useField(pr, kind);

  const save = async (change: Change) => {
    try {
      await field.send(change);
      void client.invalidateQueries();
      toast(
        {
          text: capitalise(field.describe(change)),
          tone: "ok",
          undo: () => void field.send({ add: change.remove, remove: change.add }),
        },
        6_000,
      );
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };

  return (
    <Picker
      title={field.title}
      options={field.options}
      selected={field.selected}
      single={field.single}
      clearable={field.clearable}
      onSave={(change) => void save(change)}
      onClose={onClose}
    />
  );
}

function useField(pr: PrView, kind: MetadataKind): Field {
  const repo = { repo: pr.repo };
  const labels = useQuery({ ...q("repoLabels", repo), enabled: kind === "labels" });
  const people = useQuery({
    ...q("assignable", repo),
    enabled: kind === "assignees" || kind === "reviewers",
  });
  const milestones = useQuery({ ...q("milestones", repo), enabled: kind === "milestone" });
  const branches = useQuery({ ...q("branches", repo), enabled: kind === "base" });
  const edit = (field: "labels" | "assignees" | "reviewers") => (c: Change) =>
    rpc("editMetadata", { prId: pr.id, field, ...c });
  const several = { single: false, clearable: true };

  switch (kind) {
    case "labels":
      return {
        ...several,
        title: "Labels",
        options: labels.data?.map((label) => ({
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
        send: edit("labels"),
        describe: ({ add, remove }) =>
          sentence([
            add.length > 0 && `added ${list(add)}`,
            remove.length > 0 && `removed ${list(remove)}`,
          ]),
      };
    case "assignees":
      return {
        ...several,
        title: "Assignees",
        options: people.data?.map((person) => ({
          key: person.login,
          label: person.login,
          lead: <Avatar login={person.login} url={person.avatarUrl} size={16} />,
        })),
        selected: pr.assignees.map((a) => a.login),
        send: edit("assignees"),
        describe: ({ add, remove }) =>
          sentence([
            add.length > 0 && `assigned ${list(add)}`,
            remove.length > 0 && `unassigned ${list(remove)}`,
          ]),
      };
    case "reviewers": {
      const requested = pr.reviewers.filter((r) => r.state === "requested").map((r) => r.login);
      const reviewed = new Map(
        pr.reviewers.filter((r) => r.state !== "requested").map((r) => [r.login, r.state]),
      );
      // Teams can't be listed without org access, but ones already asked can still be removed.
      const teams = requested.filter((login) => login.includes("/"));
      return {
        ...several,
        title: "Reviewers",
        options: people.data && [
          ...teams.map((team) => ({ key: team, label: team, detail: "team" })),
          ...people.data
            .filter((p) => p.login !== pr.author?.login)
            .map((person) => {
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
        send: edit("reviewers"),
        describe: ({ add, remove }) =>
          sentence([
            add.length > 0 && `asked ${list(add)} to review`,
            remove.length > 0 && `withdrew the request to ${list(remove)}`,
          ]),
      };
    }
    case "milestone": {
      const title = (key: string | undefined) =>
        milestones.data?.find((m) => String(m.number) === key)?.title ?? key ?? "";
      return {
        title: "Milestone",
        single: true,
        clearable: true,
        options: milestones.data?.map((m) => ({
          key: String(m.number),
          label: m.title,
          detail: m.dueOn ? `due ${new Date(m.dueOn).toLocaleDateString()}` : null,
        })),
        selected: pr.milestone ? [String(pr.milestone.number)] : [],
        send: (c) =>
          rpc("setMilestone", { prId: pr.id, milestone: c.add[0] ? Number(c.add[0]) : null }),
        describe: ({ add, remove }) =>
          add[0] ? `moved to ${title(add[0])}` : `removed from ${title(remove[0])}`,
      };
    }
    case "base":
      return {
        title: "Base branch",
        single: true,
        clearable: false,
        options: branches.data
          ?.filter((name) => name !== pr.headRefName)
          .map((name) => ({ key: name, label: name })),
        selected: [pr.baseRefName],
        send: (c) =>
          c.add[0] ? rpc("editPr", { prId: pr.id, base: c.add[0] }) : Promise.resolve(),
        describe: ({ add }) => `changed the base to ${add[0] ?? pr.baseRefName}`,
      };
  }
  return {
    title: pr.locked ? "Conversation locked" : "Lock conversation",
    single: true,
    clearable: true,
    options: LOCK_REASONS.map(({ reason, label }) => ({
      key: reason,
      label,
      detail: pr.locked === reason ? "picking unlocks" : null,
    })),
    selected: pr.locked ? [pr.locked] : [],
    send: (c) =>
      rpc("setLocked", {
        prId: pr.id,
        reason: LOCK_REASONS.find((r) => r.reason === c.add[0])?.reason ?? null,
      }),
    describe: ({ add }) => (add[0] ? `locked as ${add[0]}` : "unlocked the conversation"),
  };
}

function sentence(parts: (string | false)[]): string {
  return parts.filter(Boolean).join("; ");
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function list(items: string[]): string {
  return items.length <= 2
    ? items.join(" and ")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
