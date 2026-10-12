import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";

import { useCommands } from "@/keys/registry";
import { Keys } from "@/ui/kbd";

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
  const [body, setBody] = useState(initial);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);

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

  const insertSuggestion = () => {
    const el = ref.current;
    if (!el) return;
    const block = `\`\`\`suggestion\n${suggestionSource ?? ""}\n\`\`\`\n`;
    const at = el.selectionStart;
    setBody(body.slice(0, at) + block + body.slice(el.selectionEnd));
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
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="block w-full resize-none bg-transparent px-3 py-2.5 font-ui text-ui leading-6 text-strong outline-none placeholder:text-faint"
      />
      <div className="flex items-center gap-4 border-t border-line px-3 py-1.5 text-meta text-faint">
        <span>Markdown</span>
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
    </div>
  );
}

/** Grow with the text instead of scrolling inside a tiny box. */
function grow(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
