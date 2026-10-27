/**
 * A small reader for the first worksheet of an .xlsx file (Office Open XML), enough for bank statements: shared and
 * inline strings, numbers, booleans and date-formatted numbers (returned as YYYY-MM-DD). It reads the ZIP container
 * with node:zlib and the XML with regular expressions, so it has no dependencies. Not supported: ZIP64, encrypted
 * workbooks, the old binary .xls (BIFF) format, formulas without a cached value.
 */
import { inflateRawSync } from "node:zlib";

export class SpreadsheetError extends Error {}

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/** Entries of a ZIP file by name (decompressed lazily). */
export function unzip(data: Uint8Array): Map<string, () => Uint8Array> {
  const out = new Map<string, () => Uint8Array>();
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--) {
    if (u32(data, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SpreadsheetError("The file is not a valid .xlsx workbook");
  const count = u16(data, eocd + 10);
  let p = u32(data, eocd + 16);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (p + 46 > data.length || u32(data, p) !== 0x02014b50) throw new SpreadsheetError("The workbook is damaged (central directory)");
    const method = u16(data, p + 10);
    const size = u32(data, p + 20);
    const nameLen = u16(data, p + 28);
    const extraLen = u16(data, p + 30);
    const commentLen = u16(data, p + 32);
    const local = u32(data, p + 42);
    const name = dec.decode(data.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    out.set(name, () => {
      if (u32(data, local) !== 0x04034b50) throw new SpreadsheetError("The workbook is damaged (local header)");
      const start = local + 30 + u16(data, local + 26) + u16(data, local + 28);
      const raw = data.subarray(start, start + size);
      if (method === 0) return raw;
      if (method === 8) return new Uint8Array(inflateRawSync(raw));
      throw new SpreadsheetError(`Unsupported compression in the workbook (method ${method})`);
    });
  }
  return out;
}

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const code = e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  });
}

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]!) : undefined;
};

/** Text of an <si> / <is> element: all <t> runs, skipping phonetic hints. */
const runText = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]!)).join("");

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isDateFormat(code: string): boolean {
  const plain = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "").toLowerCase();
  return /[dmy]/.test(plain) && !/^general$/.test(plain) && !/^[#0.,%\s-]+$/.test(plain);
}

/** Excel serial day to YYYY-MM-DD (1900 or 1904 date system). */
export function excelSerialToDate(serial: number, date1904 = false): string {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(base + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}

const colIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** The cells of the first worksheet as text rows. */
export function readXlsx(data: Uint8Array, opts: { maxRows?: number } = {}): string[][] {
  const zip = unzip(data);
  const text = (name: string) => {
    const get = zip.get(name);
    return get ? new TextDecoder().decode(get()) : null;
  };
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new SpreadsheetError("No workbook found in the file");
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbook);
  const firstSheet = /<sheet\b([^>]*)\/?>/.exec(workbook)?.[1] ?? "";
  const rid = attr(firstSheet, "r:id");
  let sheetPath = "xl/worksheets/sheet1.xml";
  const rels = text("xl/_rels/workbook.xml.rels");
  if (rid && rels) {
    for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      if (attr(m[1]!, "Id") === rid) {
        const target = attr(m[1]!, "Target") ?? "";
        sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
      }
    }
  }
  const sheet = text(sheetPath);
  if (!sheet) throw new SpreadsheetError("The first worksheet is missing");

  const shared: string[] = [];
  const sst = text("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(runText(m[1]!));

  const dateStyles = new Set<number>();
  const styles = text("xl/styles.xml");
  if (styles) {
    const custom = new Map<number, string>();
    for (const m of styles.matchAll(/<numFmt\b([^>]*)\/?>/g)) custom.set(Number(attr(m[1]!, "numFmtId")), attr(m[1]!, "formatCode") ?? "");
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
    let i = 0;
    for (const m of xfs.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)) {
      const id = Number(attr(m[1]!, "numFmtId") ?? 0);
      if (BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))) dateStyles.add(i);
      i++;
    }
  }

  const rows: string[][] = [];
  const max = opts.maxRows ?? 50_000;
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    if (rows.length >= max) break;
    const rowNo = Number(attr(rm[1]!, "r") ?? rows.length + 1);
    const cells: string[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1]!;
      const body = cm[2] ?? "";
      const ref = attr(a, "r");
      const idx = ref ? colIndex(ref) : next;
      next = idx + 1;
      const type = attr(a, "t");
      const style = Number(attr(a, "s") ?? -1);
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = runText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (type === "str" || type === "e") value = v !== undefined ? decodeXml(v) : "";
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined) {
        const num = Number(v);
        value = dateStyles.has(style) && Number.isFinite(num) && num > 0 && num < 2_958_466 ? excelSerialToDate(num, date1904) : v;
      }
      cells[idx] = value;
    }
    // Keep the row position (blank rows in between are kept empty).
    while (rows.length < rowNo - 1) rows.push([]);
    rows.push(Array.from(cells, (c) => c ?? ""));
  }
  return rows;
}
