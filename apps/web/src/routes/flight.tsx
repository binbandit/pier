import { createFileRoute } from "@tanstack/react-router";

import { Flight } from "@/features/flight";

export const Route = createFileRoute("/flight")({ component: Flight });
