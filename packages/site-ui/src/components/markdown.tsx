"use client";

import * as React from "react";
import { cn } from "@rbms/ui";
import { renderMarkdown } from "@rbms/ui/components/markdown";

/*
 * Store-content markdown for the shop's editors and previews. It is the storefront's own renderer (shared from
 * @rbms/ui): headings, lists, quotes, links (http(s), mailto:, tel:, site paths only), GFM tables …, built as
 * React elements (never raw HTML) — so a page, post or policy previews exactly as shoppers will see it.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  return <div className={cn("grid gap-3 text-sm leading-relaxed [&_:where(ul,ol)]:grid [&_:where(ul,ol)]:gap-1", className)}>{renderMarkdown(source)}</div>;
}
