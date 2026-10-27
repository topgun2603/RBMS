/**
 * Bank statement import: reads CSV, Excel (.xlsx) and the HTML-table ".xls" files many Indian banks give, finds the
 * header row, maps the columns (date, narration, reference / cheque no., debit, credit or amount + Dr/Cr, balance)
 * for the usual HDFC, ICICI, SBI, Axis and Kotak layouts and any similar file, and turns the rows into statement
 * lines in paise with a stable hash for de-duplication. Pure functions: no database, no clock.
 *
 * Layouts are recognised by their column names, never by position, so a bank moving a column does not break it.
 * The names below are from commonly seen downloads and are assumptions, not verified against every bank's current
 * export. Binary .xls (BIFF), PDF and MT940 are not read: the owner saves the statement as .xlsx or CSV instead.
 */
import { createHash } from "node:crypto";
import { readXlsx, SpreadsheetError } from "./xlsx-lite";

export class BankImportError extends Error {}

export const BANK_FIELDS = ["date", "valueDate", "narration", "reference", "debit", "credit", "amount", "drcr", "balance"] as const;
export type BankField = (typeof BANK_FIELDS)[number];
/** Field -> column index in the header row. */
export type ColumnMapping = Partial<Record<BankField, number>>;

export const BANK_LAYOUTS = ["hdfc", "icici", "sbi", "axis", "kotak", "generic"] as const;
export type BankLayout = (typeof BANK_LAYOUTS)[number];

export interface ParsedBankLine {
  /** Row number in the file (1-based), for error messages. */
  row: number;
  date: string;
  valueDate: string | null;
  narration: string;
  reference: string | null;
  /** Paise, + money in (deposit / credit), - money out (withdrawal / debit). */
  amount: number;
  balance: number | null;
}

export interface ParseResult {
  layout: BankLayout;
  headerRow: number;
  headers: string[];
  mapping: ColumnMapping;
  lines: ParsedBankLine[];
  errors: { row: number; message: string }[];
  /** Footer / summary rows left out (opening balance, totals ...). */
  skipped: number;
  warnings: string[];
  from: string | null;
  to: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  /** The file listed the newest line first; lines are returned oldest first. */
  reversed: boolean;
}

// ------------------------------------------------------------------ reading the file

/** Text rows of a statement file: .xlsx, CSV/TSV/TXT, or an HTML table saved as .xls. */
export function readStatementFile(data: Uint8Array, fileName = ""): string[][] {
  if (data.length === 0) throw new BankImportError("The file is empty");
  if (data[0] === 0x50 && data[1] === 0x4b) {
    try {
      return readXlsx(data);
    } catch (err) {
      if (err instanceof SpreadsheetError) throw new BankImportError(err.message);
      throw err;
    }
  }
  if (data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0) {
    throw new BankImportError("This is an old binary Excel file (.xls). Open it in Excel and save it as .xlsx or CSV, then import that file.");
  }
  if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) {
    throw new BankImportError("PDF statements can't be read. Download the statement as Excel or CSV from your bank's website.");
  }
  let text = new TextDecoder("utf-8").decode(data);
  if ((text.match(/�/g)?.length ?? 0) > 3) text = new TextDecoder("latin1").decode(data);
  text = text.replace(/^﻿/, "");
  if (/^\s*</.test(text) && /<t[rd][\s>]/i.test(text)) return readHtmlTable(text);
  void fileName;
  return parseDelimited(text);
}

/** Rows of every <tr> in an HTML document (banks' "Excel" downloads that are really HTML). */
export function readHtmlTable(html: string): string[][] {
  const clean = (s: string) =>
    s
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
      .replace(/\s+/g, " ")
      .trim();
  const rows: string[][] = [];
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => clean(m[1]!));
    rows.push(cells);
  }
  return rows;
}

