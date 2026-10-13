import type { ReleaseRegistry } from "@/registry/release";
import type { Bump } from "@pier/core/wire";

import { bumpKey } from "./bumps";
import type { Revocations, Verdicts } from "./decisions";
import type { Model } from "./model";

// A verdict stands only as long as nothing new is known against its version. Each version with a
// standing verdict is looked up again every hour; an advisory that wasn't known when you decided
// withdraws the verdict, so the PRs carrying it need you again, and the Deps split says so.

/** Lookups at once, to stay gentle with deps.dev. */
const AT_ONCE = 4;

export type AdvisoryWatchDeps = {
  model: Model;
  verdicts: Verdicts;
  revocations: Revocations;
  registry: ReleaseRegistry;
};

export class AdvisoryWatch {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: AdvisoryWatchDeps) {}

  /** Checks every `everyMs`, the first time a minute after start (sooner if it runs more often). */
  start(everyMs: number): void {
    const tick = async () => {
      await this.check().catch((error: unknown) =>
        console.warn(`advisory check: ${String(error)}`),
      );
      this.timer = setTimeout(tick, everyMs);
    };
    this.timer = setTimeout(tick, Math.min(everyMs, 60_000));
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  /** Looks every standing verdict's version up again; returns how many were withdrawn. */
  async check(): Promise<number> {
    const { model, verdicts, revocations, registry } = this.deps;
    // The versions PRs pier tracks move to, each with every version they move from: the lookups
    // the gates read, so refreshing them also fails the advisory gate on the open PRs.
    const carried = new Map<string, Map<string, Bump>>();
    for (const record of model.all()) {
      for (const bump of record.bot?.bumps ?? []) {
        const froms = carried.get(bumpKey(bump)) ?? new Map<string, Bump>();
        froms.set(bump.from ?? "", bump);
        carried.set(bumpKey(bump), froms);
      }
    }

    const standing = [...verdicts.standing()].flatMap(([key, verdict]) => {
      const bumps = [...(carried.get(key)?.values() ?? [])];
      return bumps.length > 0 ? [{ key, verdict, bumps }] : [];
    });
    let withdrawn = 0;
    for (let i = 0; i < standing.length; i += AT_ONCE) {
      await Promise.all(
        standing.slice(i, i + AT_ONCE).map(async ({ key, verdict, bumps }) => {
          const infos = await Promise.all(
            bumps.map((bump) => registry.lookup(bump).catch(() => null)),
          );
          const news = [...new Set(infos.flatMap((info) => info?.advisories ?? []))]
            .filter((id) => !verdict.known.has(id))
            .toSorted();
          const [bump] = bumps;
          if (news.length === 0 || !bump) return;
          verdicts.withdraw(key);
          revocations.record({
            key,
            ecosystem: bump.ecosystem,
            pkg: bump.pkg,
            to: bump.to,
            advisories: news,
            decidedAt: verdict.decidedAt,
          });
          withdrawn++;
        }),
      );
    }
    return withdrawn;
  }
}
