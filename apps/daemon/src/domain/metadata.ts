import type { PrDoc } from "@/github/pr-doc";
import type { CommandPayload } from "@/outbox/outbox";
import type { CommandKind, Label, Milestone, Person, PrView } from "@pier/core/wire";

// Labels, assignees, reviewers, milestone and draft as they'll be once the edits still in the
// outbox land, so a change shows the moment it's made. Only these reversible fields are laid
// over; closing and merging show as pending instead.

export type PendingEdit = { kind: CommandKind; payload: CommandPayload };

/** What's known about the repo from its pickers, to fill in colours, avatars and titles. */
export type RepoKnown = { labels: Label[]; people: Person[]; milestones: Milestone[] };

type Overlaid = Pick<PrView, "labels" | "assignees" | "milestone" | "isDraft"> & {
  /** Pending review requests, users by login and teams as "org/slug". */
  requested: string[];
};

export function overlayMetadata(doc: PrDoc, pending: PendingEdit[], known: RepoKnown): Overlaid {
  let labels = doc.labels.map((l) => l.name);
  let assignees = doc.assignees.map((a) => a.login);
  // Bots are keyed "bot:login" so they can be asked again by login, like the picker does.
  let requested = doc.reviewRequests.map((r) => (r.kind === "bot" ? `bot:${r.login}` : r.login));
  let milestone = doc.milestone;
  let isDraft = doc.isDraft;

  for (const { kind, payload } of pending) {
    if (kind === "labels") labels = edit(labels, payload);
    else if (kind === "assignees") assignees = edit(assignees, payload);
    else if (kind === "reviewers") requested = edit(requested, payload);
    else if (kind === "draft") isDraft = payload.draft ?? isDraft;
    else if (kind === "milestone") {
      milestone =
        payload.milestone == null
          ? null
          : (known.milestones.find((m) => m.number === payload.milestone) ?? milestone);
    }
  }

  return {
    labels: labels.map((name) => ({
      name,
      color:
        doc.labels.find((l) => l.name === name)?.color ??
        known.labels.find((l) => l.name === name)?.color ??
        "7a7a7a",
    })),
    assignees: assignees.map(
      (login) =>
        doc.assignees.find((a) => a.login === login) ??
        known.people.find((p) => p.login === login) ?? {
          login,
          avatarUrl: `https://avatars.githubusercontent.com/${encodeURIComponent(login)}`,
        },
    ),
    milestone,
    isDraft,
    requested,
  };
}

function edit(current: string[], { add = [], remove = [] }: CommandPayload): string[] {
  return [
    ...current.filter((x) => !remove.includes(x)),
    ...add.filter((x) => !current.includes(x)),
  ];
}
