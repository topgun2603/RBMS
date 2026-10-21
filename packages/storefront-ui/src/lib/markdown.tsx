import * as React from "react";
import { renderMarkdown } from "@srirealtime/ui/components/markdown";

/**
 * Storefront markdown: the shared, safe renderer from @srirealtime/ui (headings, lists, quotes, links, GFM tables …; no
 * raw HTML) inside the storefront's `.sf-prose` rhythm. The shop's editor previews (site-ui) use the same renderer.
 */
export { renderMarkdown, safeHref } from "@srirealtime/ui/components/markdown";

/** Markdown in a prose wrapper. */
export function Markdown({ source, className }: { source: string | null | undefined; className?: string }) {
  const nodes = renderMarkdown(source);
  if (!nodes.length) return null;
  return <div className={`sf-prose ${className ?? ""}`}>{nodes}</div>;
}
