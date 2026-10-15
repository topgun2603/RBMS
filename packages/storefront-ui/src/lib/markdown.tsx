import * as React from "react";

/**
 * A small, safe markdown → React renderer (no dangerouslySetInnerHTML; raw HTML is shown as text). Server- and
 * client-safe. Supports: #/##/### headings, paragraphs, soft line breaks, **bold**, *italic* / _italic_, `code`,
 * ~~strike~~, [links](href) (http(s), mailto, tel, site paths and #anchors only), - / * / 1. lists, > quotes, ---.
 */

const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;

export function safeHref(href: string): string | null {
  const h = href.trim();
  return SAFE_HREF.test(h) ? h : null;
}

type Node = React.ReactNode;

const INLINE_RE = /(\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_)/;

function inline(text: string, key: string): Node[] {
  const out: Node[] = [];
  let rest = text;
  let i = 0;
  while (rest.length) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const k = `${key}-${i++}`;
    if (m[2] ?? m[3]) out.push(<strong key={k}>{inline((m[2] ?? m[3])!, k)}</strong>);
    else if (m[4]) out.push(<del key={k}>{inline(m[4], k)}</del>);
    else if (m[5]) out.push(<code key={k} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">{m[5]}</code>);
    else if (m[6] && m[7]) {
      const href = safeHref(m[7]);
      const external = !!href && /^https?:\/\//i.test(href);
      out.push(
        href ? (
          <a key={k} href={href} className="font-medium text-primary underline underline-offset-2" {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}>
            {inline(m[6], k)}
          </a>
        ) : (
          <span key={k}>{inline(m[6], k)}</span>
        ),
      );
    } else if (m[8] ?? m[9]) out.push(<em key={k}>{inline((m[8] ?? m[9])!, k)}</em>);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

/** Inline text with soft line breaks. */
function lines(text: string, key: string): Node[] {
  const parts = text.split("\n");
  return parts.flatMap((p, i) => (i < parts.length - 1 ? [...inline(p, `${key}l${i}`), <br key={`${key}br${i}`} />] : inline(p, `${key}l${i}`)));
}

export function renderMarkdown(source: string | null | undefined): Node[] {
  if (!source) return [];
  const src = source.replace(/\r\n?/g, "\n");
  const rows = src.split("\n");
  const out: Node[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];
  let n = 0;

  const flushPara = () => {
    if (para.length) out.push(<p key={`p${n++}`}>{lines(para.join("\n"), `p${n}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (list) {
      const k = `l${n++}`;
      const items = list.items.map((it, i) => <li key={`${k}-${i}`}>{lines(it, `${k}-${i}`)}</li>);
      out.push(list.ordered ? <ol key={k} className="list-decimal ps-5">{items}</ol> : <ul key={k} className="list-disc ps-5">{items}</ul>);
    }
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(<blockquote key={`q${n++}`} className="border-s-4 border-primary/30 ps-4 italic text-muted-foreground">{lines(quote.join("\n"), `q${n}`)}</blockquote>);
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const raw of rows) {
    const row = raw.trimEnd();
    if (!row.trim()) {
      flushAll();
      continue;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(row);
    if (h) {
      flushAll();
      const level = Math.min(h[1]!.length + 1, 4);
      const k = `h${n++}`;
      const content = inline(h[2]!.replace(/\s+#+\s*$/, ""), k);
      out.push(
        level === 2 ? <h2 key={k} className="font-heading text-xl font-semibold">{content}</h2> : level === 3 ? <h3 key={k} className="font-heading text-lg font-semibold">{content}</h3> : <h4 key={k} className="font-semibold">{content}</h4>,
      );
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(row)) {
      flushAll();
      out.push(<hr key={`hr${n++}`} className="border-border" />);
      continue;
    }
    const li = /^\s{0,3}(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(row);
    if (li) {
      flushPara();
      flushQuote();
      const ordered = !!li[2];
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(li[3]!);
      continue;
    }
    const q = /^\s{0,3}>\s?(.*)$/.exec(row);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]!);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += `\n${row.trim()}`;
      continue;
    }
    flushList();
    flushQuote();
    para.push(row);
  }
  flushAll();
  return out;
}

/** Markdown in a prose wrapper. */
export function Markdown({ source, className }: { source: string | null | undefined; className?: string }) {
  const nodes = renderMarkdown(source);
  if (!nodes.length) return null;
  return <div className={`sf-prose ${className ?? ""}`}>{nodes}</div>;
}
