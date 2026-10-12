import { clsx } from "clsx";

export type Tone = "ok" | "bad" | "warn" | "info" | "auto" | "faint" | "accent";

const TONES: Record<Tone, string> = {
  ok: "bg-ok",
  bad: "bg-bad",
  warn: "bg-warn",
  info: "bg-info",
  auto: "bg-auto",
  faint: "bg-off",
  accent: "bg-accent",
};

/** A 6px status light. Colour carries the meaning; pair it with a word when it matters. */
export function Dot({
  tone,
  hollow = false,
  label,
}: {
  tone: Tone;
  hollow?: boolean;
  label?: string;
}) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={clsx(
        "inline-block size-1.5 shrink-0 rounded-full",
        hollow ? "border border-current bg-transparent" : TONES[tone],
        hollow && TEXT_TONES[tone],
      )}
    />
  );
}

export const TEXT_TONES: Record<Tone, string> = {
  ok: "text-ok",
  bad: "text-bad",
  warn: "text-warn",
  info: "text-info",
  auto: "text-auto",
  faint: "text-off",
  accent: "text-accent",
};
