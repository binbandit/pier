import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { clsx } from "clsx";
import type { ReactNode } from "react";

import { useCommands, useKeyDispatcher } from "@/keys/registry";
import { useServerEvents } from "@/lib/events";
import { q } from "@/lib/rpc";
import { useContrastSchedule } from "@/stores/contrast";
import { usePrefs } from "@/stores/prefs";
import { useUi } from "@/stores/ui";

import { Cheatsheet } from "./cheatsheet";
import { EscapeHatch } from "./escape";
import { Palette } from "./palette";
import { PlanStrip } from "./plan-strip";
import { StatusLine } from "./status-line";
import { Toasts } from "./toasts";

// The frame around every screen: a quiet rail on the left, the surface in the middle, and the
// status line along the bottom. Confirmations rise out of the status line rather than floating
// over the work as modals.

const SPLITS = [
  { split: "review", label: "Review", keys: "g r" },
  { split: "deps", label: "Deps", keys: "g d" },
  { split: "mine", label: "Mine", keys: "g m" },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  useKeyDispatcher();
  useServerEvents();
  useContrastSchedule();
  const setContrast = usePrefs((s) => s.setContrast);
  const navigate = useNavigate();
  const panel = useUi((s) => s.panel);
  const openPanel = useUi((s) => s.openPanel);

  useCommands([
    ...SPLITS.map(({ split, label, keys }) => ({
      id: `go.${split}`,
      title: `Go to ${label}`,
      keys: [keys],
      scope: "global" as const,
      group: "Go to",
      run: () => void navigate({ to: "/inbox/$split", params: { split } }),
    })),
    {
      id: "go.inbox",
      title: "Go to inbox",
      keys: ["g i"],
      scope: "global",
      group: "Go to",
      run: () => void navigate({ to: "/" }),
    },
    {
      id: "go.flight",
      title: "Go to In flight",
      keys: ["g f"],
      scope: "global",
      group: "Go to",
      run: () => void navigate({ to: "/flight" }),
    },
    {
      id: "go.search",
      title: "Search",
      keys: ["/", "g s"],
      scope: "global",
      group: "Go to",
      run: () => void navigate({ to: "/search", search: { q: "" } }),
    },
    {
      id: "go.log",
      title: "Go to Log",
      keys: ["g l"],
      scope: "global",
      group: "Go to",
      run: () => void navigate({ to: "/log" }),
    },
    {
      id: "palette",
      title: "Command palette",
      keys: ["mod+k"],
      scope: "global",
      group: "General",
      inInputs: true,
      run: () => openPanel({ kind: "palette" }),
    },
    ...(
      [
        ["auto", "Contrast: dim text from 20:00 to 07:00"],
        ["day", "Contrast: always day"],
        ["night", "Contrast: always night"],
      ] as const
    ).map(([choice, title]) => ({
      id: `contrast.${choice}`,
      title,
      scope: "global" as const,
      group: "View",
      run: () => setContrast(choice),
    })),
    {
      id: "cheatsheet",
      title: "Keyboard shortcuts",
      keys: ["?"],
      scope: "global",
      group: "General",
      run: () => openPanel({ kind: "cheatsheet" }),
    },
  ]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <Rail />
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
      {panel?.kind === "plan" && <PlanStrip preview={panel.preview} label={panel.label} />}
      {panel?.kind === "escape" && <EscapeHatch url={panel.url} />}
      <StatusLine />
      <Toasts />
      {panel?.kind === "palette" && <Palette />}
      {panel?.kind === "cheatsheet" && <Cheatsheet />}
    </div>
  );
}

function Rail() {
  const { data: counts } = useQuery(q("counts", {}));
  const { data: views = [] } = useQuery(q("views", {}));
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      aria-label="Main"
      className="flex w-[200px] shrink-0 flex-col border-r border-line px-3 py-5"
    >
      <Link to="/" className="mb-7 px-3 text-section font-semibold tracking-tight text-strong">
        pier
      </Link>
      <ul className="space-y-0.5">
        {SPLITS.map(({ split, label }) => (
          <RailItem
            key={split}
            to={`/inbox/${split}`}
            label={label}
            count={counts?.[split]}
            active={pathname === `/inbox/${split}`}
          />
        ))}
      </ul>
      {views.length > 0 && (
        <ul aria-label="Views" className="mt-6 space-y-0.5">
          {views.map((view) => (
            <RailItem
              key={view.id}
              to={`/v/${view.id}`}
              label={view.name}
              count={view.count}
              active={pathname === `/v/${view.id}`}
            />
          ))}
        </ul>
      )}
      <ul className="mt-6 space-y-0.5">
        <RailItem to="/flight" label="In flight" active={pathname === "/flight"} />
        <RailItem to="/log" label="Log" active={pathname === "/log"} />
        <RailItem to="/search" label="Search" active={pathname === "/search"} />
      </ul>
    </nav>
  );
}

function RailItem({
  to,
  label,
  count,
  active,
}: {
  to: string;
  label: string;
  count?: number | undefined;
  active: boolean;
}) {
  return (
    <li>
      <Link
        to={to}
        className={clsx(
          "relative flex h-8 items-center rounded-sm px-3 transition-colors",
          active ? "bg-cursor text-strong" : "text-muted hover:bg-hover hover:text-fg",
        )}
      >
        {active && (
          <span
            aria-hidden
            className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent"
          />
        )}
        <span className="flex-1">{label}</span>
        {count !== undefined && count > 0 && (
          <span className={clsx("text-meta", active ? "text-muted" : "text-faint")}>{count}</span>
        )}
      </Link>
    </li>
  );
}
