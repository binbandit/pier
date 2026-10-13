import { ago, since } from "@/lib/format";

/**
 * A relative time ("3h", or "3h ago" with `suffix`, plus the day with `date`), with the exact
 * time on hover.
 */
export function When({
  at,
  suffix = false,
  date = false,
  now,
}: {
  at: string;
  suffix?: boolean;
  date?: boolean;
  now?: number;
}) {
  const relative = suffix || date ? since(at, now) : ago(at, now);
  return (
    <time dateTime={at} title={new Date(at).toLocaleString()} className="whitespace-nowrap">
      {date ? `${relative}, ${new Date(at).toLocaleDateString()}` : relative}
    </time>
  );
}
