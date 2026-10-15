"use client";

import * as React from "react";
import { cn } from "@srirealtime/ui";

/*
 * A tiny, safe markdown renderer for product descriptions: headings (#, ##, ###), paragraphs, bullet and numbered
 * lists, **bold**, *italic*, `code` and [links](https://…). It builds React elements (never raw HTML), and only
 * http(s) and mailto links are kept.
 */

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = lm?.[2] ?? "";
      if (lm && /^(https?:|mailto:)/i.test(href)) {
        out.push(
          <a key={key} href={href} target="_blank" rel="noreferrer noopener" className="font-medium text-primary underline underline-offset-2">
            {lm[1]}
          </a>,
        );
      } else out.push(lm?.[1] ?? tok);
    } else out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = start + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let k = 0;

  const flushPara = () => {
    if (para.length) {
      const key = `p${k++}`;
      blocks.push(
        <p key={key} className="leading-relaxed">
          {inline(para.join(" "), key)}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const key = `l${k++}`;
      const items = list.items.map((it, i) => <li key={i}>{inline(it, `${key}-${i}`)}</li>);
      blocks.push(
        list.ordered ? (
          <ol key={key} className="list-decimal space-y-1 pl-5">
            {items}
          </ol>
        ) : (
          <ul key={key} className="list-disc space-y-1 pl-5">
            {items}
          </ul>
        ),
      );
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      const key = `h${k++}`;
      const level = h[1]!.length;
      const cls = level === 1 ? "text-lg font-semibold" : level === 2 ? "text-base font-semibold" : "text-sm font-semibold";
      blocks.push(
        <p key={key} role="heading" aria-level={level + 1} className={cls}>
          {inline(h[2]!, key)}
        </p>,
      );
    } else if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((ul ?? ol)![1]!);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();

  return <div className={cn("space-y-3 text-sm", className)}>{blocks}</div>;
}
