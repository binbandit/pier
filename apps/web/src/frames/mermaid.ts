import mermaid from "mermaid";

// Runs inside a sandboxed frame (scripts, but no access to pier's origin): it gets a diagram's
// source from the page, draws it, and says how tall it came out. A diagram that fails says why,
// and the page keeps showing its source.

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  fontFamily: "Inter Variable, Inter, system-ui, sans-serif",
  themeVariables: {
    background: "#000000",
    primaryColor: "#121212",
    primaryBorderColor: "#3c3c3c",
    primaryTextColor: "#e6e6e6",
    lineColor: "#7a7a7a",
    secondaryColor: "#171717",
    tertiaryColor: "#0d0d0d",
    textColor: "#cccccc",
  },
});

async function draw(source: string): Promise<void> {
  try {
    const { svg } = await mermaid.render("diagram", source);
    document.body.innerHTML = svg;
    window.parent.postMessage({ height: document.body.scrollHeight }, "*");
  } catch (error) {
    window.parent.postMessage(
      { error: error instanceof Error ? error.message : String(error) },
      "*",
    );
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const data: unknown = event.data;
  if (typeof data !== "object" || data === null || !("source" in data)) return;
  if (typeof data.source === "string") void draw(data.source);
});

window.parent.postMessage({ ready: true }, "*");
