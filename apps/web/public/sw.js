// The service worker makes pier installable, and when the daemon isn't running it answers page
// loads with a small page saying so (with the same page on GitHub), which tries again every few
// seconds until the daemon is back. Nothing is cached: everything pier shows comes from the daemon.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  // Earlier versions kept a copy of the app shell; it's no longer used.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => offline(new URL(event.request.url))));
});

const RETRY_SECONDS = 4;

function offline(url) {
  const github = githubFor(url);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta http-equiv="refresh" content="${RETRY_SECONDS}">
<title>pier isn't running</title>
<style>
  html { background: #000; color: #cccccc; font: 15px/22px system-ui, -apple-system, sans-serif; }
  body { margin: 0; padding: 96px 64px; max-width: 640px; }
  h1 { margin: 0 0 12px; font-size: 24px; line-height: 32px; font-weight: 600; color: #e6e6e6; }
  p { margin: 0 0 12px; }
  code { font: 14px/22px "MonoLisa Variable", "JetBrains Mono", ui-monospace, monospace; color: #e6e6e6; }
  .faint { color: #7a7a7a; font-size: 13px; line-height: 18px; margin-top: 24px; }
  a { color: #cccccc; text-decoration: underline; text-decoration-color: #505050; text-underline-offset: 3px; }
  a:hover { color: #e6e6e6; text-decoration-color: #a4a4a4; }
</style>
</head>
<body>
<h1>pier isn't running</h1>
<p>The pier daemon on this computer isn't answering. After <code>pier install</code> it starts at login; to start it now, run <code>pier serve</code>, or <code>pier doctor</code> to see what's wrong.</p>
<p><a href="${escape(github)}">Open this on github.com</a></p>
<p class="faint">This page tries again every few seconds and opens as soon as pier is back.</p>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

/** The same page on GitHub where there is one (pier's paths mirror GitHub's), else your PRs. */
function githubFor(url) {
  const mirrored = /^\/[^/]+\/[^/]+\/(pull\/\d+(\/files)?|pulls)\/?$/.test(url.pathname);
  const target = new URL(mirrored ? url.pathname : "/pulls", "https://github.com");
  // The link extension lets this one through to GitHub.
  target.searchParams.set("pier", "0");
  return target.toString();
}

function escape(text) {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
