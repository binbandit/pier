import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { PrLine, prStatCharacters } from "@/components/pr-line";
import { VirtualRows } from "@/components/rows";
import { errorText, openOnGitHub } from "@/features/actions";
import { type Command, useCommands } from "@/keys/registry";
import { plural } from "@/lib/format";
import { q, rpc } from "@/lib/rpc";
import { useList } from "@/lib/use-list";
import { useUi } from "@/stores/ui";
import { Keys } from "@/ui/kbd";
import { QUALIFIERS } from "@pier/core/query";
import type { PrItem, SavedView } from "@pier/core/wire";

// Search over every PR pier tracks, in GitHub's search language plus pier's own qualifiers.
// Results follow the query as you type. ⌘S keeps the search as a view in the sidebar; a view
// opens here with its query, and ⌘S saves changes to it.

const ROW = 40;
const EXAMPLES = [
  "is:open review-requested:@me",
  "author:app/dependabot status:failure",
  "turn:me size:<50",
  "repo:acme/api is:merged updated:>7d",
];

export function Search({
  initial,
  view = null,
  heading = null,
  onQuery,
}: {
  initial: string;
  view?: SavedView | null;
  heading?: string | null;
  /** Keeps the address bar in step with the query. */
  onQuery?: (query: string) => void;
}) {
  const navigate = useNavigate();
  const toast = useUi((s) => s.toast);
  const [text, setText] = useState(initial);
  const [applied, setApplied] = useState(initial);
  const [naming, setNaming] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  // A beat after typing stops, so each keystroke doesn't run a search.
  useEffect(() => {
    const timer = setTimeout(() => setApplied(text), 120);
    return () => clearTimeout(timer);
  }, [text]);
  // What this page last put in the address bar; anything else arriving there is a new search
  // (the sidebar's Search, `g s`), and starts over from it.
  const written = useRef(initial);
  useEffect(() => {
    written.current = applied;
    onQuery?.(applied);
  }, [applied, onQuery]);
  useEffect(() => {
    if (initial === written.current) return;
    written.current = initial;
    setText(initial);
    setApplied(initial);
  }, [initial]);
  useEffect(() => {
    if (!initial) input.current?.focus();
  }, [initial]);
  useEffect(() => {
    if (naming !== null) nameInput.current?.focus();
  }, [naming]);

  const { data: result } = useQuery({
    ...q("search", { q: applied }),
    enabled: applied.trim() !== "",
    placeholderData: keepPreviousData,
  });
  // GitHub is asked only when you say so (⌘⏎), for the query as it stood then.
  const [asked, setAsked] = useState<string | null>(null);
  const remote = useQuery({
    ...q("searchGitHub", { q: asked ?? "" }),
    enabled: asked !== null && asked === applied && applied.trim() !== "",
  });
  const local = applied.trim() ? (result?.items ?? []) : [];
  const shown = new Set(local.map((item) => item.id));
  const extra = asked === applied ? (remote.data?.items ?? []).filter((i) => !shown.has(i.id)) : [];
  const items = [...local, ...extra];
  const statCharacters = prStatCharacters(items);

  const open = (item: PrItem) => {
    const [owner = "", repo = ""] = item.repo.split("/");
    void navigate({
      to: "/$owner/$repo/pull/$number",
      params: { owner, repo, number: item.number },
    });
  };

  const save = async (name: string) => {
    try {
      const { id } = await rpc("saveView", {
        ...(view ? { id: view.id } : {}),
        name: name.trim(),
        query: text.trim(),
      });
      setNaming(null);
      toast({ text: view ? `Saved ${view.name}` : `Saved ${name.trim()}`, tone: "ok" });
      if (!view) void navigate({ to: "/v/$id", params: { id } });
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };

  /** Deletes a view, leaving you on its search so it's one ⌘S from coming back. */
  const remove = async (gone: SavedView) => {
    try {
      await rpc("deleteView", { id: gone.id });
      toast({ text: `Deleted ${gone.name}`, tone: "ok" });
      void navigate({ to: "/search", search: { q: gone.query } });
    } catch (error) {
      toast({ text: errorText(error), tone: "bad" });
    }
  };

  const list = useList<PrItem>({
    id: "search",
    items,
    keyOf: (item) => item.id,
    rowHeight: ROW,
    onOpen: open,
    commands: (current): Command[] => [
      {
        id: "search.github",
        title: "Open on github.com",
        keys: ["shift+o"],
        scope: "surface",
        group: "Go to",
        run: () => current && openOnGitHub(current.url),
      },
    ],
  });

  useCommands([
    {
      id: "search.focus",
      title: "Edit the search",
      keys: ["/"],
      scope: "surface",
      group: "Search",
      run: () => input.current?.focus(),
    },
    {
      id: "search.ask-github",
      title: "Search GitHub too",
      keys: ["mod+enter"],
      scope: "surface",
      group: "Search",
      inInputs: true,
      run: () => {
        if (applied.trim()) setAsked(applied);
      },
    },
    {
      id: "search.save",
      title: view ? "Save changes to this view" : "Save as a view",
      keys: ["mod+s"],
      scope: "surface",
      group: "Search",
      inInputs: true,
      run: () => {
        if (!text.trim()) return;
        if (view) void save(view.name);
        else setNaming("");
      },
    },
    ...(view
      ? [
          {
            id: "search.delete-view",
            title: `Delete the ${view.name} view`,
            keys: ["mod+backspace"],
            scope: "surface" as const,
            group: "Search",
            run: () => void remove(view),
          },
        ]
      : []),
  ]);

  const total = result?.total ?? 0;
  const changed = view !== null && text.trim() !== view.query;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 px-8 pt-6 pb-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-title font-semibold text-strong">
            {heading ?? view?.name ?? "Search"}
          </h1>
          {applied.trim() && result && (
            <span className="text-ui text-faint">
              {total > local.length ? `${local.length} of ${total}` : plural(total, "PR")}
              {extra.length > 0 && `, ${extra.length} more on GitHub`}
            </span>
          )}
          <span className="ml-auto flex items-center gap-4 text-meta text-faint">
            {applied.trim() && asked !== applied && (
              <span className="flex items-center gap-1.5">
                <Keys sequence="mod+enter" /> search GitHub too
              </span>
            )}
            {asked === applied && remote.isFetching && <span>Asking GitHub</span>}
            {(changed || !view) && text.trim() && (
              <span className="flex items-center gap-1.5">
                <Keys sequence="mod+s" /> {view ? "save changes" : "save as a view"}
              </span>
            )}
          </span>
        </div>
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter or Esc hands the keys back to the results.
            if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
          }}
          aria-label="Search"
          placeholder="is:open review-requested:@me"
          spellCheck={false}
          className="mt-3 h-10 w-full max-w-[1320px] rounded-sm border border-line-strong bg-canvas px-3 font-code text-code text-strong outline-none placeholder:text-off focus:border-line-max"
        />
        {naming !== null && (
          <form
            className="mt-2 flex max-w-[1320px] items-center gap-3 text-meta"
            onSubmit={(e) => {
              e.preventDefault();
              if (naming.trim()) void save(naming);
            }}
          >
            <span className="text-faint">Name this view</span>
            <input
              ref={nameInput}
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
              aria-label="View name"
              className="h-8 w-[280px] rounded-sm border border-line-strong bg-canvas px-2 text-ui text-strong outline-none"
            />
            <span className="flex items-center gap-1.5 text-faint">
              <Keys sequence="enter" /> save
            </span>
          </form>
        )}
        {result && result.errors.length > 0 && (
          <p className="mt-2 text-meta text-warn">{result.errors.join("; ")}</p>
        )}
        {asked === applied && remote.error && (
          <p className="mt-2 text-meta text-warn">{errorText(remote.error)}</p>
        )}
        {asked === applied && remote.data && remote.data.dropped.length > 0 && (
          <p className="mt-2 text-meta text-faint">
            GitHub was asked without {remote.data.dropped.join(", ")}, which only pier knows.
          </p>
        )}
      </header>

      {!applied.trim() ? (
        <Help />
      ) : result && items.length === 0 ? (
        <p className="px-8 pt-10 text-prose text-muted">
          {asked === applied && remote.data
            ? "Nothing matches that, here or on GitHub."
            : "No PRs pier tracks match that. ⌘⏎ asks GitHub."}
        </p>
      ) : (
        <VirtualRows
          scrollRef={list.scrollRef}
          virtualizer={list.virtualizer}
          items={items}
          keyOf={(item) => item.id}
          rowHeight={ROW}
          label="Results"
          cursor={list.index}
          selectedKeys={list.selectedKeys}
          onSelect={list.move}
          onOpen={open}
          render={(item) => <PrLine item={item} statCharacters={statCharacters} />}
        />
      )}
    </div>
  );
}

function Help() {
  return (
    <div className="max-w-[1100px] overflow-y-auto px-8 pt-4 pb-10 text-meta">
      <p className="text-ui text-muted">
        Words match titles, descriptions, branches and authors. Qualifiers narrow; a leading{" "}
        <code className="font-code text-fg">-</code> excludes; commas mean either.
      </p>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-code text-fg">
        {EXAMPLES.map((example) => (
          <li key={example}>{example}</li>
        ))}
      </ul>
      <dl className="mt-6 grid grid-cols-[repeat(2,max-content_minmax(0,1fr))] gap-x-4 gap-y-1.5">
        {Object.entries(QUALIFIERS).map(([key, about]) => (
          <div key={key} className="contents">
            <dt className="font-code text-fg">{key}:</dt>
            <dd className="text-faint">{about}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
