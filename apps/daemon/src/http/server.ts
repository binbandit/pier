import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

import { type } from "arktype";

import type { Handlers } from "@/api/handlers";
import { DEV_ORIGIN, HOST, PORT } from "@/config";
import { inputs, type ProcedureName } from "@pier/core/contract";

import type { EventHub } from "./events";
import {
  CONTENT_SECURITY_POLICY,
  type GuardConfig,
  checkEvents,
  checkHost,
  checkRpc,
} from "./guard";

export type ServerOptions = {
  handlers: Handlers;
  events: EventHub;
  /** Built web app to serve; absent in dev, where Vite serves it. */
  webDir: string | null;
  dev: boolean;
  port?: number;
};

export function serve(options: ServerOptions) {
  const port = options.port ?? PORT;
  const self = `${HOST}:${port}`;
  const config: GuardConfig = {
    hosts: options.dev
      ? [self, `localhost:${port}`, "127.0.0.1:4478"]
      : [self, `localhost:${port}`],
    origins: options.dev ? [`http://${self}`, DEV_ORIGIN] : [`http://${self}`],
  };

  return Bun.serve({
    hostname: HOST,
    port,
    async fetch(req, server) {
      const url = new URL(req.url);

      // The port is part of the origin; keep everyone on one so the PWA and storage stay put.
      if (req.headers.get("host") === `localhost:${port}`) {
        return Response.redirect(`http://${self}${url.pathname}${url.search}`, 308);
      }

      if (url.pathname === "/api/events") {
        const guard = checkEvents(req, config);
        if (!guard.ok) return deny(guard.status, guard.reason);
        server.timeout(req, 0);
        return options.events.stream();
      }

      if (url.pathname.startsWith("/api/rpc/")) {
        const guard = checkRpc(req, config);
        if (!guard.ok) return deny(guard.status, guard.reason);
        return rpc(url.pathname.slice("/api/rpc/".length), req, options.handlers);
      }

      if (url.pathname.startsWith("/api/")) return deny(404, "no such endpoint");

      const host = checkHost(req, config);
      if (!host.ok) return deny(host.status, host.reason);
      return options.webDir
        ? asset(options.webDir, url.pathname)
        : new Response("pier daemon (dev): open the Vite server", { status: 200 });
    },
    error(error) {
      console.error(error);
      return new Response("internal error", { status: 500 });
    },
  });
}

function isProcedure(name: string): name is ProcedureName {
  return Object.hasOwn(inputs, name);
}

async function rpc(name: string, req: Request, handlers: Handlers): Promise<Response> {
  if (!isProcedure(name)) return deny(404, `unknown procedure ${name}`);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return deny(400, "body must be JSON");
  }
  const parsed = inputs[name](body);
  if (parsed instanceof type.errors) return json({ error: parsed.summary }, 400);
  try {
    // The schema for `name` produced `parsed`, so it matches that handler's input.
    const handler = handlers[name] as (input: unknown) => unknown;
    return json(await handler(parsed));
  } catch (error) {
    console.error(`rpc ${name}:`, error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

async function asset(webDir: string, pathname: string): Promise<Response> {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const candidate = join(webDir, relative);
  const isFile = candidate.startsWith(webDir) && extname(candidate) !== "" && existsSync(candidate);
  // Client-side routes (/:owner/:repo/pull/:n, /inbox/deps, …) all get the app shell.
  const file = isFile ? candidate : join(webDir, "index.html");
  const headers: Record<string, string> = {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
  if (file.endsWith(".html")) {
    headers["content-security-policy"] = CONTENT_SECURITY_POLICY;
    headers["cache-control"] = "no-cache";
  } else if (relative.startsWith("/assets/")) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  }
  return new Response(Bun.file(file), { headers });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function deny(status: number, reason: string): Response {
  return new Response(reason, { status });
}
