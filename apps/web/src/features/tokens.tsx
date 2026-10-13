import { Ledger, type Tick } from "@/components/ledger";
import { Markdown } from "@/components/markdown";
import { DiffFiles } from "@/diff/adapter";
import { useContrast } from "@/stores/contrast";
import { usePrefs } from "@/stores/prefs";
import { Dot, type Tone } from "@/ui/dot";
import { Keys } from "@/ui/kbd";
import type { DiffFile } from "@pier/core/wire";

// Every token, type size and diff state on one page, for checking the design pixel by pixel
// (and for screenshots that don't move). Not linked from anywhere: /tokens.

const COLOURS = [
  ["Surfaces", ["canvas", "raise", "hover", "cursor", "press", "selected"]],
  ["Lines", ["line", "line-strong", "line-max"]],
  ["Text", ["strong", "fg", "muted", "faint", "off"]],
  ["Signals", ["accent", "ok", "bad", "warn", "info", "auto"]],
  ["Diff", ["add-row", "del-row", "add-word", "del-word"]],
] as const;

const TYPE = [
  ["title", "text-title font-semibold text-strong", "Rate limit /users to 60 requests a minute"],
  ["section", "text-section font-semibold text-strong", "Since your review"],
  ["prose", "text-prose text-fg", "Retry 429 and 5xx up to twice with backoff before failing."],
  ["ui", "text-ui text-fg", "Your turn: sage-smudge pushed after your review 2h ago."],
  ["meta", "text-meta text-faint", "3 checks passing, 1 required"],
  ["code", "font-code text-code text-fg", "const MAX_DELAY_MS = 5_000;"],
] as const;

const TONES: Tone[] = ["ok", "bad", "warn", "info", "auto", "accent", "faint"];

const TICKS: Tick[] = [
  ...(["clear", "clear", "clear", "look", "stuck"] as const).map((cohort, i) => ({
    id: `open-${i}`,
    cohort,
    state: "open" as const,
  })),
  { id: "sending", cohort: "clear", state: "sending" },
  { id: "done-1", cohort: "clear", state: "done" },
  { id: "done-2", cohort: "clear", state: "done" },
];

const SAMPLE_DIFF: DiffFile = {
  path: "src/http/client.js",
  previousPath: null,
  status: "modified",
  additions: 3,
  deletions: 2,
  patch: [
    "@@ -6,8 +6,9 @@ class UpstreamError extends Error {",
    "   }",
    " }",
    " ",
    "-const RETRYABLE = new Set([502, 503]);",
    "-const BACKOFF_MS = 100;",
    "+// The longest wait between attempts, kept short for deploys.",
    "+const MAX_DELAY_MS = 5_000;",
    "+const RETRYABLE = new Set([429, 502, 503, 504]);",
    " ",
    " function createClient({ baseUrl, timeoutMs }) {",
    "   async function get(path) {",
  ].join("\n"),
};

const SAMPLE_PROSE = `### Prose

Upstream returns **503s** during deploys. Retry \`429\`/\`5xx\` up to twice, see [the runbook](https://example.com).

- \`createClient\` takes \`retries\` (default 2)
- Adds a client test covering one retry

> Backing off 200ms on the first retry feels long.

| Status | Retried |
|---|---|
| 429 | yes |
| 500 | no |
`;

export function Tokens() {
  const mode = useContrast((s) => s.mode);
  const setContrast = usePrefs((s) => s.setContrast);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-16">
      <header className="flex items-baseline gap-6">
        <h1 className="text-title font-semibold text-strong">Tokens</h1>
        <span className="flex gap-4 text-meta">
          {(["day", "night"] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => setContrast(choice)}
              className={choice === mode ? "text-strong" : "text-faint hover:text-fg"}
            >
              {choice === "day" ? "Day" : "Night"}
            </button>
          ))}
        </span>
      </header>

      <section className="mt-8 grid max-w-[1100px] grid-cols-5 gap-x-8 gap-y-6">
        {COLOURS.map(([group, names]) => (
          <div key={group}>
            <h2 className="mb-2 text-meta text-faint">{group}</h2>
            <ul className="space-y-2">
              {names.map((name) => (
                <li key={name} className="flex items-center gap-3">
                  <span
                    className="size-6 shrink-0 rounded-sm border border-line"
                    style={{ background: `var(--color-${name})` }}
                  />
                  <span className="min-w-0">
                    <span className="block text-meta text-fg">{name}</span>
                    {/* What the page is really using; keyed by mode so night shows its own. */}
                    <span
                      key={mode}
                      ref={(el) => {
                        if (el) el.textContent = tokenValue(name);
                      }}
                      className="block font-code text-[12px] leading-4 text-faint"
                    />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="mt-10 max-w-[1100px] space-y-3">
        {TYPE.map(([name, classes, sample]) => (
          <div key={name} className="grid grid-cols-[80px_1fr] items-baseline gap-4">
            <span className="text-meta text-faint">{name}</span>
            <span className={classes}>{sample}</span>
          </div>
        ))}
      </section>

      <section className="mt-10 flex max-w-[1100px] flex-wrap items-center gap-8 text-meta text-muted">
        <span className="flex items-center gap-3">
          {TONES.map((tone) => (
            <Dot key={tone} tone={tone} label={tone} />
          ))}
        </span>
        <span className="flex items-center gap-1.5">
          <Keys sequence="mod+enter" /> send
        </span>
        <span className="flex items-center gap-1.5">
          <Keys sequence="g d" /> go to Deps
        </span>
        <Ledger ticks={TICKS} label="Ledger: open, sending and approved" />
        <Ledger ticks={TICKS} size="lg" label="Ledger, large" />
        <span className="rounded-sm bg-cursor px-2 py-1 text-strong">cursor row</span>
        <span className="rounded-sm bg-selected px-2 py-1 text-fg">selected row</span>
      </section>

      <section className="mt-10 max-w-[1100px]">
        <DiffFiles files={[SAMPLE_DIFF]} />
      </section>

      <section className="mt-10 max-w-[720px]">
        <Markdown source={SAMPLE_PROSE} />
      </section>
    </div>
  );
}

function tokenValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
}