/** CSV / TSV / semicolon / pipe separated text, quotes as in RFC 4180. */
export function parseDelimited(text: string): string[][] {
  const sample = text.split(/\r?\n/).slice(0, 40);
  const score = (d: string) => sample.reduce((t, l) => t + (l.split(d).length - 1), 0);
  const delim = [",", "\t", ";", "|"].reduce((best, d) => (score(d) > score(best) ? d : best), ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delim) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

// ------------------------------------------------------------------ values

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

const iso = (y: number, m: number, d: number): string | null => {
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
};

/**
 * A statement date as YYYY-MM-DD. Numeric dates are read day first (dd/mm/yyyy, dd-mm-yy, dd.mm.yyyy), as Indian banks
 * print them, unless `order` is "mdy". Also: 2026-04-01, 01-Apr-2026, 1 Apr 2026, Apr 1, 2026 and Excel day numbers.
 */
export function parseBankDate(raw: string, order: "dmy" | "mdy" = "dmy"): string | null {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s.*)?$/.exec(s);
  if (m) return order === "mdy" ? iso(+m[3]!, +m[1]!, +m[2]!) : iso(+m[3]!, +m[2]!, +m[1]!);
  m = /^(\d{1,2})[\s/-]([A-Za-z]{3,9})[\s/,-]+(\d{2,4})(?:\s.*)?$/.exec(s);
  if (m) {
    const mon = MONTHS[m[2]!.toLowerCase().slice(0, m[2]!.toLowerCase().startsWith("sept") ? 4 : 3)];
    return mon ? iso(+m[3]!, mon, +m[1]!) : null;
  }
  m = /^([A-Za-z]{3,9})\s(\d{1,2}),?\s(\d{4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[1]!.toLowerCase().slice(0, 3)];
    return mon ? iso(+m[3]!, mon, +m[2]!) : null;
  }
  m = /^(\d{5})(?:\.\d+)?$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (n > 30_000 && n < 80_000) return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10);
  }
  return null;
}

/**
 * An amount in paise, exactly (no floating point): "1,23,456.78", "₹ 500", "500.00 Cr", "(250.00)", "-75", "1.5E3".
 * Returns null for an empty cell or a dash. A "Dr" suffix or brackets make it negative; "Cr" keeps it positive.
 */
export function parseBankAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s || /^[-–—]+$/.test(s) || /^n\/?a$/i.test(s)) return null;
  let sign = 1;
  const drcr = /\b(dr|cr)\.?$/i.exec(s);
  if (drcr) {
    if (drcr[1]!.toLowerCase() === "dr") sign = -1;
    s = s.slice(0, drcr.index).trim();
  }
  if (/^\(.*\)$/.test(s)) {
    sign = -sign;
    s = s.slice(1, -1);
  }
  s = s.replace(/₹|inr|rs\.?/gi, "").replace(/[,\s]/g, "");
  if (s.endsWith("-")) {
    sign = -sign;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    sign = -sign;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (/^\d+(\.\d+)?e[+-]?\d+$/i.test(s)) return sign * Math.round(Number(s) * 100);
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) return null;
  const rupees = Number(m[1] || "0");
  const frac = (m[2] ?? "").padEnd(3, "0");
  let paise = rupees * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) paise += 1;
  return sign * paise;
}

// ------------------------------------------------------------------ header detection

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(\s*(inr|rs\.?|₹)\s*\)|₹/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Column names per field (normalised: lower case, letters and digits only). Order matters: first match wins. */
const SYNONYMS: Record<BankField, string[]> = {
  valueDate: ["value date", "value dt", "valuedate", "value date of transaction"],
  date: ["date", "txn date", "transaction date", "tran date", "trans date", "posting date", "post date", "txn posted date", "date of transaction", "transaction posted date", "book date"],
  narration: ["narration", "description", "particulars", "transaction remarks", "remarks", "transaction details", "details", "transaction description", "transaction particulars", "narrative"],
  reference: [
    "chq ref no",
    "chq ref number",
    "chq no",
    "chqno",
    "cheque no",
    "cheque number",
    "cheque no ref no",
    "ref no cheque no",
    "ref no",
    "reference",
    "reference no",
    "ref number",
    "instrument no",
    "instrument id",
    "utr",
    "utr no",
    "transaction id",
    "tran id",
  ],
  debit: ["withdrawal amt", "withdrawal amount", "withdrawal", "withdrawals", "debit", "debit amount", "debits", "dr", "dr amount", "debit amt", "amount debited", "paid out", "money out"],
  credit: ["deposit amt", "deposit amount", "deposit", "deposits", "credit", "credit amount", "credits", "cr", "cr amount", "credit amt", "amount credited", "paid in", "money in"],
  amount: ["amount", "transaction amount", "txn amount", "amt"],
  drcr: ["dr cr", "cr dr", "drcr", "type", "debit credit", "transaction type", "txn type", "d c", "c d"],
  balance: ["closing balance", "balance", "running balance", "available balance", "bal", "balance amt", "closing bal"],
};

