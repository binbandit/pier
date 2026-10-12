import { displayKeys } from "@/keys/registry";

/** A key sequence as it should be pressed: "g i" renders as two keys. */
export function Keys({ sequence }: { sequence: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {displayKeys(sequence).map((key, i) => (
        <kbd
          // A sequence can repeat a key ("g g"), so position is the identity.
          // oxlint-disable-next-line react/no-array-index-key
          key={`${i}-${key}`}
          className="min-w-[18px] rounded-sm border border-line-strong px-1 text-center font-ui text-[11px] leading-[16px] text-muted"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
