import { createFileRoute } from "@tanstack/react-router";

import { MergeQueue } from "@/features/merge-queue";

export const Route = createFileRoute("/merge-queue")({ component: MergeQueue });
