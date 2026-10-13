import { GitHubError } from "@/github/client";
import type { GitHubPort } from "@/github/port";
import { parseQuery, toGitHubQuery } from "@pier/core/query";
import type { RemoteSearch } from "@pier/core/wire";

import type { Model } from "./model";
import { Refusal } from "./refusal";
import { prItemBase, standing } from "./views";

// Searching GitHub itself, for PRs pier doesn't track: old ones, or repos outside your scopes.
// Each account asks once for the first matches; PRs pier tracks come from the replica, the rest
// are read once to show and not kept.

const PER_ACCOUNT = 50;

export async function searchGitHub(
  text: string,
  ports: Map<string, GitHubPort>,
  model: Model,
): Promise<RemoteSearch> {
  const { text: query, dropped } = toGitHubQuery(parseQuery(text));
  const asked = await Promise.allSettled(
    [...ports].map(async ([account, port]) => {
      const hits = await port.searchFirst(query, PER_ACCOUNT);
      const untracked = hits.filter((hit) => !model.get(hit.id)).map((hit) => hit.id);
      const read = untracked.length > 0 ? await port.hydrate(untracked) : [];
      return { account, hits, read };
    }),
  );
  const answered = asked.flatMap((a) => (a.status === "fulfilled" ? [a.value] : []));
  if (answered.length === 0) {
    const failed = asked.find((a): a is PromiseRejectedResult => a.status === "rejected");
    const reason: unknown = failed?.reason;
    throw new Refusal(
      reason instanceof GitHubError
        ? `GitHub couldn't search that: ${reason.message}`
        : String(reason),
    );
  }

  const items = new Map<string, RemoteSearch["items"][number]>();
  for (const { account, hits, read } of answered) {
    const docs = new Map(read.map(({ doc }) => [doc.id, doc]));
    for (const hit of hits) {
      if (items.has(hit.id)) continue;
      const record = model.get(hit.id);
      const doc = record?.doc ?? docs.get(hit.id);
      if (!doc) continue;
      items.set(hit.id, {
        ...prItemBase(doc, record?.reader ?? account),
        reason: `On GitHub: ${standing(doc)}`,
      });
    }
  }
  const sorted = [...items.values()].toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { items: sorted, query, dropped };
}
