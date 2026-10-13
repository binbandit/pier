import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { errorText } from "@/features/actions";
import { useCommands } from "@/keys/registry";
import { plural, shortRepo } from "@/lib/format";
import { rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import { Keys } from "@/ui/kbd";
import { When } from "@/ui/when";
import type { PrRef, Revocation } from "@pier/core/wire";

// A verdict an advisory took back. The open PRs carrying the version need deciding again (the
// advisory gate now fails them). The merged ones already shipped it; whether to revert depends on
// whether the version they came from is any safer, so they're listed, not acted on.

export function RevocationNotice({
  revocation,
  inGroup = false,
}: {
  revocation: Revocation;
  /** On the group canvas, where `b i` closes the open PRs. */
  inGroup?: boolean;
}) {
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  const { pkg, to, advisories, decidedAt, open, merged } = revocation;
  const approved = open.filter((pr) => pr.approved).length;

  const dismiss = async () => {
    try {
      await rpc("dismissRevocation", { key: revocation.key });
      void client.invalidateQueries();
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };

  useCommands([
    {
      id: `revocation.dismiss.${revocation.key}`,
      title: `Dismiss the ${pkg} ${to} advisory notice`,
      scope: "surface",
      group: "Deps",
      run: () => void dismiss(),
    },
  ]);

  return (
    <section
      aria-label={`Advisory against ${pkg} ${to}`}
      className="max-w-[1320px] border-l-2 border-bad py-0.5 pl-4"
    >
      <p className="text-ui text-strong">
        <span className="font-code">
          {pkg} {to}
        </span>{" "}
        has a new advisory:{" "}
        {advisories.map((id, i) => (
          <span key={id}>
            {i > 0 && ", "}
            <a
              href={advisoryUrl(id)}
              target="_blank"
              rel="noreferrer noopener"
              className="font-code text-bad hover:underline"
            >
              {id}
            </a>
          </span>
        ))}
      </p>
      <p className="mt-1 text-meta text-muted">
        You decided on it <When at={decidedAt} suffix />, before this was known, so your verdict is
        withdrawn.
        {open.length > 0 &&
          ` Still open in ${plural(open.length, "PR")}${approved > 0 ? `, ${approved} with your approval, which can still merge` : ""}.`}
        {merged.length > 0 && (
          <>
            {" "}
            Already merged in <Refs prs={merged} />.
          </>
        )}
      </p>
      <p className="mt-2 flex items-center gap-5 text-meta">
        {inGroup
          ? open.length > 0 && (
              <span className="flex items-center gap-1.5 text-faint">
                <Keys sequence="b i" /> close them and skip this version
              </span>
            )
          : open.length > 0 && (
              <Link
                to="/deps/$"
                params={{ _splat: revocation.key }}
                className="text-fg hover:text-strong"
              >
                Review the open {open.length === 1 ? "PR" : "PRs"}
              </Link>
            )}
        <button type="button" onClick={() => void dismiss()} className="text-muted hover:text-fg">
          Dismiss
        </button>
      </p>
    </section>
  );
}

function Refs({ prs }: { prs: PrRef[] }) {
  return prs.map((pr, i) => {
    const [owner = "", repo = ""] = pr.repo.split("/");
    return (
      <span key={pr.prId}>
        {i > 0 && ", "}
        <Link
          to="/$owner/$repo/pull/$number"
          params={{ owner, repo, number: pr.number }}
          title={pr.title}
          className="text-fg hover:text-strong hover:underline"
        >
          {shortRepo(pr.repo)}#{pr.number}
        </Link>
      </span>
    );
  });
}

/** GitHub's page for its own advisories; OSV's for the rest (RUSTSEC, PYSEC, GO-...). */
function advisoryUrl(id: string): string {
  return id.startsWith("GHSA-")
    ? `https://github.com/advisories/${id}`
    : `https://osv.dev/vulnerability/${id}`;
}
