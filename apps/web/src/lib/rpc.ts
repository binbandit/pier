import { queryOptions } from "@tanstack/react-query";

import { API_HEADER, type Input, type Output, type ProcedureName } from "@pier/core/contract";

// Typed calls into the daemon. The contract in @pier/core is the only thing shared, so a
// renamed procedure or changed shape is a type error here first.

export class RpcError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export async function rpc<N extends ProcedureName>(name: N, input: Input<N>): Promise<Output<N>> {
  const response = await fetch(`/api/rpc/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", [API_HEADER]: "1" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      // plain-text error from the guard
    }
    throw new RpcError(message || `${name} failed (${response.status})`, response.status);
  }
  return (await response.json()) as Output<N>;
}

/** Query options keyed by procedure first, so a server "changed" topic can invalidate by name. */
export function q<N extends ProcedureName>(name: N, input: Input<N>) {
  return queryOptions({
    queryKey: [name, input] as const,
    queryFn: () => rpc(name, input),
  });
}

/**
 * For answers read live from GitHub instead of the local replica (merge state, check runs). The
 * key also carries the PR fields they depend on, so they're asked again exactly when those move.
 */
export function qLive<N extends ProcedureName>(name: N, input: Input<N>, ...dependsOn: unknown[]) {
  return queryOptions({
    queryKey: [name, input, ...dependsOn] as const,
    queryFn: () => rpc(name, input),
  });
}
