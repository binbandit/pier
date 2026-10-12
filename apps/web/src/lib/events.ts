import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { create } from "zustand";

import type { ServerEvent } from "@pier/core/contract";

// One SSE stream from the daemon. Every "changed" event names the procedures whose answers are
// now stale; refetching over loopback is cheap, so invalidation is all the client does.

type Connection = { connected: boolean; set: (connected: boolean) => void };

export const useConnection = create<Connection>((set) => ({
  connected: false,
  set: (connected) => set({ connected }),
}));

const STALE_MS = 15_000;

export function useServerEvents(): void {
  const client = useQueryClient();
  useEffect(() => {
    let source: EventSource | null = null;
    let lastSeen = Date.now();

    const connect = () => {
      source?.close();
      lastSeen = Date.now();
      source = new EventSource("/api/events");
      source.addEventListener("error", () => useConnection.getState().set(false));
      source.addEventListener("message", (message) => {
        lastSeen = Date.now();
        useConnection.getState().set(true);
        const event = JSON.parse(message.data as string) as ServerEvent;
        if (event.type === "hello") {
          // A reconnect may have missed changes; refresh everything once.
          void client.invalidateQueries();
        } else if (event.type === "changed") {
          for (const topic of event.topics) void client.invalidateQueries({ queryKey: [topic] });
        }
      });
    };

    // The daemon pings every few seconds. Silence means the connection died somewhere the
    // browser can't see (a proxy, a sleeping laptop), so start over.
    const watchdog = setInterval(() => {
      if (Date.now() - lastSeen < STALE_MS) return;
      useConnection.getState().set(false);
      connect();
    }, 5_000);

    connect();
    return () => {
      clearInterval(watchdog);
      source?.close();
    };
  }, [client]);
}
