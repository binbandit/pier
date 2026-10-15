import type { PrActivity } from "@pier/core/wire";

export function PrActivityLabel({ activity }: { activity: PrActivity }) {
  if (activity === "read") return null;
  return (
    <span
      className="shrink-0 text-meta font-medium text-accent"
      title={activity === "updated" ? "Updated since you last viewed" : "Not viewed in pier yet"}
    >
      {activity === "updated" ? "Updated" : "New"}
    </span>
  );
}
