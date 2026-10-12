import { API_HEADER } from "@pier/core/contract";

// pier holds tokens for every gh account, so its API must only answer pier's own page.
// The threats are other websites, other localhost dev servers, and DNS rebinding; programs
// running as Brayden are out of scope (they can already run `gh auth token`).
//
//   RPC (POST):  exact Origin, the X-Pier header, Sec-Fetch-Site: same-origin
//   SSE (GET):   exact Host, Sec-Fetch-Site: same-origin (EventSource can't send headers,
//                and browsers omit Origin on same-origin GETs)
//   pages:       exact Host only (typed URLs and PWA launches arrive with Sec-Fetch-Site: none)

export type GuardConfig = { hosts: string[]; origins: string[] };

export type GuardResult = { ok: true } | { ok: false; status: number; reason: string };

export function checkHost(req: Request, config: GuardConfig): GuardResult {
  const host = req.headers.get("host") ?? "";
  return config.hosts.includes(host)
    ? { ok: true }
    : { ok: false, status: 421, reason: `unexpected host ${host}` };
}

export function checkRpc(req: Request, config: GuardConfig): GuardResult {
  const host = checkHost(req, config);
  if (!host.ok) return host;
  if (req.method !== "POST") return { ok: false, status: 405, reason: "RPC is POST only" };
  const origin = req.headers.get("origin");
  if (!origin || !config.origins.includes(origin))
    return { ok: false, status: 403, reason: `origin ${origin} not allowed` };
  if (req.headers.get(API_HEADER) !== "1")
    return { ok: false, status: 403, reason: `missing ${API_HEADER} header` };
  return sameOrigin(req);
}

export function checkEvents(req: Request, config: GuardConfig): GuardResult {
  const host = checkHost(req, config);
  return host.ok ? sameOrigin(req) : host;
}

function sameOrigin(req: Request): GuardResult {
  const site = req.headers.get("sec-fetch-site");
  return site === "same-origin"
    ? { ok: true }
    : { ok: false, status: 403, reason: `sec-fetch-site ${site}` };
}

/**
 * Untrusted PR content renders on this origin, so scripts are locked to our own bundle.
 * `wasm-unsafe-eval` is for Shiki's highlighter; inline styles are needed by the diff renderer.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
  "img-src 'self' data: blob: https://avatars.githubusercontent.com https://*.githubusercontent.com https://github.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");
