import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

import { type } from "arktype";

import type { Handlers } from "@/api/handlers";
import { DEV_HOST, HOST, PORT } from "@/config";
import { Refusal } from "@/domain/refusal";
import { inputs, type ProcedureName } from "@pier/core/contract";

import { embeddedAssets } from "./assets";
import type { EventHub } from "./events";
import {
  CONTENT_SECURITY_POLICY,
  FRAME_CONTENT_SECURITY_POLICY,
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
  /** github.com's /owner/repo/pull/N.diff and .patch, served the same way here. */
  rawDiff: (repo: string, number: number, format: "diff" | "patch") => Promise<string | null>;
};

const RAW_DIFF = /^\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\.(diff|patch)$/;

export function serve(options: ServerOptions) {
  const port = options.port ?? PORT;
  const self = `${HOST}:${port}`;
  const config: GuardConfig = {
    hosts: options.dev ? [self, `localhost:${port}`, DEV_HOST] : [self, `localhost:${port}`],
    origins: options.dev ? [`http://${self}`, `http://${DEV_HOST}`] : [`http://${self}`],
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
      const raw = RAW_DIFF.exec(url.pathname);
      if (raw) {
        const [, owner, repo, number, format] = raw;
        const text = await options.rawDiff(
          `${owner}/${repo}`,
          Number(number),
          format === "patch" ? "patch" : "diff",
        );
        return text === null
          ? new Response("None of your accounts can see that PR.", { status: 404 })
          : new Response(text, {
              headers: {
                "content-type": "text/plain; charset=utf-8",
                "x-content-type-options": "nosniff",
              },
            });
      }
      return asset(options.webDir, url.pathname);
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
    if (error instanceof Refusal) return json({ error: error.message }, 409);
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

function asset(webDir: string | null, pathname: string): Response {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const found = resolveAsset(webDir, relative);
  if (!found) return new Response("pier daemon (dev): open the Vite server", { status: 200 });
  const headers: Record<string, string> = {
    "content-type": MIME[extname(found.name)] ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": found.name.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  };
  if (found.name.endsWith(".html")) {
    headers["content-security-policy"] = found.name.startsWith("/frames/")
      ? FRAME_CONTENT_SECURITY_POLICY
      : CONTENT_SECURITY_POLICY;
  }
  return new Response(Bun.file(found.file), { headers });
}

/**
 * The file for a URL path: an embedded or on-disk asset, or the app shell for client-side routes
 * (/:owner/:repo/pull/:n, /inbox/deps, ...).
 */
function resolveAsset(
  webDir: string | null,
  relative: string,
): { name: string; file: string } | null {
  const embedded = embeddedAssets();
  if (embedded) {
    const hit = embedded.get(relative);
    if (hit) return { name: relative, file: hit };
    const shell = embedded.get("/index.html");
    return shell ? { name: "/index.html", file: shell } : null;
  }
  if (!webDir) return null;
  const candidate = join(webDir, relative);
  if (candidate.startsWith(webDir) && extname(candidate) !== "" && existsSync(candidate)) {
    return { name: relative, file: candidate };
  }
  return { name: "/index.html", file: join(webDir, "index.html") };
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
