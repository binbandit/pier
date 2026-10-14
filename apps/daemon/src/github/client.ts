import type { Database } from "bun:sqlite";

import { VERSION } from "@/config";

import type { TypedDocumentString } from "./gql/graphql";
import { Lane, type Priority } from "./lane";

// One client per account. It owns that account's token, rate windows, and pacing:
//   - GraphQL runs one background request at a time (GitHub recommends serial requests, and it
//     keeps point spend predictable), with a second slot held for interactive ones.
//   - REST runs at most 4 at a time, one slot held for interactive requests, with ETag /
//     Last-Modified revalidation (304s are free).
//   - Holding a slot back means a click never waits behind a slow sync batch.
//   - A secondary-limit response pauses the whole client until `retry-after` passes.

const API = "https://api.github.com";
const REST_CONCURRENCY = 4;

export type RateWindow = { limit: number; remaining: number; used: number; resetAt: number };

export type ErrorKind =
  | "auth"
  | "forbidden"
  | "secondary-limit"
  | "rate-limit"
  | "not-found"
  | "conflict"
  | "validation"
  | "server"
  | "network"
  | "graphql";

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorKind,
    readonly status: number | null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export type RestRequest = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  accept?: string;
  /** The body as text rather than JSON (diffs and patches). */
  text?: boolean;
  /** For endpoints newer than the default API version (stacks: 2026-03-10). */
  apiVersion?: string;
  /** Revalidate with the cached validator and return the cached body on 304. GET only. */
  cache?: boolean;
  /** Send `If-Modified-Since` with this value instead of the cached one (notifications). */
  ifModifiedSince?: string;
  /** Ask without validators (to get the full body) but still cache the answer. */
  unconditional?: boolean;
  priority?: Priority;
};

export type RestResponse<T> = {
  status: number;
  data: T;
  headers: Headers;
  /** True when GitHub answered 304 and `data` came from the cache. */
  notModified: boolean;
};

export type TokenSource = (login: string) => Promise<string>;

export interface GitHubTransport {
  readonly login: string;
  graphql<R, V>(doc: TypedDocumentString<R, V>, variables: V, priority?: Priority): Promise<R>;
  rest<T>(request: RestRequest): Promise<RestResponse<T>>;
  /** Where a GET redirects to (e.g. a job log's storage URL), without following it. */
  location(path: string): Promise<string | null>;
  rates(): { graphql: RateWindow | null; core: RateWindow | null };
}

export class GitHubClient implements GitHubTransport {
  private token: string | null = null;
  private readonly graphqlLane = new Lane(2, 1);
  private readonly restLane = new Lane(REST_CONCURRENCY, 1);
  private pausedUntil = 0;
  private windows: { graphql: RateWindow | null; core: RateWindow | null } = {
    graphql: null,
    core: null,
  };

  constructor(
    readonly login: string,
    private readonly readToken: TokenSource,
    private readonly cache: Database,
  ) {}

  rates() {
    return { ...this.windows };
  }

