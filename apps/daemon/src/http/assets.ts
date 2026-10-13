// The built web app. In a compiled `pier` binary its files are embedded and registered here at
// startup (see scripts/build.ts); in development the daemon serves apps/web/dist from disk, or
// nothing at all while Vite serves the app.

let embedded: Map<string, string> | null = null;

/** Called by the compiled entry point with URL path -> embedded file path. */
export function registerEmbeddedAssets(assets: Map<string, string>): void {
  embedded = assets;
}

export function embeddedAssets(): Map<string, string> | null {
  return embedded;
}
