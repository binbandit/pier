import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SquareKanban } from "lucide-react";

import { Picker } from "@/components/picker";
import { errorText } from "@/features/actions";
import { useCommands } from "@/keys/registry";
import { q, rpc } from "@/lib/rpc";
import { useUi } from "@/stores/ui";
import { Dock } from "@/ui/dock";
import { Keys } from "@/ui/kbd";
import type { PrView } from "@pier/core/wire";

// Projects (v2) a PR is on, with its Status there; `s p` puts it on or takes it off. Reading
// them needs the project scope, which gh doesn't ask for by default; pier says how to add it.

export function ProjectsLine({ pr }: { pr: PrView }) {
  const { data } = useQuery(q("projects", { prId: pr.id }));
  if (data?.state !== "ok" || data.on.length === 0) return null;
  return (
    <span aria-label="Projects" className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <SquareKanban aria-hidden size={14} className="text-off" />
      {data.on.map((item) => (
        <a
          key={item.itemId}
          href={item.url}
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-fg"
        >
          {item.title}
          {item.status && <span className="text-faint">: {item.status}</span>}
        </a>
      ))}
    </span>
  );
}

export function ProjectsPicker({ pr, onClose }: { pr: PrView; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useUi((s) => s.toast);
  const { data } = useQuery(q("projects", { prId: pr.id }));

  if (data?.state === "no-scope") return <NeedsScope fix={data.fix} onClose={onClose} />;
  const on = data?.state === "ok" ? data.on : [];
  return (
    <Picker
      title="Projects"
      options={
        data?.state === "ok"
          ? data.available.map((p) => ({ key: p.id, label: p.title }))
          : undefined
      }
      selected={on.map((item) => item.projectId)}
      onSave={({ add, remove }) =>
        void rpc("setProjects", {
          prId: pr.id,
          add,
          remove: on.filter((item) => remove.includes(item.projectId)),
        })
          .then(() => client.invalidateQueries({ queryKey: ["projects"] }))
          .catch((error: unknown) => toast({ text: errorText(error), tone: "bad" }))
      }
      onClose={onClose}
    />
  );
}

function NeedsScope({ fix, onClose }: { fix: string; onClose: () => void }) {
  const toast = useUi((s) => s.toast);
  useCommands([
    { id: "projects.close", title: "Close", keys: ["escape"], scope: "panel", run: onClose },
    {
      id: "projects.copy-fix",
      title: "Copy the command",
      keys: ["y"],
      scope: "panel",
      run: () =>
        void navigator.clipboard.writeText(fix).then(() => toast({ text: "Copied", tone: "ok" })),
    },
  ]);
  return (
    <Dock label="Projects">
      <p className="text-ui text-fg">Seeing and changing projects needs the project scope:</p>
      <p className="mt-2 flex items-center gap-4">
        <code className="font-code text-code text-strong">{fix}</code>
        <span className="flex items-center gap-1.5 text-meta text-faint">
          <Keys sequence="y" /> copy
        </span>
        <span className="flex items-center gap-1.5 text-meta text-faint">
          <Keys sequence="escape" /> close
        </span>
      </p>
    </Dock>
  );
}
