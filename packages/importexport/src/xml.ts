/**
 * Tiny tolerant XML reader for Tally exports (no dependency). Handles declarations, comments, CDATA,
 * entities (named, decimal and hex numeric references) and self-closing tags. Tally sometimes writes invalid
 * control-character references (&#4;) which are dropped. Not a validating parser.
 */
export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlError";
  }
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || (code < 32 && code !== 9 && code !== 10 && code !== 13)) return "";
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export const escapeXml = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Decodes UTF-16 LE/BE (BOM) or UTF-8 (BOM or not); Tally often saves UTF-16. */
export function decodeXmlBytes(data: Buffer): string {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) return new TextDecoder("utf-16le").decode(data.subarray(2));
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    const swapped = Buffer.from(data.subarray(2));
    swapped.swap16();
    return new TextDecoder("utf-16le").decode(swapped);
  }
  // UTF-16 LE without BOM: the byte after an ASCII "<" is NUL.
  if (data.length >= 4 && data[0] === 0x3c && data[1] === 0x00) return new TextDecoder("utf-16le").decode(data);
  const s = new TextDecoder("utf-8").decode(data);
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** True when the bytes look like an XML document (after a BOM / whitespace). */
export function looksLikeXml(data: Buffer): boolean {
  const head = decodeXmlBytes(data.subarray(0, 400)).trimStart();
  return head.startsWith("<?xml") || /^<[A-Za-z]/.test(head);
}

const MAX_NODES = 2_000_000;

function findTagEnd(s: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return i;
  }
  return -1;
}

export function parseXml(input: string): XmlNode {
  const root: XmlNode = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  let nodes = 0;
  const n = input.length;
  while (i < n) {
    const lt = input.indexOf("<", i);
    const top = stack[stack.length - 1]!;
    if (lt < 0) {
      top.text += decodeEntities(input.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(input.slice(i, lt));
    if (input.startsWith("<!--", lt)) {
      const end = input.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
    } else if (input.startsWith("<![CDATA[", lt)) {
      const end = input.indexOf("]]>", lt + 9);
      top.text += input.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
    } else if (input.startsWith("<?", lt) || input.startsWith("<!", lt)) {
      const end = input.indexOf(">", lt + 2);
      i = end < 0 ? n : end + 1;
    } else if (input[lt + 1] === "/") {
      const end = input.indexOf(">", lt + 2);
      const name = input.slice(lt + 2, end < 0 ? n : end).trim();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k]!.tag === name) {
          stack.length = k;
          break;
        }
      }
      i = end < 0 ? n : end + 1;
    } else {
      const end = findTagEnd(input, lt + 1);
      if (end < 0) throw new XmlError("Unterminated tag");
      let body = input.slice(lt + 1, end);
      const selfClose = body.endsWith("/");
      if (selfClose) body = body.slice(0, -1);
      const m = /^([^\s/>]+)([\s\S]*)$/.exec(body);
      if (!m) throw new XmlError("Bad tag");
      const attrs: Record<string, string> = {};
      const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = re.exec(m[2]!))) attrs[a[1]!] = decodeEntities(a[3] ?? a[4] ?? "");
      const node: XmlNode = { tag: m[1]!, attrs, children: [], text: "" };
      if (++nodes > MAX_NODES) throw new XmlError("The XML file is too large");
      top.children.push(node);
      if (!selfClose) stack.push(node);
      i = end + 1;
    }
  }
  if (!root.children.length) throw new XmlError("No XML elements found");
  return root.children.length === 1 ? root.children[0]! : root;
}

/** All descendants (depth-first) with this tag. */
export function findAll(node: XmlNode, tag: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (c.tag === tag) out.push(c);
    findAll(c, tag, out);
  }
  return out;
}

/** Direct children with one of these tags. */
export const kids = (node: XmlNode, ...tags: string[]) => node.children.filter((c) => tags.includes(c.tag));

/** Trimmed text of the first direct child with one of the tags ("" when none). */
export function childText(node: XmlNode, ...tags: string[]): string {
  for (const t of tags) {
    const c = node.children.find((x) => x.tag === t);
    if (c) return c.text.trim();
  }
  return "";
}

/** Trimmed text of the first non-empty descendant with one of the tags. */
export function deepText(node: XmlNode, ...tags: string[]): string {
  for (const t of tags) {
    const c = findAll(node, t).find((x) => x.text.trim());
    if (c) return c.text.trim();
  }
  return "";
}
