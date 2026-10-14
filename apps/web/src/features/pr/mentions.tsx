import { Popover } from "@base-ui/react/popover";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { q } from "@/lib/rpc";
import { Avatar } from "@/ui/avatar";
import type { PrView } from "@pier/core/wire";

const MentionContext = createContext<PrView | null>(null);

export function MentionScope({ pr, children }: { pr: PrView; children: ReactNode }) {
  return <MentionContext value={pr}>{children}</MentionContext>;
}

type Mention = { start: number; end: number; query: string };
type Candidate = { login: string; avatarUrl?: string; source: "PR participant" | "Repository" };

/** People already involved in this PR stay ahead of the rest of the repository. */
function participants(pr: PrView): Candidate[] {
  const people: Candidate[] = [];
  const add = (login: string | null | undefined, avatarUrl?: string) => {
    if (login && !login.endsWith("[bot]"))
      people.push({ login, ...(avatarUrl ? { avatarUrl } : {}), source: "PR participant" });
  };
  if (!pr.author?.isBot) add(pr.author?.login, pr.author?.avatarUrl);
  for (const entry of pr.timeline) {
    if (entry.kind === "comment" || entry.kind === "review") {
      if (!entry.author?.isBot) add(entry.author?.login, entry.author?.avatarUrl);
    } else if (entry.kind === "event" || entry.kind === "force-push") add(entry.actor);
  }
  for (const thread of pr.threads)
    for (const comment of thread.comments)
      if (!comment.author?.isBot) add(comment.author?.login, comment.author?.avatarUrl);
  for (const reviewer of pr.reviewers) if (reviewer.kind === "user") add(reviewer.login);
  for (const person of pr.assignees) add(person.login, person.avatarUrl);
  return people;
}

function mentionAt(input: HTMLTextAreaElement): Mention | null {
  if (input.selectionStart !== input.selectionEnd) return null;
  const caret = input.selectionStart;
  const match = /(?:^|[\s([{])@([a-z\d-]*)$/i.exec(input.value.slice(0, caret));
  if (!match) return null;
  const query = match[1] ?? "";
  const rest = /^[a-z\d-]*/i.exec(input.value.slice(caret))?.[0] ?? "";
  return { start: caret - query.length - 1, end: caret + rest.length, query };
}

export function useMentions({
  input,
  focused,
  onChange,
  placeCaret,
}: {
  input: RefObject<HTMLTextAreaElement | null>;
  focused: boolean;
  onChange: (body: string) => void;
  placeCaret: (caret: number) => void;
}) {
  const pr = useContext(MentionContext);
  const [mention, setMention] = useState<Mention | null>(null);
  const [cursor, setCursor] = useState({ query: "", index: 0 });
  const dismissed = useRef<{ value: string; caret: number } | null>(null);
  const listId = useId();
  const open = pr !== null && mention !== null && focused;
  const people = useQuery({
    ...q("assignable", { repo: pr?.repo ?? "" }),
    enabled: open,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const needle = mention?.query.toLowerCase() ?? "";
  const unique = new Map<string, Candidate>();
  for (const person of [
    ...(open && pr ? participants(pr) : []),
    ...(people.data ?? []).map((candidate) => ({ ...candidate, source: "Repository" as const })),
  ]) {
    const login = person.login.toLowerCase();
    if (!unique.has(login) && login.includes(needle)) unique.set(login, person);
  }
  const options = [...unique.values()].slice(0, 8);
  const index = Math.min(cursor.query === needle ? cursor.index : 0, options.length - 1);
  const selected = options[index];
  const optionId = (login: string) => `${listId}-${login}`;
  const selectedId = open && selected ? optionId(selected.login) : undefined;

  useEffect(() => {
    if (selectedId) document.getElementById(selectedId)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const close = () => {
    const element = input.current;
    dismissed.current = element ? { value: element.value, caret: element.selectionStart } : null;
    setMention(null);
  };
  const choose = (person: Candidate) => {
    const element = input.current;
    if (!element || !mention) return;
    const after = element.value.slice(mention.end);
    const hasSpace = /^\s/.test(after);
    const inserted = `@${person.login}${hasSpace ? "" : " "}`;
    onChange(element.value.slice(0, mention.start) + inserted + after);
    close();
    placeCaret(mention.start + inserted.length + (hasSpace ? 1 : 0));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey)
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if ((event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) && selected) {
      event.preventDefault();
      event.stopPropagation();
      choose(selected);
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setCursor({ query: needle, index: (index + delta + options.length) % options.length });
    }
  };

  return {
    close,
    update: (element: HTMLTextAreaElement) => {
      if (
        dismissed.current?.value === element.value &&
        dismissed.current.caret === element.selectionStart
      )
        return;
      dismissed.current = null;
      setMention(pr ? mentionAt(element) : null);
    },
    inputProps: {
      onKeyDown,
      "aria-autocomplete": "list" as const,
      "aria-controls": open ? listId : undefined,
      "aria-activedescendant": selectedId,
    },
    popup: (
      <Popover.Root open={open} onOpenChange={(next) => !next && close()}>
        <Popover.Portal>
          <Popover.Positioner
            anchor={input}
            side="top"
            align="start"
            sideOffset={6}
            className="z-50"
          >
            <Popover.Popup
              initialFocus={false}
              finalFocus={false}
              role="presentation"
              className="w-80 max-w-[calc(100vw-24px)] rounded-md border border-line-strong bg-raise p-1 shadow-xl outline-none"
            >
              <div className="px-2 py-1 text-meta text-faint">Mention someone</div>
              <div
                id={listId}
                role="listbox"
                aria-label="Mention people"
                className="max-h-64 overflow-y-auto"
              >
                {options.map((person, i) => (
                  <button
                    key={person.login}
                    id={optionId(person.login)}
                    type="button"
                    role="option"
                    aria-selected={i === index}
                    tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(person)}
                    className={clsx(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-ui hover:bg-hover",
                      i === index ? "bg-cursor text-strong" : "text-fg",
                    )}
                  >
                    <Avatar login={person.login} url={person.avatarUrl ?? null} size={20} />
                    <span className="min-w-0 flex-1 truncate">{person.login}</span>
                    <span className="shrink-0 text-meta text-faint">{person.source}</span>
                  </button>
                ))}
              </div>
              {options.length === 0 && !people.isFetching && (
                <p className="px-2 py-2 text-meta text-faint">No matching people</p>
              )}
              {people.isFetching && (
                <p className="px-2 py-1 text-meta text-faint">Loading repository people</p>
              )}
              {people.isError && (
                <p className="px-2 py-1 text-meta text-faint">Repository people unavailable</p>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    ),
  };
}
