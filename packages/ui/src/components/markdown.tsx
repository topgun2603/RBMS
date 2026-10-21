import * as React from "react";

/**
 * A small, safe markdown → React renderer (no dangerouslySetInnerHTML; raw HTML is shown as text). Server- and
 * client-safe. Supports: #/##/### headings, paragraphs, soft line breaks, **bold**, *italic* / _italic_, `code`,
 * ~~strike~~, [links](href) (http(s), mailto, tel, site paths and #anchors only), - / * / 1. lists, > quotes, ---,
 * and GFM pipe tables (header row + `| --- | :-: |` delimiter row; cells take inline markup, `\|` escapes a pipe).
 *
 * Shared by the storefront (storefront-ui wraps it in `.sf-prose`) and the shop's editor previews (site-ui), so what a
 * merchant previews is what shoppers see. Tables scroll sideways inside their own box on narrow screens.
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

/* ------------------------------------------------------------------ GFM tables */

export type TableAlign = "left" | "center" | "right" | null;

/** Splits a table row into trimmed cells: drops the optional outer pipes and honours `\|` escapes. */
export function splitTableRow(row: string): string[] {
  let s = row.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const DELIM_CELL = /^:?-+:?$/;

/** The alignments of a delimiter row (`| --- | :-: | --: |`), or null when the line isn't one. */
export function parseTableDelimiter(row: string): TableAlign[] | null {
  if (!row.includes("-") || !/^[\s|:-]+$/.test(row)) return null;
  const cells = splitTableRow(row);
  if (!cells.length || !cells.every((c) => DELIM_CELL.test(c))) return null;
  return cells.map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
}

/** The column alignments when `row` + `next` open a table: a piped header whose cell count matches the delimiter. */
function tableStart(row: string, next: string | undefined): TableAlign[] | null {
  if (next === undefined || !row.includes("|")) return null;
  const align = parseTableDelimiter(next.trim());
  if (!align) return null;
  return splitTableRow(row).length === align.length ? align : null;
}

function renderTable(header: string[], align: TableAlign[], body: string[][], k: string): Node {
  const cols = align.length;
  const fit = (cells: string[]) => Array.from({ length: cols }, (_, i) => cells[i] ?? "");
  const style = (i: number): React.CSSProperties | undefined => (align[i] ? { textAlign: align[i]! } : undefined);
  return (
    // A focusable region so keyboard users can scroll a wide table; the bordered box keeps the scroll inside the page.
    <div key={k} className="md-table w-full max-w-full overflow-x-auto rounded-lg border border-border" role="region" aria-label={header.filter(Boolean).join(", ") || undefined} tabIndex={0}>
      <table className="w-full border-collapse text-start text-[0.92em] leading-snug">
        <thead className="bg-muted/70">
          <tr>
            {fit(header).map((c, i) => (
              <th key={i} scope="col" style={style(i)} className="whitespace-nowrap border-b border-border px-3 py-2 text-start font-semibold text-foreground">
                {inline(c, `${k}h${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className="border-b border-border/70 last:border-b-0 even:bg-muted/40">
              {fit(r).map((c, i) => (
                <td key={i} style={style(i)} className="min-w-[5.5rem] px-3 py-2 align-top">
                  {inline(c, `${k}r${ri}c${i}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

  for (let ri = 0; ri < rows.length; ri++) {
    const raw = rows[ri]!;
    const row = raw.trimEnd();
    if (!row.trim()) {
      flushAll();
      continue;
    }
    const align = tableStart(row, rows[ri + 1]);
    if (align) {
      flushAll();
      const header = splitTableRow(row);
      const body: string[][] = [];
      ri += 2;
      while (ri < rows.length && rows[ri]!.trim() && rows[ri]!.includes("|")) body.push(splitTableRow(rows[ri++]!));
      ri--;
      out.push(renderTable(header, align, body, `t${n++}`));
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

/** Markdown in a plain wrapper (callers add their own prose spacing, e.g. storefront-ui's `.sf-prose`). */
export function MarkdownBlocks({ source, className }: { source: string | null | undefined; className?: string }) {
  const nodes = renderMarkdown(source);
  if (!nodes.length) return null;
  return <div className={className}>{nodes}</div>;
}
