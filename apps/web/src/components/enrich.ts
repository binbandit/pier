// What GitHub draws on top of rendered Markdown, drawn here: math with KaTeX, and Mermaid
// diagrams in a sandboxed frame. The sanitizer has already marked them (`data-math`,
// `data-diagram`); this runs once the HTML is in the page.

/** Draws the math and diagrams under `root`; the returned function stops listening. */
export function enrich(root: HTMLElement): () => void {
  const stops: (() => void)[] = [];
  const math = [...root.querySelectorAll<HTMLElement>("[data-math]")];
  if (math.length > 0) void drawMath(math);
  for (const pre of root.querySelectorAll<HTMLElement>("pre[data-diagram='mermaid']")) {
    stops.push(drawDiagram(pre));
  }
  return () => {
    for (const stop of stops) stop();
  };
}

async function drawMath(elements: HTMLElement[]): Promise<void> {
  const [{ default: katex }] = await Promise.all([
    import("katex"),
    import("katex/dist/katex.min.css"),
  ]);
  for (const el of elements) {
    if (el.dataset.drawn) continue;
    const display = el.dataset.math === "display";
    // GitHub keeps the delimiters ($…$, $$…$$) in the text.
    const tex = (el.textContent ?? "").trim().replace(/^\$\$?|\$\$?$/g, "");
    // trust: false keeps \href, \url and friends from doing anything.
    katex.render(tex, el, {
      displayMode: display,
      throwOnError: false,
      trust: false,
      output: "html",
    });
    el.dataset.drawn = "true";
  }
}

function drawDiagram(pre: HTMLElement): () => void {
  const frame = document.createElement("iframe");
  frame.src = "/frames/mermaid.html";
  // Scripts, but an opaque origin: the frame can't reach pier, its storage or its API.
  frame.sandbox.add("allow-scripts");
  frame.title = "Diagram";
  frame.className = "my-2 block w-full rounded-md border border-line";
  // Laid out but out of sight until it's drawn: a frame with display: none measures nothing.
  frame.style.height = "0px";
  frame.style.visibility = "hidden";
  const source = pre.textContent ?? "";
  const listen = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return;
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) return;
    if ("ready" in data) frame.contentWindow?.postMessage({ source }, "*");
    else if ("height" in data && typeof data.height === "number") {
      frame.style.height = `${Math.min(data.height + 16, 2000)}px`;
      frame.style.visibility = "visible";
      pre.style.display = "none";
    } else if ("error" in data) frame.remove();
  };
  window.addEventListener("message", listen);
  pre.after(frame);
  return () => {
    window.removeEventListener("message", listen);
    frame.remove();
    pre.style.display = "";
  };
}
