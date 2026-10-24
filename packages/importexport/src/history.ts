/**
 * Switching importers: parties (customers + suppliers with opening balances) and historical sale/purchase bills.
 * Everything here is pure (parsing, grouping rows into bills, totals); writing goes through ports the API kit
 * implements. Historical bills are stored as `imported` documents: no stock change, no messages, no e-invoice,
 * numbered with their original number outside the shop's own series.
 */
import { col, parseDecimal, parseMoney, stateName, type GstRate, type ImportColumn } from "./columns";
import type { RowValidator } from "./engine";
import type { CommitOptions, CommitResult, CommitRow, ImporterDef, ImportRecordRef } from "./registry";
import { validateParty } from "./specs";

// ------------------------------------------------------------------ small helpers

const round = Math.round;
export const nameKey = (n: string | null | undefined) => (n ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Indian financial year of a YYYY-MM-DD date: "2025-26". */
export function fyOf(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

export type PayMode = "cash" | "upi" | "card" | "bank" | "cheque" | "other";

/** "GPay", "NEFT", "Credit Card", "Cheque" → our payment mode. Unknown → other. */
export function parsePayMode(value: string): PayMode {
  const s = value.trim().toLowerCase();
  if (/^cash/.test(s)) return "cash";
  if (/upi|gpay|google ?pay|phone ?pe|paytm|bhim|qr/.test(s)) return "upi";
  if (/card|visa|master|rupay|pos machine/.test(s)) return "card";
  if (/cheque|check|chq/.test(s)) return "cheque";
  if (/bank|neft|rtgs|imps|net ?banking|transfer|online|wire|account/.test(s)) return "bank";
  return "other";
}

// ------------------------------------------------------------------ parties

export type PartyKind = "customer" | "supplier";

/** "Sundry Debtors" / "Customer" / "To Receive" → customer; "Sundry Creditors" / "Vendor" → supplier; both → "both". */
export function parsePartyType(value: string): "customer" | "supplier" | "both" {
  const s = value.trim().toLowerCase();
  const cust = /customer|debtor|buyer|client|receiv/.test(s);
  const supp = /supplier|creditor|vendor|seller|payable|distributor/.test(s);
  if (/\bboth\b|customer.*supplier|supplier.*customer/.test(s) || (cust && supp)) return "both";
  if (cust) return "customer";
  if (supp) return "supplier";
  throw new Error(`"${value}" should be Customer, Supplier or Both`);
}

export type BalanceSide = "receivable" | "payable";

/** "Dr", "To Receive", "Receivable" → receivable; "Cr", "To Pay", "Payable" → payable. */
export function parseBalanceSide(value: string): BalanceSide {
  const s = value.trim().toLowerCase();
  if (/^(dr|debit)|receiv|you.?ll get|to get/.test(s)) return "receivable";
  if (/^(cr|credit)|pay|you.?ll give|to give/.test(s)) return "payable";
  throw new Error(`"${value}" should be Dr/Cr, To Receive or To Pay`);
}

export interface MigratePartyRow {
  name: string;
  type?: "customer" | "supplier" | "both";
  phone?: string;
  email?: string;
  gstin?: string;
  address?: string;
  stateCode?: string;
  /** Signed amount as in the file (paise). */
  openingBalance?: number;
  balanceSide?: BalanceSide;
  receivable?: number;
  payable?: number;
  /** Paise. */
  creditLimit?: number;
  /** Date the balance is as of (YYYY-MM-DD). */
  openingDate?: string;
}

/**
 * The opening balance of one party as we store it: customers positive = they owe the shop (negative = advance);
 * suppliers positive = the shop owes them (negative = advance paid). Paise.
 */
export function resolveOpening(kind: PartyKind, r: Pick<MigratePartyRow, "openingBalance" | "balanceSide" | "receivable" | "payable" | "type">): number {
  const net = (receivable: number) => (kind === "customer" ? receivable : -receivable);
  if (r.receivable !== undefined || r.payable !== undefined) return net((r.receivable ?? 0) - (r.payable ?? 0));
  const a = r.openingBalance;
  if (a === undefined || a === 0) return 0;
  if (r.balanceSide) return net(r.balanceSide === "receivable" ? Math.abs(a) : -Math.abs(a));
  // No type and no side: the sign decided the kind (negative = a supplier the shop owes), so use the size.
  if (r.type === undefined && kind === "supplier" && a < 0) return -a;
  return a;
}

/** Which records a file row creates: its stated type, else by balance sign (negative with no type = supplier). */
export function partyKinds(r: Pick<MigratePartyRow, "type" | "openingBalance" | "balanceSide" | "receivable" | "payable">): PartyKind[] {
  if (r.type === "both") return ["customer", "supplier"];
  if (r.type) return [r.type];
  if (r.balanceSide === "payable") return ["supplier"];
  if (r.payable !== undefined && (r.receivable ?? 0) === 0 && r.payable > 0) return ["supplier"];
  if (r.balanceSide === undefined && r.receivable === undefined && (r.openingBalance ?? 0) < 0) return ["supplier"];
  return ["customer"];
}

export const migratePartyColumns: ImportColumn[] = [
  col.text("name", "Party name", { required: true, max: 200, example: "Murugan Stores", aliases: ["name", "party", "customer name", "supplier name", "ledger name", "account name", "particulars"] }),
  {
    ...col.text("type", "Party type", { example: "Customer", help: "Customer, Supplier or Both. Blank: decided by the balance (negative = supplier)", aliases: ["type", "group", "ledger group", "under", "party group"] }),
    parse: (v: string) => parsePartyType(v),
  } as ImportColumn,
  col.phone("phone", "Phone", { example: "98765 43210", aliases: ["mobile", "mobile no", "phone no", "contact no", "contact number", "phone number", "whatsapp"] }),
  col.email("email", "Email", { example: "murugan@example.com", aliases: ["email id", "e-mail"] }),
  col.gstin("gstin", "GSTIN", { example: "33AAACR5055K1ZE", aliases: ["gst number", "gst no", "gstin/uin", "gstin no", "party gstin", "gst"] }),
  col.text("address", "Address", { max: 1000, example: "5, Car Street, Madurai", aliases: ["billing address", "address 1", "address1"] }),
  col.state("state", "State", { example: "Tamil Nadu", aliases: ["place of supply", "state name"] }),
  col.money("opening_balance", "Opening balance", {
    allowNegative: true,
    example: "1,500.00",
    help: "Amount outstanding as on the switching date, in rupees. Use Balance side, or a negative number for the opposite side",
    aliases: ["balance", "closing balance", "outstanding", "current balance", "amount", "opening bal"],
  }),
  {
    ...col.text("balance_side", "Balance side", { example: "To Receive", help: "Dr / Cr, To Receive / To Pay", aliases: ["dr/cr", "dr cr", "balance type", "type of balance", "receivable/payable"] }),
    parse: (v: string) => parseBalanceSide(v),
  } as ImportColumn,
  col.money("receivable", "To receive", { allowNegative: false, aliases: ["receivable", "you will get", "amount receivable", "to get"] }),
  col.money("payable", "To pay", { allowNegative: false, aliases: ["payable", "you will give", "amount payable", "to give"] }),
  col.money("credit_limit", "Credit limit", { example: "10,000.00", aliases: ["limit"] }),
  col.date("opening_date", "Balance as of", { example: "2026-03-31", aliases: ["as of date", "opening date", "as on"] }),
];

export const validateMigrateParty: RowValidator<Record<string, unknown>> = (r) => validateParty(r);

export const toMigrateParty = (d: Record<string, unknown>): MigratePartyRow => ({
  name: d.name as string,
  type: d.type as MigratePartyRow["type"],
  phone: d.phone as string | undefined,
  email: d.email as string | undefined,
  gstin: d.gstin as string | undefined,
  address: d.address as string | undefined,
  stateCode: d.state as string | undefined,
  openingBalance: d.opening_balance as number | undefined,
  balanceSide: d.balance_side as BalanceSide | undefined,
  receivable: d.receivable as number | undefined,
  payable: d.payable as number | undefined,
  creditLimit: d.credit_limit as number | undefined,
  openingDate: d.opening_date as string | undefined,
});

/** One record to write: a file row expanded per party kind. */
export interface PartyTarget {
  row: number;
  kind: PartyKind;
  key: string;
  data: MigratePartyRow;
  /** Opening balance in our sign convention (see `resolveOpening`). */
  opening: number;
}

export function partyTargets(rows: CommitRow<MigratePartyRow>[]): PartyTarget[] {
  const out: PartyTarget[] = [];
  for (const r of rows) {
    for (const kind of partyKinds(r.data)) {
      out.push({ row: r.row, kind, key: partyKey(kind, r.data.name), data: r.data, opening: resolveOpening(kind, r.data) });
    }
  }
  return out;
}

export const partyKey = (kind: PartyKind, name: string) => `${kind}:${nameKey(name)}`;

export interface PartiesPort {
  save(tenantId: string, targets: PartyTarget[], opts: CommitOptions): Promise<CommitResult>;
}

export const MIGRATE_PARTIES_KEY = "migrate.parties";

export function migratePartiesImporter(port: PartiesPort, opts: { feature?: string; permission?: string } = {}): ImporterDef<Record<string, unknown>> {
  return {
    key: MIGRATE_PARTIES_KEY,
    label: "Parties (customers and suppliers)",
    feature: opts.feature ?? "invoices",
    permission: opts.permission,
    columns: migratePartyColumns,
    validate: validateMigrateParty,
    idempotent: { entity: "party", keys: (d) => partyTargets([{ row: 0, data: toMigrateParty(d) }]).map((t) => t.key) },
    commit: (tenantId, rows, o) => port.save(tenantId, partyTargets(rows.map((r) => ({ row: r.row, data: toMigrateParty(r.data) }))), o),
    batchSize: 200,
  };
}

// ------------------------------------------------------------------ historical bills

export type BillKind = "sale" | "purchase";

export interface BillLine {
  description: string;
  hsn?: string;
  qty: number;
  unit?: string;
  /** Paise per unit. */
  rate: number;
  discount: number;
  gstRate: GstRate;
  amount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  sku?: string;
  barcode?: string;
}

export interface TaxBreakupRow {
  gstRate: GstRate;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface HistoricalBill {
  kind: BillKind;
  /** The number on the original bill. */
  number: string;
  /** File rows that make up the bill. */
  rows: number[];
  date: string;
  dueDate?: string;
  party: { name: string; phone?: string; gstin?: string; stateCode?: string } | null;
  /** 2-digit state code of the place of supply. */
  placeOfSupply: string | null;
  interState: boolean;
  lines: BillLine[];
  subtotal: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  /** Paise received (sale) / paid (purchase) on the bill. */
  paid: number;
  payMode: PayMode;
  notes?: string;
  taxBreakup: TaxBreakupRow[];
  /** Messages worth showing (e.g. "No item detail: imported as one line"). */
  warnings: string[];
}

const GST_RATE_LIST = [0, 0.25, 3, 5, 12, 18, 28];

function snapRate(pct: number): number {
  let best = GST_RATE_LIST[0]!;
  for (const r of GST_RATE_LIST) if (Math.abs(r - pct) < Math.abs(best - pct)) best = r;
  return Math.abs(best - pct) <= 0.6 ? best : Math.round(pct * 100) / 100;
}

type D = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : undefined);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Column keys of a bill file (shared by sales and purchases). */
export const BILL_KEYS = [
  "invoice_no",
  "date",
  "due_date",
  "party",
  "party_gstin",
  "party_phone",
  "state",
  "item",
  "sku",
  "barcode",
  "hsn",
  "qty",
  "unit",
  "rate",
  "discount",
  "taxable",
  "gst_rate",
  "cgst",
  "sgst",
  "igst",
  "cess",
  "line_total",
  "invoice_total",
  "paid",
  "payment_mode",
  "tax_inclusive",
  "voucher_type",
  "notes",
] as const;

/** GSTIN as found in old data: 15 characters in the right shape; the check digit is not enforced. */
const looseGstin = (v: string) => {
  const g = v.replace(/\s+/g, "").toUpperCase();
  if (!/^\d{2}[A-Z0-9]{10}\d[A-Z0-9][A-Z0-9]$/.test(g)) throw new Error(`"${v}" is not a GSTIN`);
  return g;
};

export function billColumns(kind: BillKind): ImportColumn[] {
  const party = kind === "sale" ? "Customer" : "Supplier";
  return [
    col.text("invoice_no", kind === "sale" ? "Invoice no" : "Bill no", {
      required: true,
      max: 60,
      example: kind === "sale" ? "INV-0001" : "SUP/24-25/118",
      help: "The number on the original bill; kept as is",
      aliases: ["invoice no.", "invoice number", "invoice/ref no", "bill no", "bill number", "bill no.", "ref no", "ref no.", "voucher no", "voucher no.", "vch no", "vch no.", "doc no", "document no", "supplier invoice no", "inv no", "number"],
    }),
    col.date("date", "Date", { required: true, example: "2026-01-15", aliases: ["invoice date", "bill date", "voucher date", "vch date", "txn date", "transaction date"] }),
    col.date("due_date", "Due date", { example: "2026-02-14", aliases: ["due on", "payment due date"] }),
    col.text("party", `${party} name`, { max: 200, example: "Murugan Stores", aliases: ["party name", "party", "name", "customer", "customer name", "supplier", "supplier name", "particulars", "ledger", "account name", "buyer"] }),
    { ...col.text("party_gstin", `${party} GSTIN`, { example: "33AAACR5055K1ZE", aliases: ["gstin", "gstin/uin", "gst no", "gst number", "party gstin", "customer gstin", "supplier gstin", "gstin of recipient"] }), parse: looseGstin } as ImportColumn,
    col.phone("party_phone", `${party} phone`, { aliases: ["phone", "mobile", "contact no", "contact number", "phone no"] }),
    col.state("state", "Place of supply", { example: "Tamil Nadu", aliases: ["state", "state name", "pos", "place of supply (state)"] }),
    col.text("item", "Item", { max: 300, example: "Cotton Saree", aliases: ["item name", "product", "product name", "description", "item description", "stock item", "stock item name", "particulars of item"] }),
    col.text("sku", "Item code", { max: 64, aliases: ["sku", "item code", "code", "product code"] }),
    col.text("barcode", "Barcode", { max: 64, aliases: ["ean", "barcode no"] }),
    col.text("hsn", "HSN", { max: 12, example: "5208", aliases: ["hsn/sac", "hsn code", "hsn sac", "sac", "hsn/sac code"] }),
    col.decimal("qty", "Qty", { decimals: 3, example: "2", aliases: ["quantity", "billed qty", "actual qty", "qty."] }),
    col.text("unit", "Unit", { max: 16, example: "pcs", aliases: ["uom", "base unit", "unit of measure"] }),
    col.money("rate", "Rate", { example: "1,250.00", help: "Price per unit in rupees", aliases: ["price", "price/unit", "rate/price", "unit price", "sale price", "purchase price", "rate (per unit)", "rate per unit"] }),
    col.money("discount", "Discount", { example: "50.00", help: "Discount amount for the line, in rupees", aliases: ["discount amount", "disc", "disc amount", "disc.", "trade discount"] }),
    col.money("taxable", "Taxable value", { example: "2,450.00", aliases: ["taxable amount", "taxable", "net amount", "taxable val", "assessable value", "sales", "purchases", "sales accounts", "purchase accounts", "amount before tax"] }),
    col.decimal("gst_rate", "GST %", { decimals: 2, min: 0, max: 100, example: "5", aliases: ["gst", "gst rate", "tax %", "tax rate", "tax rate %", "gst%", "rate of tax", "tax percent"] }),
    col.money("cgst", "CGST", { aliases: ["cgst amount", "output cgst", "input cgst", "central tax", "cgst amt"] }),
    col.money("sgst", "SGST", { aliases: ["sgst amount", "output sgst", "input sgst", "state tax", "utgst", "sgst/utgst", "sgst amt"] }),
    col.money("igst", "IGST", { aliases: ["igst amount", "output igst", "input igst", "integrated tax", "igst amt"] }),
    col.money("cess", "Cess", { aliases: ["cess amount", "output cess", "input cess"] }),
    col.money("line_total", "Line total", { example: "2,572.50", aliases: ["amount", "total amount", "item total", "net total", "line amount", "item amount", "amount (incl tax)"] }),
    col.money("invoice_total", "Bill total", {
      example: "5,145.00",
      help: "Grand total of the bill (repeat on every row or fill once)",
      aliases: ["total", "grand total", "bill amount", "invoice amount", "invoice total", "gross total", "net amount payable", "total amount", "bill total", "inv amount", "net amt", "invoice value", "debit amount", "credit amount"],
    }),
    col.money("paid", "Paid", {
      example: "5,145.00",
      help: kind === "sale" ? "Amount received against the bill" : "Amount paid against the bill",
      aliases: ["received", "received amount", "received/paid", "paid amount", "amount paid", "amount received", "paid/received", "payment received", "amount paid/received", "advance"],
    }),
    col.text("payment_mode", "Payment mode", { max: 40, example: "Cash", aliases: ["payment type", "payment method", "mode of payment", "payment mode", "pay mode", "mode"] }),
    col.bool("tax_inclusive", "Rate includes GST", { aliases: ["inclusive of tax", "tax inclusive", "price includes tax", "inclusive"] }),
    col.text("voucher_type", "Transaction type", { max: 60, help: "Rows that are not sales/purchases (receipts, journals, returns) are ignored", aliases: ["voucher type", "vch type", "txn type", "transaction", "type", "document type"] }),
    col.text("notes", "Notes", { max: 500, aliases: ["narration", "remarks", "description of bill", "bill notes"] }),
  ];
}

export const validateBillRow: RowValidator<D> = (r) => {
  const errors: string[] = [];
  const detail = r.item !== undefined || r.qty !== undefined || r.rate !== undefined || r.taxable !== undefined || r.line_total !== undefined;
  const hasHeadMoney = r.invoice_total !== undefined;
  if (!detail && !hasHeadMoney) errors.push("Row has no amount (give Bill total, or Rate/Taxable value for the line)");
  return errors;
};

function mergeHead(rows: CommitRow<D>[], key: string): { value: unknown; conflict: boolean } {
  let value: unknown;
  let conflict = false;
  for (const r of rows) {
    const v = r.data[key];
    if (v === undefined) continue;
    if (value === undefined) value = v;
    else if (value !== v) conflict = true;
  }
  return { value, conflict };
}

export interface BillContext {
  /** The shop's 2-digit state code, when known. */
  sellerState?: string | null;
  kind: BillKind;
}

/** Turns the file rows of one bill into a `HistoricalBill`, or explains why not. */
export function buildBill(rows: CommitRow<D>[], ctx: BillContext): { bill?: HistoricalBill; error?: string } {
  const number = str(rows[0]!.data.invoice_no)!;
  const date = mergeHead(rows, "date");
  if (date.conflict) return { error: `Bill ${number} has different dates on its rows` };
  if (!date.value) return { error: `Bill ${number} has no date` };
  const partyName = mergeHead(rows, "party");
  if (partyName.conflict) return { error: `Bill ${number} has different party names on its rows` };
  const head = (k: string) => mergeHead(rows, k).value;
  const gstin = str(head("party_gstin"));
  const stateText = str(head("state")) ?? (gstin ? gstin.slice(0, 2) : undefined);
  const sellerState = ctx.sellerState ?? null;
  const posState = stateText ?? sellerState ?? null;
  const anyIgst = rows.some((r) => (num(r.data.igst) ?? 0) > 0);
  const anySplit = rows.some((r) => (num(r.data.cgst) ?? 0) > 0 || (num(r.data.sgst) ?? 0) > 0);
  const interState = anyIgst ? true : anySplit ? false : posState && sellerState ? posState !== sellerState : false;

  const warnings: string[] = [];
  const lines: BillLine[] = [];
  let summaryOnly = true;
  for (const r of rows) {
    const d = r.data;
    const isDetail = d.item !== undefined || d.qty !== undefined || d.rate !== undefined || d.taxable !== undefined || d.line_total !== undefined;
    if (!isDetail) continue;
    if (d.item !== undefined || d.qty !== undefined || d.rate !== undefined) summaryOnly = false;
    const qty = num(d.qty) ?? 1;
    const rate = num(d.rate);
    const discount = num(d.discount) ?? 0;
    let gst = num(d.gst_rate);
    const inclusive = d.tax_inclusive === true;
    const explicitTax = d.cgst !== undefined || d.sgst !== undefined || d.igst !== undefined;
    const lineTotal = num(d.line_total);
    let cgst = num(d.cgst) ?? 0;
    let sgst = num(d.sgst) ?? 0;
    let igst = num(d.igst) ?? 0;
    const taxSum = cgst + sgst + igst;

    let taxable: number;
    const amountGross = rate !== undefined ? round(qty * rate) : undefined;
    if (d.taxable !== undefined) taxable = d.taxable as number;
    else if (lineTotal !== undefined) {
      if (explicitTax) taxable = lineTotal - taxSum;
      else if (gst !== undefined) taxable = round((lineTotal * 100) / (100 + gst));
      else taxable = lineTotal;
    } else if (amountGross !== undefined) {
      const net = amountGross - discount;
      taxable = inclusive && gst ? round((net * 100) / (100 + gst)) : net;
    } else return { error: `Bill ${number}: a row has no amount` };
    if (taxable < 0) return { error: `Bill ${number}: negative taxable value` };

    if (explicitTax) {
      if (gst === undefined) gst = taxable > 0 ? snapRate(((taxSum * 100) / taxable)) : 0;
    } else {
      gst = gst ?? 0;
      const tax = round((taxable * gst) / 100);
      if (interState) igst = tax;
      else {
        cgst = Math.floor(tax / 2);
        sgst = tax - cgst;
      }
    }
    const unitRate = rate ?? (qty > 0 ? round((taxable + discount) / qty) : taxable + discount);
    lines.push({
      description: d.item !== undefined ? (d.item as string) : kindLabel(ctx.kind, "Imported bill (no item detail)"),
      hsn: str(d.hsn),
      qty,
      unit: str(d.unit),
      rate: unitRate,
      discount,
      gstRate: gst as GstRate,
      amount: amountGross ?? taxable + discount,
      taxable,
      cgst,
      sgst,
      igst,
      total: taxable + cgst + sgst + igst,
      sku: str(d.sku),
      barcode: str(d.barcode),
    });
    const cess = num(d.cess) ?? 0;
    if (cess > 0) {
      lines.push({ description: "Cess", qty: 1, rate: cess, discount: 0, gstRate: 0, amount: cess, taxable: cess, cgst: 0, sgst: 0, igst: 0, total: cess });
    }
  }
  const billTotal = num(head("invoice_total"));
  if (!lines.length) {
    if (billTotal === undefined) return { error: `Bill ${number} has no amount` };
    lines.push({
      description: kindLabel(ctx.kind, "Imported bill (no item detail)"),
      qty: 1,
      rate: billTotal,
      discount: 0,
      gstRate: 0,
      amount: billTotal,
      taxable: billTotal,
      cgst: 0,
      sgst: 0,
      igst: 0,
      total: billTotal,
    });
    warnings.push("No item detail in the file: imported as one line with the bill total");
  } else if (summaryOnly) warnings.push("No item detail in the file: imported as summary lines");

  const sum = (f: (l: BillLine) => number) => lines.reduce((s, l) => s + f(l), 0);
  const computed = sum((l) => l.total);
  let total = computed;
  let roundOff = 0;
  if (billTotal !== undefined) {
    const diff = billTotal - computed;
    if (Math.abs(diff) > 100) {
      return { error: `Bill ${number}: total ${(billTotal / 100).toFixed(2)} does not match its lines (${(computed / 100).toFixed(2)}); check the amounts or remove the Bill total column` };
    }
    roundOff = diff;
    total = billTotal;
  }
  const paidRaw = num(head("paid")) ?? 0;
  if (paidRaw > total + 100) return { error: `Bill ${number}: paid amount is more than the bill total` };
  const paid = Math.min(paidRaw, total);
  const breakup = new Map<number, TaxBreakupRow>();
  for (const l of lines) {
    const b = breakup.get(l.gstRate) ?? { gstRate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    b.taxable += l.taxable;
    b.cgst += l.cgst;
    b.sgst += l.sgst;
    b.igst += l.igst;
    breakup.set(l.gstRate, b);
  }
  const modeText = str(head("payment_mode"));
  const bill: HistoricalBill = {
    kind: ctx.kind,
    number,
    rows: rows.map((r) => r.row),
    date: date.value as string,
    dueDate: str(head("due_date")),
    party: partyName.value ? { name: partyName.value as string, phone: str(head("party_phone")), gstin, stateCode: stateText } : null,
    placeOfSupply: posState,
    interState,
    lines,
    subtotal: sum((l) => l.amount),
    discount: sum((l) => l.discount),
    taxable: sum((l) => l.taxable),
    cgst: sum((l) => l.cgst),
    sgst: sum((l) => l.sgst),
    igst: sum((l) => l.igst),
    roundOff,
    total,
    paid,
    payMode: modeText ? parsePayMode(modeText) : "cash",
    notes: str(head("notes")),
    taxBreakup: [...breakup.values()],
    warnings,
  };
  return { bill };
}

const kindLabel = (kind: BillKind, text: string) => (kind === "sale" ? text : text);

/** Groups parsed rows by bill number (first appearance order). */
export function groupBills(rows: CommitRow<D>[]): CommitRow<D>[][] {
  const groups = new Map<string, CommitRow<D>[]>();
  for (const r of rows) {
    const k = billGroupKey(r.data);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  return [...groups.values()];
}

export const billGroupKey = (d: D) => String(d.invoice_no ?? "").trim().toLowerCase();

/** Bill key for idempotency: financial year + number, so INV-1 of two years are different bills. */
export const billKey = (kind: BillKind, d: D) => `${kind}:${typeof d.date === "string" ? fyOf(d.date) : "?"}|${billGroupKey(d)}`;

export interface BillsPort {
  /** Seller state code etc. */
  context(tenantId: string): Promise<{ sellerState: string | null }>;
  /** Saves bills; one result per bill (by number). Must not touch stock, send messages or e-invoice. */
  save(tenantId: string, bills: HistoricalBill[], opts: CommitOptions): Promise<{ number: string; ok: boolean; error?: string; records: ImportRecordRef[] }[]>;
}

export const HISTORY_SALES_KEY = "history.sales";
export const HISTORY_PURCHASES_KEY = "history.purchases";

/** Voucher/transaction type text → is it a bill of this kind? Empty = yes. */
export function voucherMatches(kind: BillKind, value: string): boolean {
  const s = value.trim().toLowerCase();
  if (!s) return true;
  if (/return|credit note|debit note|order|quotation|estimate|challan|receipt|payment|journal|contra|proforma|expense|delivery/.test(s)) return false;
  return kind === "sale" ? /sale|sales|invoice|tax invoice|retail|b2b|b2c/.test(s) : /purchase|bill|buy|inward/.test(s);
}

export function billImporter(kind: BillKind, port: BillsPort, opts: { feature?: string; permission?: string } = {}): ImporterDef<Record<string, unknown>> {
  return {
    key: kind === "sale" ? HISTORY_SALES_KEY : HISTORY_PURCHASES_KEY,
    label: kind === "sale" ? "Past sales bills (history)" : "Past purchase bills (history)",
    feature: opts.feature ?? (kind === "sale" ? "invoices" : "inventory.purchases"),
    permission: opts.permission,
    columns: billColumns(kind),
    validate: validateBillRow,
    maxRows: 60_000,
    batchSize: 150,
    groupKey: billGroupKey,
    prepare: (headers, data) => dropForeignVouchers(kind, headers, data),
    validateSet: (parsed) => {
      // Row-level problems of a whole bill are reported on all its rows.
      const byBill = new Map<string, typeof parsed>();
      for (const p of parsed) {
        if (p.errors.length) continue;
        const k = billGroupKey(p.data as D);
        byBill.set(k, [...(byBill.get(k) ?? []), p]);
      }
      for (const group of byBill.values()) {
        const built = buildBill(group.map((p) => ({ row: p.row, data: p.data as D })), { kind });
        if (built.error) for (const p of group) p.errors.push(built.error);
      }
    },
    idempotent: { entity: kind, keys: (d) => [billKey(kind, d)] },
    commit: async (tenantId, rows, o) => {
      const result: Required<CommitResult> = { created: 0, updated: 0, errors: [], records: [] };
      const ctx = await port.context(tenantId);
      const bills: HistoricalBill[] = [];
      for (const g of groupBills(rows)) {
        const built = buildBill(g, { kind, sellerState: ctx.sellerState });
        if (built.error || !built.bill) for (const r of g) result.errors.push({ row: r.row, message: built.error ?? "Could not read this bill" });
        else bills.push(built.bill);
      }
      if (!bills.length) return result;
      const saved = await port.save(tenantId, bills, o);
      for (let i = 0; i < saved.length; i++) {
        const s = saved[i]!;
        const bill = bills[i]!;
        if (s.ok) {
          result.created += 1;
          result.records.push(...s.records);
        } else for (const row of bill.rows) result.errors.push({ row, message: s.error ?? "Could not save this bill" });
      }
      return result;
    },
  };
}

/** Removes rows whose transaction type says they are not bills of this kind (receipts, journals, returns...). */
export function dropForeignVouchers(kind: BillKind, headers: string[], data: string[][]): { headers: string[]; data: string[][]; ignored: number } {
  const norm = headers.map((h) => h.toLowerCase().replace(/[^a-z]+/g, ""));
  const idx = norm.findIndex((h) => ["vouchertype", "vchtype", "txntype", "transactiontype", "documenttype", "type"].includes(h));
  if (idx < 0) return { headers, data, ignored: 0 };
  const keep = data.filter((r) => voucherMatches(kind, r[idx] ?? ""));
  return { headers, data: keep, ignored: data.length - keep.length };
}

export { parseDecimal, parseMoney, stateName };
