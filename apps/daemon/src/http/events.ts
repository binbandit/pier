import { VERSION } from "@/config";
import type { ServerEvent, Topic } from "@pier/core/contract";

// One SSE stream per open window. Changes are coalesced for a moment so a burst of sync
// updates becomes a single "these topics are stale" message.

const COALESCE_MS = 150;
const PING_MS = 5_000;

export class EventHub {
  private clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private pending = new Set<Topic>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private encoder = new TextEncoder();
  private ping = setInterval(
    () => this.broadcast(`data: ${JSON.stringify({ type: "ping" } satisfies ServerEvent)}\n\n`),
    PING_MS,
  );

  emit(topics: Topic[]): void {
    for (const topic of topics) this.pending.add(topic);
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = null;
      const event: ServerEvent = { type: "changed", topics: [...this.pending] };
      this.pending.clear();
      this.broadcast(`data: ${JSON.stringify(event)}\n\n`);
    }, COALESCE_MS);
  }

  stream(): Response {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
        this.clients.add(c);
        const hello: ServerEvent = { type: "hello", version: VERSION };
        c.enqueue(this.encoder.encode(`data: ${JSON.stringify(hello)}\n\n`));
      },
      cancel: () => {
        this.clients.delete(controller);
      },
    });
    return new Response(body, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      },
    });
  }

  close(): void {
    clearInterval(this.ping);
    for (const client of this.clients) client.close();
    this.clients.clear();
  }

  private broadcast(text: string): void {
    const bytes = this.encoder.encode(text);
    for (const client of this.clients) {
      try {
        client.enqueue(bytes);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}
