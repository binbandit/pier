import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";

// Markdown written by PR authors and bots. It renders on pier's own origin, next to buttons that
// approve and merge, so it is sanitised hard: no scripts, styles, forms or frames, links open
// outside the app, and images load only from GitHub (anything else could be a tracking pixel).

const IMAGE_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(githubusercontent\.com|github\.com)\//i;

let configured = false;

function configure() {
  if (configured) return;
  configured = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noreferrer noopener");
    }
  });
  DOMPurify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName !== "img" || !(node instanceof HTMLImageElement)) return;
    const src = node.getAttribute("src") ?? "";
    if (!IMAGE_HOSTS.test(src))
      node.replaceWith(document.createTextNode(node.getAttribute("alt") ?? ""));
  });
}

export function renderMarkdown(source: string): string {
  configure();
  const html = marked.parse(source, { async: false, gfm: true, breaks: false });
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: [
      "style",
      "form",
      "input",
      "button",
      "textarea",
      "select",
      "iframe",
      "object",
      "embed",
      "svg",
      "math",
    ],
    FORBID_ATTR: ["style", "class", "id"],
  });
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  // Sanitised above; this is the one place pier renders HTML it didn't write.
  return <div className={className ?? "prose-pier"} dangerouslySetInnerHTML={{ __html: html }} />;
}
