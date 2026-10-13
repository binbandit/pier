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
  // GitHub draws a review suggestion as a small diff that only its classes tell apart; classes
  // don't survive sanitising, so the old and new lines are marked in pier's own terms first.
  DOMPurify.addHook("beforeSanitizeAttributes", (node) => {
    // Typed as an element, but text and comment nodes come through here too.
    if (!(node instanceof Element)) return;
    const classes = node.getAttribute("class") ?? "";
    if (classes.includes("js-suggested-changes-blob")) node.setAttribute("data-suggestion", "");
    else if (classes.includes("blob-code-deletion")) node.setAttribute("data-diff", "old");
    else if (classes.includes("blob-code-addition")) node.setAttribute("data-diff", "new");
    else if (classes.includes("blob-num")) node.setAttribute("data-diff", "number");
  });
  DOMPurify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName !== "img" || !(node instanceof HTMLImageElement)) return;
    const src = node.getAttribute("src") ?? "";
    if (!IMAGE_HOSTS.test(src))
      node.replaceWith(document.createTextNode(node.getAttribute("alt") ?? ""));
  });
}

const FORBID_TAGS = [
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
];

/** Sanitises HTML from anywhere untrusted, including GitHub's own rendered bodies. */
export function sanitize(html: string): string {
  configure();
  return DOMPurify.sanitize(html, { FORBID_TAGS, FORBID_ATTR: ["style", "class", "id"] });
}

export function renderMarkdown(source: string): string {
  return sanitize(marked.parse(source, { async: false, gfm: true, breaks: false }));
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  // Sanitised above; this is the one place pier renders HTML it didn't write.
  return <div className={className ?? "prose-pier"} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** HTML GitHub already rendered (mentions and references resolved), sanitised again here. */
export function Html({ html, className }: { html: string; className?: string }) {
  const clean = useMemo(() => sanitize(html), [html]);
  return <div className={className ?? "prose-pier"} dangerouslySetInnerHTML={{ __html: clean }} />;
}
