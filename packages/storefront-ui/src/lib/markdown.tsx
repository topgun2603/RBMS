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

const STOP = new Set(["our", "the", "a", "an", "and", "of", "policy", "policies", "store", "shop"]);
const headingWords = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !STOP.has(w));

/**
 * Drops a heading at the very top of `source` when it repeats the title the page already shows above it (a returns
 * policy that starts with "## Returns & exchanges" under a "Returns & refunds" label). A `# Heading` / `**Heading**`
 * line counts when it is short (six words or fewer) and starts with the same word as one of `titles`, ignoring case,
 * punctuation and filler words ("policy", "our", "the").
 */
export function stripLeadingHeading(source: string | null | undefined, titles: readonly string[]): string {
  const text = (source ?? "").replace(/^﻿/, "");
  const m = /^\s*(?:#{1,6}[ \t]+(.+?)[ \t#]*|\*\*([^*\n]+?)\*\*[ \t]*:?|__([^_\n]+?)__[ \t]*:?)[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return text;
  const head = headingWords(m[1] ?? m[2] ?? m[3] ?? "");
  if (!head.length || head.length > 6) return text;
  const same = titles.some((t) => headingWords(t)[0] === head[0]);
  return same ? text.slice(m[0].length).replace(/^\s*\n/, "") : text;
}
