import { createFileRoute } from "@tanstack/react-router";

import { Log } from "@/features/log";

export const Route = createFileRoute("/log")({ component: Log });
