import type { MergeInfo } from "@/github/port";
import type { PrDoc } from "@/github/pr-doc";
import type { Blocker, Runway } from "@pier/core/wire";

// Why a PR can't merge yet, in plain words, each with the key that fixes it when one exists.
// GitHub only says "blocked"; this puts the reasons back together from the PR's state.

export function buildRunway(
  doc: Pick<PrDoc, "checks" | "reviewRequests">,
  info: MergeInfo,
  conflicts: string[] = [],
): Runway {
  const blockers: Blocker[] = [];
  const canAutoMerge = info.autoMergeAllowed && info.canEnableAutoMerge;

  if (info.isDraft) blockers.push({ text: "It's still a draft", fix: "ready" });
  if (info.mergeable === "CONFLICTING") {
    blockers.push({
      text:
        conflicts.length === 0
          ? "It conflicts with the base branch"
          : `It conflicts with the base branch in ${conflictList(conflicts)}`,
      fix: null,
    });
  } else if (info.mergeStateStatus === "BEHIND") {
    blockers.push({
      text: "It's behind the base branch",
      fix: info.canUpdateBranch ? "update-branch" : null,
    });
  }
  if (doc.checks.state === "failure") {
    blockers.push({ text: checksFailing(doc.checks.failing), fix: "rerun" });
  } else if (doc.checks.state === "pending") {
    blockers.push({
      text: `Checks still running (${doc.checks.pending})`,
      fix: canAutoMerge ? "auto-merge" : null,
    });
  }
  if (info.reviewDecision === "CHANGES_REQUESTED") {
    blockers.push({ text: "Changes were requested", fix: null });
  } else if (info.reviewDecision === "REVIEW_REQUIRED") {
    // GitHub asks code owners itself; naming who it asked says whose approval would count.
    const owners = doc.reviewRequests.filter((r) => r.asCodeOwner).map((r) => r.login);
    blockers.push({
      text:
        owners.length === 0
          ? "It needs an approving review"
          : `It needs an approving review; ${owners.join(", ")} ${owners.length === 1 ? "was" : "were"} asked as code ${owners.length === 1 ? "owner" : "owners"}`,
      fix: canAutoMerge ? "auto-merge" : null,
    });
  }
  if (info.mergeStateStatus === "UNKNOWN" && blockers.length === 0) {
    blockers.push({ text: "GitHub is still working out whether it can merge", fix: null });
  }
  if (info.mergeStateStatus === "BLOCKED" && blockers.length === 0) {
    blockers.push({ text: "A branch rule is blocking it (GitHub doesn't say which)", fix: null });
  }

  return {
    ready:
      blockers.length === 0 && ["CLEAN", "HAS_HOOKS", "UNSTABLE"].includes(info.mergeStateStatus),
    blockers,
    methods: info.methods,
    defaultMethod: info.defaultMethod,
    messages: info.messages,
    canAutoMerge,
    autoMerge: info.autoMerge,
    mergeQueue: info.mergeQueue,
    canUpdateBranch: info.canUpdateBranch,
    queued: info.mergeQueueEnabled,
    // Conflicts can't be bypassed; failing rules can, by an admin who means it.
    canBypass:
      info.canMergeAsAdmin &&
      blockers.length > 0 &&
      info.mergeable !== "CONFLICTING" &&
      !info.isDraft,
  };
}

export function checksFailing(count: number): string {
  if (count === 0) return "Some checks failing";
  return count === 1 ? "1 check failing" : `${count} checks failing`;
}

function conflictList(files: string[]): string {
  const shown = files.slice(0, 3).join(", ");
  return files.length > 3 ? `${shown} and ${files.length - 3} more` : shown;
}
