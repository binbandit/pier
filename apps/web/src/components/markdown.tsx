import { useNavigate } from "@tanstack/react-router";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef } from "react";

import { githubLink } from "@/lib/permalink";

import { enrich } from "./enrich";

// Markdown written by PR authors and bots. It renders on pier's own origin, next to buttons that
// approve and merge, so it is sanitised hard: no scripts, styles, forms or frames, links open
// outside the app (except links to PRs, which open here), and images load only from GitHub
// (anything else could be a tracking pixel).

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
  // Math and diagrams GitHub draws later in the browser come as raw source; keep the source,
  // marked so `enrich` can draw it (and drop GitHub's loading spinner).
  DOMPurify.addHook("uponSanitizeElement", (node, data) => {
    if (!(node instanceof Element)) return;
    if (data.tagName === "math-renderer") {
      const math = document.createElement("span");
      math.dataset.math = node.classList.contains("js-display-math") ? "display" : "inline";
      math.textContent = node.textContent;
      node.replaceWith(math);
    } else if (data.tagName === "section" && node.getAttribute("data-type")) {
      const pre = document.createElement("pre");
      if (node.getAttribute("data-type") === "mermaid") pre.dataset.diagram = "mermaid";
      pre.textContent = node.querySelector("pre")?.textContent ?? "";
      node.replaceWith(pre);
    } else if (data.tagName === "code" && node.classList.contains("language-mermaid")) {
      // Markdown pier renders itself: a ```mermaid block.
      if (node.parentElement?.tagName === "PRE") node.parentElement.dataset.diagram = "mermaid";
    }
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
  return <Rendered html={html} className={className} />;
}

/** HTML GitHub already rendered (mentions and references resolved), sanitised again here. */
export function Html({ html, className }: { html: string; className?: string }) {
  const clean = useMemo(() => sanitize(html), [html]);
  return <Rendered html={clean} className={className} />;
}

/** Sanitised HTML in the page, with its math and diagrams drawn. */
function Rendered({ html, className }: { html: string; className?: string | undefined }) {
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  // React replaces the content whenever the HTML changes, so it's drawn again each time.
  useEffect(() => (html && root.current ? enrich(root.current) : undefined), [html]);
  // A link to a PR opens it here. A modified click still opens it in a new tab.
  useEffect(() => {
    const open = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      const link = anchor ? githubLink(anchor.href) : null;
      if (!link) return;
      event.preventDefault();
      void navigate({ to: link.path, hash: link.hash });
    };
    const element = root.current;
    element?.addEventListener("click", open);
    return () => element?.removeEventListener("click", open);
  }, [navigate]);
  // Sanitised above; this is the one place pier renders HTML it didn't write.
  return (
    <div
      ref={root}
      className={className ?? "prose-pier"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
