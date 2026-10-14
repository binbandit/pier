import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";

import { useCommands } from "@/keys/registry";
import { useUi } from "@/stores/ui";
import { Keys } from "@/ui/kbd";

import { useMentions } from "./mentions";
import { SavedReplies } from "./replies";

// The one text box pier writes comments in: inline drafts, thread replies, review bodies and the
// conversation. While it has focus it owns the keyboard, so typing "a" never approves anything.

type ComposerProps = {
  id: string;
  placeholder: string;
  initial?: string;
  /** What Cmd+Enter does, in words: "Save draft", "Reply", "Comment". */
  submitLabel: string;
  onSubmit: (body: string) => void | Promise<void>;
  onCancel?: () => void;
  /** Put the cursor in the box as soon as it appears (new comments, replies, the review). */
  focusOnMount?: boolean;
  /** Lines under the comment, used by Cmd+G to start a suggestion from the current code. */
  suggestionSource?: string | null;
  minRows?: number;
};

export function Composer({
  id,
  placeholder,
  initial = "",
  submitLabel,
  onSubmit,
  onCancel,
  focusOnMount = false,
  suggestionSource = null,
  minRows = 3,
}: ComposerProps) {
  const [body, setBody] = useState(() => {
    const quote = useUi.getState().quote;
    return quote?.into === id ? withQuote(initial, quote.text) : initial;
  });
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  // Where the cursor was when saved replies opened, so one goes in there.
  const [replying, setReplying] = useState<{ start: number; end: number } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);

  // Quote reply: text quoted elsewhere lands at the end of this box, ready to answer. A quote
  // waiting when the box opened (a thread's reply box opens for it) is already in `body`.
  useEffect(() => {
    if (useUi.getState().quote?.into === id) useUi.getState().takeQuote();
    return useUi.subscribe((state) => {
      if (state.quote?.into !== id) return;
      const { text } = state.quote;
      state.takeQuote();
      setBody((now) => withQuote(now, text));
      const el = ref.current;
      if (!el) return;
      el.focus();
      queueMicrotask(() => {
        el.selectionStart = el.selectionEnd = el.value.length;
        grow(el);
      });
    });
  }, [id]);

  const submit = async () => {
    if (busy || !body.trim()) return;
    setBusy(true);
    try {
      await onSubmit(body);
      setBody("");
      ref.current?.blur();
    } finally {
      setBusy(false);
    }
  };

  const openReplies = () => {
    mentions.close();
    const el = ref.current;
    setReplying({ start: el?.selectionStart ?? body.length, end: el?.selectionEnd ?? body.length });
  };
  /** Puts the caret at `caret` once the new text is in the box. */
  const placeCaret = (caret: number) =>
    queueMicrotask(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = caret;
      grow(el);
    });
  const insertReply = (text: string) => {
    if (!replying) return;
    setBody(body.slice(0, replying.start) + text + body.slice(replying.end));
    setReplying(null);
    placeCaret(replying.start + text.length);
  };

  const mentions = useMentions({ input: ref, focused, onChange: setBody, placeCaret });

  const insertSuggestion = () => {
    const el = ref.current;
    if (!el) return;
    const opening = "```suggestion\n";
    const source = suggestionSource ?? "";
    const at = el.selectionStart;
    setBody(`${body.slice(0, at)}${opening}${source}\n\`\`\`\n${body.slice(el.selectionEnd)}`);
    // At the end of the code, ready to change it.
    placeCaret(at + opening.length + source.length);
  };

  useCommands(
    focused
      ? [
          {
            id: `${id}.submit`,
            title: submitLabel,
            keys: ["mod+enter"],
            scope: "panel",
            inInputs: true,
            run: () => void submit(),
          },
          {
            id: `${id}.cancel`,
            title: "Cancel",
            keys: ["escape"],
            scope: "panel",
            inInputs: true,
            run: () => {
              ref.current?.blur();
              onCancel?.();
            },
          },
          {
            id: `${id}.replies`,
            title: "Saved replies",
            // GitHub's key everywhere; Cmd+. too on a Mac.
            keys: ["ctrl+.", "mod+."],
            scope: "panel",
            inInputs: true,
            run: openReplies,
          },
          ...(suggestionSource !== null
            ? [
                {
                  id: `${id}.suggest`,
                  title: "Insert suggestion",
                  keys: ["mod+g"],
                  scope: "panel" as const,
                  inInputs: true,
                  run: insertSuggestion,
                },
              ]
            : []),
        ]
      : [],
  );

  return (
    <div
      className={clsx(
        "rounded-md border bg-canvas transition-colors",
        focused ? "border-line-max" : "border-line-strong",
      )}
    >
      <textarea
        ref={ref}
        value={body}
        rows={minRows}
        placeholder={placeholder}
        onChange={(e) => {
          setBody(e.target.value);
          grow(e.target);
          mentions.update(e.target);
        }}
        onSelect={(e) => mentions.update(e.currentTarget)}
        onFocus={(e) => {
          setFocused(true);
          mentions.update(e.currentTarget);
        }}
        onBlur={() => {
          setFocused(false);
          mentions.close();
        }}
        {...mentions.inputProps}
        className="block w-full resize-none bg-transparent px-3 py-2.5 font-ui text-ui leading-6 text-strong outline-none placeholder:text-faint"
      />
      {mentions.popup}
      <div className="flex items-center gap-4 border-t border-line px-3 py-1.5 text-meta text-faint">
        <span>Markdown</span>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openReplies}
          className="flex items-center gap-1.5 hover:text-fg"
        >
          <Keys sequence="ctrl+." /> Saved replies
        </button>
        {suggestionSource !== null && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={insertSuggestion}
            className="flex items-center gap-1.5 hover:text-fg"
          >
            <Keys sequence="mod+g" /> Suggest a change
          </button>
        )}
        <span className="ml-auto flex items-center gap-4">
          {onCancel && (
            <button type="button" onClick={onCancel} className="hover:text-fg">
              Cancel
            </button>
          )}
          <button
            type="button"
            disabled={busy || !body.trim()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void submit()}
            className="flex items-center gap-1.5 text-muted enabled:hover:text-strong disabled:opacity-40"
          >
            <Keys sequence="mod+enter" /> {submitLabel}
          </button>
        </span>
      </div>
      {replying && (
        <SavedReplies
          written={body}
          onInsert={insertReply}
          onClose={() => {
            setReplying(null);
            ref.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/** Grow with the text instead of scrolling inside a tiny box. */
function grow(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/** Appends a quote on its own paragraph, leaving room to answer under it. */
function withQuote(body: string, quote: string): string {
  return `${body.trim() ? `${body.trimEnd()}\n\n` : ""}${quote}\n\n`;
}