const FIELD_ORDER: BankField[] = ["valueDate", "date", "narration", "reference", "debit", "credit", "amount", "drcr", "balance"];

/** Maps the cells of one row to fields by their names; unknown cells are left out. */
export function mapHeader(cells: readonly string[]): ColumnMapping {
  const out: ColumnMapping = {};
  const used = new Set<number>();
  const names = cells.map(norm);
  const exactOwner = (n: string) => FIELD_ORDER.find((f) => SYNONYMS[f].includes(n));
  // Exact names first, then names that start with a synonym ("withdrawal amount inr").
  for (const pass of ["exact", "prefix"] as const) {
    for (const field of FIELD_ORDER) {
      if (out[field] !== undefined) continue;
      for (const syn of SYNONYMS[field]) {
        const idx = names.findIndex(
          (n, i) =>
            !used.has(i) &&
            n !== "" &&
            (pass === "exact" ? n === syn : (exactOwner(n) ?? field) === field && (n.startsWith(`${syn} `) || (syn.length >= 4 && n.startsWith(syn)))),
        );
        if (idx >= 0) {
          out[field] = idx;
          used.add(idx);
          break;
        }
      }
    }
  }
  // "Date" alone with only a value date column: use the value date as the date.
  if (out.date === undefined && out.valueDate !== undefined) {
    out.date = out.valueDate;
    delete out.valueDate;
  }
  return out;
}

const usable = (m: ColumnMapping) => m.date !== undefined && (m.debit !== undefined || m.credit !== undefined || m.amount !== undefined);

/** The header row (0-based) of the first 60 rows: the one that names a date and the money columns, most fields wins. */
export function findHeader(rows: readonly string[][]): { index: number; mapping: ColumnMapping } | null {
  let best: { index: number; mapping: ColumnMapping; score: number } | null = null;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const m = mapHeader(rows[i] ?? []);
    if (!usable(m)) continue;
    const score = Object.keys(m).length + (m.narration !== undefined ? 2 : 0);
    if (!best || score > best.score) best = { index: i, mapping: m, score };
  }
  return best ? { index: best.index, mapping: best.mapping } : null;
}

/** Which bank the file looks like (by the words above the table and the column names). Informational only. */
export function detectLayout(rows: readonly string[][], headerIndex: number): BankLayout {
  const top = rows
    .slice(0, Math.max(1, headerIndex + 1))
    .flat()
    .join(" ")
    .toLowerCase();
  if (/hdfc/.test(top)) return "hdfc";
  if (/icici/.test(top)) return "icici";
  if (/state bank|\bsbi\b/.test(top)) return "sbi";
  if (/axis/.test(top)) return "axis";
  if (/kotak/.test(top)) return "kotak";
  const h = (rows[headerIndex] ?? []).map(norm).join("|");
  if (/chq ref no/.test(h) && /withdrawal amt/.test(h)) return "hdfc";
  if (/transaction remarks/.test(h)) return "icici";
  if (/txn date/.test(h) && /branch code/.test(h)) return "sbi";
  if (/tran date/.test(h) && /particulars/.test(h)) return "axis";
  if (/(^|\|)sl no(\||$)/.test(h) && /dr cr/.test(h)) return "kotak";
  return "generic";
}

