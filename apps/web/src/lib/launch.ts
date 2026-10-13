// An installed pier window that's already open is focused, not reloaded, when a link into pier
// opens (the manifest's `launch_handler: focus-existing`). The link arrives here instead.

type LaunchParams = { readonly targetURL?: string };

declare global {
  interface Window {
    launchQueue?: { setConsumer(consumer: (params: LaunchParams) => void): void };
  }
}

export function followLaunches(go: (href: string) => void): void {
  window.launchQueue?.setConsumer((params) => {
    if (!params.targetURL) return;
    const url = new URL(params.targetURL);
    go(`${url.pathname}${url.search}${url.hash}`);
  });
}