  graphql<R, V>(
    doc: TypedDocumentString<R, V>,
    variables: V,
    priority: Priority = "background",
  ): Promise<R> {
    const query = doc.toString();
    const run = async () => {
      await this.waitForBudget("graphql", priority);
      const response = await this.send(`${API}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-github-next-global-id": "1" },
        body: JSON.stringify({ query, variables }),
        timeoutMs: 30_000,
      });
      let payload: {
        data?: R | null;
        errors?: { message: string; type?: string }[];
      };
      try {
        payload = (await response.json()) as typeof payload;
      } catch (error) {
        // Headers can succeed before a large response is cut off. Keep body failures in the
        // transport error path so read batches can be split and retried by LiveGitHub.
        const invalidJson = error instanceof SyntaxError;
        throw new GitHubError(
          invalidJson
            ? "GitHub returned incomplete or invalid JSON"
            : `GitHub response interrupted: ${String(error)}`,
          invalidJson ? "server" : "network",
          response.status,
        );
      }
      if (payload.errors?.length) {
        const rateLimited = payload.errors.some((e) => e.type === "RATE_LIMITED");
        if (rateLimited)
          this.pausedUntil = Math.max(
            this.pausedUntil,
            this.windows.graphql?.resetAt ?? Date.now() + 60_000,
          );
        // Partial results (one node in a batch was deleted) are still useful to a read; a write
        // with errors didn't happen, and GitHub's reason is the one to report.
        if (!payload.data || rateLimited || /^\s*mutation\b/.test(query)) {
          throw new GitHubError(
            payload.errors.map((e) => e.message).join("; "),
            rateLimited ? "rate-limit" : "graphql",
            response.status,
          );
        }
      }
      if (!payload.data)
        throw new GitHubError("GraphQL response had no data", "graphql", response.status);
      return payload.data;
    };
    return this.graphqlLane.run(priority, run);
  }

  rest<T>(request: RestRequest): Promise<RestResponse<T>> {
    const priority = request.priority ?? "background";
    return this.restLane.run(priority, async () => {
      await this.waitForBudget("core", priority);
      const method = request.method ?? "GET";
      const accept = request.accept ?? "application/vnd.github+json";
      const cacheKey = `${this.login} ${accept} ${request.path}`;
      const cached = method === "GET" && request.cache ? this.cachedResponse(cacheKey) : null;

      const send = (conditional: boolean) => {
        const headers: Record<string, string> = { accept };
        if (request.apiVersion) headers["x-github-api-version"] = request.apiVersion;
        if (conditional && cached?.etag) headers["if-none-match"] = cached.etag;
        const ifModifiedSince = request.ifModifiedSince ?? cached?.last_modified;
        if (conditional && ifModifiedSince) headers["if-modified-since"] = ifModifiedSince;
        if (request.body !== undefined) headers["content-type"] = "application/json";
        return this.send(`${API}${request.path}`, {
          method,
          headers,
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
          timeoutMs: 20_000,
          allow304: conditional,
        });
      };

      let response = await send(!request.unconditional);
      if (response.status === 304) {
        if (cached) {
          return {
            status: 304,
            data: JSON.parse(cached.body) as T,
            headers: response.headers,
            notModified: true,
          };
        }
        // A caller-supplied validator with nothing cached to fall back on: ask unconditionally.
        response = await send(false);
      }
      const text = await response.text();
      const data = (request.text ? text : text ? JSON.parse(text) : null) as T;
      if (method === "GET" && request.cache) {
        this.storeResponse(
          cacheKey,
          response.headers.get("etag"),
          response.headers.get("last-modified"),
          text,
        );
      }
      return { status: response.status, data, headers: response.headers, notModified: false };
    });
  }

  location(path: string): Promise<string | null> {
    return this.restLane.run("interactive", async () => {
      const response = await this.send(`${API}${path}`, {
        method: "GET",
        headers: { accept: "application/vnd.github+json" },
        timeoutMs: 20_000,
        manualRedirect: true,
      });
      return response.headers.get("location");
    });
  }

  // -------------------------------------------------------------------------

  private async send(
    url: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body?: string | undefined;
      timeoutMs: number;
      allow304?: boolean;
      /** Return 3xx responses instead of following them. */
      manualRedirect?: boolean;
    },
    retriedAuth = false,
  ): Promise<Response> {
    const wait = this.pausedUntil - Date.now();
    if (wait > 0) await Bun.sleep(wait);

    this.token ??= await this.readToken(this.login);
    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method,
        headers: {
          "x-github-api-version": "2022-11-28",
          ...init.headers,
          authorization: `Bearer ${this.token}`,
          "user-agent": `pier/${VERSION}`,
        },
        body: init.body ?? null,
        signal: AbortSignal.timeout(init.timeoutMs),
        redirect: init.manualRedirect ? "manual" : "follow",
      });
    } catch (error) {
      throw new GitHubError(`network error: ${String(error)}`, "network", null);
    }

    this.recordRate(response.headers);
    if (response.ok || (init.allow304 && response.status === 304)) return response;
    if (init.manualRedirect && response.status >= 300 && response.status < 400) return response;

    // A revoked or rotated token: re-read it from gh once, then give up.
    if (response.status === 401 && !retriedAuth) {
      this.token = null;
      return this.send(url, init, true);
    }
    throw await this.toError(response);
  }

  private async toError(response: Response): Promise<GitHubError> {
    const text = await response.text().catch(() => "");
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      // not JSON; keep the raw text
    }
    const status = response.status;
    // Gateway errors come back as HTML pages; nobody needs to read those.
    if (/^\s*</.test(message)) message = response.statusText || "error page";
    const retryAfter = Number(response.headers.get("retry-after"));
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;

    if (
      (status === 403 || status === 429) &&
      (retryAfter > 0 || /secondary rate limit|content creation/i.test(message))
    ) {
      const ms = retryAfter > 0 ? retryAfter * 1000 : 60_000;
      this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
      return new GitHubError(message, "secondary-limit", status, ms);
    }
    if ((status === 403 || status === 429) && remaining === "0") {
      this.pausedUntil = Math.max(this.pausedUntil, reset || Date.now() + 60_000);
      return new GitHubError(message, "rate-limit", status, Math.max(0, reset - Date.now()));
    }
    const kind: ErrorKind =
      status === 401
        ? "auth"
        : status === 403
          ? "forbidden"
          : status === 404
            ? "not-found"
            : status === 409
              ? "conflict"
              : status === 422
                ? "validation"
                : status >= 500
                  ? "server"
                  : "validation";
    return new GitHubError(`${status} ${message}`.trim(), kind, status);
  }

  private recordRate(headers: Headers): void {
    const resource = headers.get("x-ratelimit-resource");
    if (resource !== "graphql" && resource !== "core") return;
    this.windows[resource] = {
      limit: Number(headers.get("x-ratelimit-limit")),
      remaining: Number(headers.get("x-ratelimit-remaining")),
      used: Number(headers.get("x-ratelimit-used")),
      resetAt: Number(headers.get("x-ratelimit-reset")) * 1000,
    };
  }

  /**
   * Background work keeps 20% of each hourly window in reserve for things Brayden does
   * himself, here and in other tools (gh, editors) that share the same per-user budget.
   */
  private async waitForBudget(resource: "graphql" | "core", priority: Priority): Promise<void> {
    const window = this.windows[resource];
    if (!window || window.resetAt < Date.now()) return;
    const floor = priority === "interactive" ? 1 : Math.ceil(window.limit * 0.2);
    if (window.remaining >= floor) return;
    const wait = window.resetAt - Date.now();
    if (priority === "background") {
      throw new GitHubError(
        `${resource} budget reserved; resets in ${Math.ceil(wait / 1000)}s`,
        "rate-limit",
        null,
        wait,
      );
    }
    await Bun.sleep(wait);
  }

  private cachedResponse(key: string) {
    return this.cache
      .query<{ etag: string | null; last_modified: string | null; body: string }, [string]>(
        "SELECT etag, last_modified, body FROM http_cache WHERE key = ?",
      )
      .get(key);
  }

  private storeResponse(
    key: string,
    etag: string | null,
    lastModified: string | null,
    body: string,
  ): void {
    if (!etag && !lastModified) return;
    this.cache
      .query(
        `INSERT INTO http_cache (key, etag, last_modified, body, fetched_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET etag = excluded.etag, last_modified = excluded.last_modified,
           body = excluded.body, fetched_at = excluded.fetched_at`,
      )
      .run(key, etag, lastModified, body, new Date().toISOString());
  }
}