const FOOTER = /opening balance|closing balance|statement summary|total|grand total|brought forward|carried forward|b\/f|c\/f|end of statement|generated on|computer generated|this is a computer|page \d|\*{3,}|^-+$/i;
/** Rows after which the table has ended (summary blocks, disclaimers). */
const END = /statement summary|end of statement|computer generated|this is a computer|generated on|^\s*\*{3,}/i;
/** A cell that tries to be a date (so a wrong one is reported, not silently skipped). */
const looksLikeDate = (s: string) => /^\d{1,4}[/.\-\s][A-Za-z0-9]{1,9}[/.\-\s,]+\d{2,4}(?!\d)/.test(s.trim());

// ------------------------------------------------------------------ parsing

export interface ParseOptions {
  /** Column choices that replace the detected ones (field -> column index), and the header row (0-based). */
  mapping?: ColumnMapping;
  headerRow?: number;
  dateOrder?: "dmy" | "mdy";
  /** One "amount" column without Dr/Cr: negative numbers are withdrawals (default) or deposits. */
  negativeIs?: "withdrawal" | "deposit";
}

/** Rows to statement lines. Throws when no header row can be found. */
export function parseStatement(rows: readonly string[][], opts: ParseOptions = {}): ParseResult {
  const found = opts.headerRow !== undefined ? { index: opts.headerRow, mapping: mapHeader(rows[opts.headerRow] ?? []) } : findHeader(rows);
  if (!found) throw new BankImportError("Couldn't find the column headings (date, narration, withdrawal, deposit). Choose the columns yourself.");
  const mapping: ColumnMapping = { ...found.mapping, ...(opts.mapping ?? {}) };
  for (const [k, v] of Object.entries(mapping)) if (v === undefined || v === null || (v as number) < 0) delete mapping[k as BankField];
  if (!usable(mapping)) throw new BankImportError("Choose at least the date column and the withdrawal / deposit (or amount) columns.");
  const headers = (rows[found.index] ?? []).map((c) => c ?? "");
  const order = opts.dateOrder ?? "dmy";
  const cell = (r: readonly string[], f: BankField) => (mapping[f] !== undefined ? (r[mapping[f]!] ?? "").toString().trim() : "");

  const lines: ParsedBankLine[] = [];
  const errors: ParseResult["errors"] = [];
  const warnings: string[] = [];
  let skipped = 0;
  for (let i = found.index + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r.every((c) => !c || !c.toString().trim())) continue;
    const rawDate = cell(r, "date");
    const date = parseBankDate(rawDate, order);
    const joined = r.join(" ").trim();
    if (!date) {
      // A narration that runs onto the next row (no date, no money).
      const narr = cell(r, "narration");
      const money = cell(r, "debit") || cell(r, "credit") || cell(r, "amount");
      if (!rawDate && narr && !money && lines.length && !FOOTER.test(joined)) {
        lines[lines.length - 1]!.narration = `${lines[lines.length - 1]!.narration} ${narr}`.trim();
        continue;
      }
      if (lines.length && END.test(joined)) {
        skipped += rows.length - i;
        break;
      }
      if (!rawDate || FOOTER.test(joined) || !looksLikeDate(rawDate)) {
        skipped++;
        continue;
      }
      errors.push({ row: i + 1, message: `Date "${rawDate}" not understood` });
      continue;
    }
    let amount: number | null = null;
    if (mapping.debit !== undefined || mapping.credit !== undefined) {
      const dr = parseBankAmount(cell(r, "debit"));
      const cr = parseBankAmount(cell(r, "credit"));
      if (dr === null && cr === null && mapping.amount === undefined) {
        if (FOOTER.test(joined)) skipped++;
        else errors.push({ row: i + 1, message: "No withdrawal or deposit amount" });
        continue;
      }
      if (dr !== null || cr !== null) amount = Math.abs(cr ?? 0) - Math.abs(dr ?? 0);
    }
    if (amount === null && mapping.amount !== undefined) {
      const a = parseBankAmount(cell(r, "amount"));
      if (a === null) {
        errors.push({ row: i + 1, message: "No amount" });
        continue;
      }
      const t = cell(r, "drcr").toLowerCase();
      if (mapping.drcr !== undefined && t) {
        const isDebit = /^(dr|d|debit|withdrawal|w)\b/.test(t) || t === "dr.";
        amount = isDebit ? -Math.abs(a) : Math.abs(a);
      } else amount = opts.negativeIs === "deposit" ? -a : a;
    }
    if (amount === null) {
      errors.push({ row: i + 1, message: "No amount" });
      continue;
    }
    if (amount === 0) {
      skipped++;
      continue;
    }
    const balRaw = cell(r, "balance");
    let balance = parseBankAmount(balRaw);
    // Balance "Dr" after the amount column (Kotak): a second Dr/Cr cell right after the balance.
    if (balance !== null && mapping.balance !== undefined) {
      const after = (r[mapping.balance + 1] ?? "").toString().trim().toLowerCase();
      if ((after === "dr" || after === "dr.") && balance > 0 && mapping.balance + 1 !== mapping.drcr) balance = -balance;
    }
    const vd = cell(r, "valueDate");
    lines.push({
      row: i + 1,
      date,
      valueDate: vd ? parseBankDate(vd, order) : null,
      narration: cell(r, "narration").replace(/\s+/g, " "),
      reference: cleanRef(cell(r, "reference")),
      amount,
      balance,
    });
  }

  // Newest first in the file: put the oldest first.
  let reversed = false;
  if (lines.length > 1 && lines[0]!.date > lines[lines.length - 1]!.date) {
    lines.reverse();
    reversed = true;
  }
  // Running balance check: catches swapped debit / credit columns and misread amounts.
  const withBal = lines.filter((l) => l.balance !== null);
  if (withBal.length >= 3) {
    let bad = 0;
    let flipped = 0;
    for (let i = 1; i < lines.length; i++) {
      const prev = lines[i - 1]!.balance;
      const cur = lines[i]!.balance;
      if (prev === null || cur === null) continue;
      if (prev + lines[i]!.amount !== cur) bad++;
      if (prev - lines[i]!.amount === cur) flipped++;
    }
    if (bad > 0 && flipped >= bad && flipped > (lines.length - 1) / 2) warnings.push("The balance column moves the other way: the withdrawal and deposit columns may be swapped.");
    else if (bad > 0) warnings.push(`${bad} line(s) do not follow from the balance before them (lines on the same day may be in a different order in the file).`);
  }
  const first = lines[0];
  const last = lines[lines.length - 1];
  return {
    layout: detectLayout(rows, found.index),
    headerRow: found.index,
    headers,
    mapping,
    lines,
    errors,
    skipped,
    warnings,
    from: first?.date ?? null,
    to: last?.date ?? null,
    openingBalance: first && first.balance !== null ? first.balance - first.amount : null,
    closingBalance: last?.balance ?? null,
    reversed,
  };
}

/** A cheque / reference number as printed, without placeholders ("-", "0", "N/A" -> null). Matching ignores leading zeros. */
export function cleanRef(raw: string): string | null {
  const s = raw.trim();
  if (!s || /^[-–—0]+$/.test(s) || /^n\/?a$/i.test(s)) return null;
  return s;
}

const normText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Stable identity of each line: date, amount, reference and narration, plus the occurrence number of identical lines
 * in the same file (two Rs 500 UPI payments to the same person on one day are two lines). Importing the same or an
 * overlapping statement gives the same hashes, so nothing is added twice.
 */
export function lineHashes(lines: readonly Pick<ParsedBankLine, "date" | "amount" | "reference" | "narration">[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    // Leading zeros don't count ("004512" = "4512"), so a file read with or without them gives the same hash.
    const ref = normText(l.reference ?? "").replace(/^0+(?=\d)/, "");
    const base = `${l.date}|${l.amount}|${ref}|${normText(l.narration)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return createHash("sha256").update(`${base}|${n}`).digest("hex").slice(0, 32);
  });
}
