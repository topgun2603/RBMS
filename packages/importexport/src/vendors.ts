/**
 * Source-software profiles ("mappers") for people switching to us: Vyapar, Tally, Busy, Marg and generic Excel.
 *
 * Each profile adds header aliases per column key on top of the importer's own, and a fingerprint used to guess the
 * source from a file's headers. The exact export layouts of these products are NOT published as specifications, so
 * every profile is tolerant (case, spaces, punctuation and "(₹)" suffixes are ignored; title rows above the header are
 * skipped) and the wizard always offers a manual column mapping. `verified` records how sure we are:
 *  - "documented": the layout was confirmed from the vendor's own documentation or a real export we have seen
 *  - "assumed": built from commonly seen export column names; confirm with a real export before relying on it
 */
import type { ImportColumn } from "./columns";
import { autoMap, normalizeHeader } from "./engine";

export const VENDOR_IDS = ["generic", "vyapar", "tally", "busy", "marg"] as const;
export type VendorId = (typeof VENDOR_IDS)[number];

export interface VendorProfile {
  id: VendorId;
  label: string;
  labelTa: string;
  verified: "documented" | "assumed";
  /** What to export from this software, per importer key (shown in the wizard and docs/importing.md). */
  exports: Record<string, string>;
  /** File formats we read for this source. */
  formats: string[];
  /** column key → extra header spellings. */
  aliases: Record<string, string[]>;
  /** Normalised header names that strongly suggest this source. */
  fingerprint: string[];
  notes: string;
}

export const VENDORS: VendorProfile[] = [
  {
    id: "generic",
    label: "Excel / CSV (any software)",
    labelTa: "எக்செல் / CSV (எந்த மென்பொருளும்)",
    verified: "documented",
    formats: ["xlsx", "csv"],
    exports: {},
    aliases: {},
    fingerprint: [],
    notes: "Use our template, or any sheet with a header row; map the columns yourself in the next step.",
  },
  {
    id: "vyapar",
    label: "Vyapar",
    labelTa: "வியாபார் (Vyapar)",
    verified: "assumed",
    formats: ["xlsx", "csv"],
    exports: {
      "catalog.products": "Items: Items tab, Excel export (Item name, Item code, HSN, Sale price, Purchase price, Opening stock, Tax rate ...)",
      "migrate.parties": "Parties: Parties tab, Excel export (Party name, Phone, GSTIN, State, Opening balance ...)",
      "history.sales": "Reports > Sale report > Export to Excel (item-wise / GST report gives lines)",
      "history.purchases": "Reports > Purchase report > Export to Excel",
    },
    aliases: {
      name: ["item name", "party name", "name"],
      sku: ["item code", "item sku"],
      barcode: ["item barcode", "barcode"],
      category: ["item category", "category name", "category"],
      hsn: ["hsn/sac", "hsn code"],
      gst: ["tax rate", "gst rate", "tax %", "sales tax rate"],
      unit: ["base unit", "unit"],
      price: ["sale price", "sales price", "selling price"],
      cost: ["purchase price", "purchase rate"],
      mrp: ["mrp", "max retail price"],
      tax_inclusive: ["inclusive of tax", "sale price inclusive of tax", "inclusive of tax (sale)"],
      opening_stock: ["opening stock", "opening stock quantity", "current stock quantity", "stock quantity", "current stock"],
      phone: ["phone no.", "phone number", "contact number", "mobile number"],
      email: ["email id", "email"],
      address: ["billing address", "address"],
      opening_balance: ["opening balance", "balance", "party balance", "current balance"],
      balance_side: ["balance type", "to receive/to pay"],
      credit_limit: ["credit limit"],
      invoice_no: ["invoice no.", "invoice no", "ref no.", "invoice/ref no.", "bill no."],
      party: ["party name", "party"],
      paid: ["received/paid", "received", "paid"],
      payment_mode: ["payment type"],
      invoice_total: ["total", "total amount", "invoice amount"],
      voucher_type: ["transaction type", "type"],
    },
    fingerprint: ["itemname", "itemcode", "partyname", "receivedpaid", "paymenttype", "transactiontype", "invoiceno", "baseunit", "saleprice", "purchaseprice"],
    notes: "Vyapar reports often have a title block above the header row; that is skipped automatically.",
  },
  {
    id: "tally",
    label: "Tally (Prime / ERP 9)",
    labelTa: "டேலி (Tally)",
    verified: "assumed",
    formats: ["xml", "xlsx", "csv"],
    exports: {
      "migrate.parties": "Masters: Export > Masters > Ledgers (XML), or Display > List of Accounts > Excel. Debtors/creditors with opening balances",
      "catalog.products": "Masters: Export > Masters > Stock Items (XML), or Stock Summary > Excel",
      "history.sales": "Vouchers: Export > Vouchers > Sales (XML, 'Voucher' type with items), or Display > Sales Register > Excel",
      "history.purchases": "Vouchers: Export > Vouchers > Purchase (XML), or Display > Purchase Register > Excel",
    },
    aliases: {
      name: ["name", "particulars", "stock item", "ledger", "ledger name"],
      type: ["under", "parent", "group"],
      category: ["parent", "under", "stock group"],
      hsn: ["hsn/sac", "hsn code", "hsn/sac details"],
      gst: ["gst rate", "igst rate", "rate of tax"],
      unit: ["base units", "baseunits", "unit"],
      cost: ["rate", "opening rate", "standard cost"],
      opening_stock: ["quantity", "opening quantity", "closing quantity", "opening balance qty"],
      address: ["address", "mailing address"],
      state: ["state", "state name"],
      gstin: ["gstin/uin", "gst registration number", "partygstin", "party gstin"],
      opening_balance: ["opening balance", "closing balance", "balance"],
      balance_side: ["dr/cr"],
      invoice_no: ["voucher no.", "vch no.", "voucher number", "supplier invoice no."],
      party: ["particulars", "party name", "party ledger", "ledger"],
      voucher_type: ["voucher type", "vch type"],
      invoice_total: ["gross total", "debit amount", "credit amount", "debit", "credit", "value"],
      taxable: ["sales", "purchases", "sales accounts", "purchase accounts", "taxable value"],
      cgst: ["output cgst", "input cgst", "cgst"],
      sgst: ["output sgst", "input sgst", "sgst/utgst", "output sgst/utgst", "input sgst/utgst"],
      igst: ["output igst", "input igst", "igst"],
      notes: ["narration"],
    },
    fingerprint: ["particulars", "vouchertype", "voucherno", "grosstotal", "debitamount", "creditamount", "outputcgst", "inputcgst", "undergroup"],
    notes: "XML (UTF-8 or UTF-16) is read directly. Excel registers are read as summary bills unless item detail columns are present.",
  },
  {
    id: "busy",
    label: "Busy",
    labelTa: "பிசி (Busy)",
    verified: "assumed",
    formats: ["xlsx", "csv"],
    exports: {
      "catalog.products": "Masters > Item > List, then export to Excel (Item name, Group, Unit, Sale price, Purchase price, MRP, HSN, opening qty)",
      "migrate.parties": "Masters > Account > List, then export to Excel (Name, Group, Opening balance with Dr/Cr, Address, GSTIN, Mobile)",
      "history.sales": "Display > Sales > Sales Register (item-wise) > Export to Excel",
      "history.purchases": "Display > Purchase > Purchase Register (item-wise) > Export to Excel",
    },
    aliases: {
      name: ["item name", "print name", "account name", "name"],
      sku: ["alias", "item alias", "code"],
      category: ["item group", "group", "under group"],
      type: ["group", "under group", "account group"],
      hsn: ["hsn code", "hsn/sac code"],
      unit: ["main unit", "unit", "uom"],
      price: ["sale price", "s. price", "sales price", "selling price", "sale rate"],
      cost: ["purchase price", "p. price", "purchase rate"],
      mrp: ["mrp"],
      opening_stock: ["opening balance (qty)", "opening qty", "opening stock", "op. qty", "op qty"],
      opening_balance: ["opening balance", "op. balance", "op balance", "balance"],
      balance_side: ["dr/cr", "dr / cr", "debit/credit"],
      phone: ["mobile", "mobile no", "telephone", "phone"],
      address: ["address1", "address 1", "address"],
      gstin: ["gstin", "gst no", "gstin/uin"],
      invoice_no: ["vch/bill no", "vch/bill no.", "voucher no", "bill no", "vch no", "series/vch no"],
      party: ["particulars", "party", "party name", "account"],
      qty: ["qty", "qty.", "quantity"],
      rate: ["price", "rate", "rate/price"],
      line_total: ["amount", "item amount"],
      invoice_total: ["bill amount", "net amount", "total", "bill amt"],
      taxable: ["taxable amount", "taxable value", "assessable value"],
    },
    fingerprint: ["vchbillno", "vchno", "printname", "itemgroup", "mainunit", "billamount", "seriesvchno", "opbalance", "opqty"],
    notes: "Use the item-wise register for line detail; the plain register imports as summary bills.",
  },
  {
    id: "marg",
    label: "Marg ERP",
    labelTa: "மார்க் (Marg ERP)",
    verified: "assumed",
    formats: ["xlsx", "csv"],
    exports: {
      "catalog.products": "Master > Product/Item list > Export to Excel (Product name, Company, Pack, MRP, Rate, HSN, GST %, opening qty). Batch and expiry columns are read and kept in the stock note",
      "migrate.parties": "Master > Account/Party list > Export (Party name, Address, City, Mobile, GSTIN, Balance)",
      "history.sales": "Reports > Sales register / Sale bill details > Export to Excel",
      "history.purchases": "Reports > Purchase register / Purchase bill details > Export to Excel",
    },
    aliases: {
      name: ["product name", "item name", "party name", "name of party", "name"],
      sku: ["item code", "product code", "code"],
      category: ["company", "group", "category"],
      brand: ["company", "mfr", "manufacturer"],
      hsn: ["hsn", "hsn code"],
      gst: ["gst %", "gst%", "tax %", "gst rate"],
      unit: ["pack", "unit", "uom"],
      price: ["rate", "sale rate", "s. rate", "srate"],
      cost: ["purchase rate", "p. rate", "prate", "pur rate"],
      mrp: ["mrp", "m.r.p."],
      opening_stock: ["stock", "closing stock", "qty", "opening qty", "balance qty"],
      batch_no: ["batch", "batch no", "batch no."],
      expiry: ["exp", "expiry", "exp date", "expiry date", "exp."],
      phone: ["mobile", "mobile no", "phone", "tel"],
      address: ["address", "address 1", "city"],
      gstin: ["gstin", "gst no", "gst no."],
      opening_balance: ["balance", "outstanding", "closing balance", "opening balance"],
      balance_side: ["dr/cr", "cr/dr"],
      invoice_no: ["bill no", "bill no.", "vch no", "invoice no", "inv no"],
      party: ["party", "party name", "name of party", "customer", "supplier"],
      invoice_total: ["net amt", "net amount", "bill amt", "bill amount", "amount", "net"],
      qty: ["qty", "quantity", "sale qty", "pur qty"],
      rate: ["rate"],
      line_total: ["amount", "item amt"],
    },
    fingerprint: ["productname", "nameofparty", "netamt", "batch", "exp", "pack", "mrp", "billamt"],
    notes: "Marg exports vary by edition and report; map any column the automatic step misses.",
  },
];

export const vendorById = (id: string): VendorProfile | undefined => VENDORS.find((v) => v.id === id);

/** Importer columns with the vendor's extra aliases added (the vendor's spelling comes first). */
export function withVendor(columns: readonly ImportColumn[], vendor: VendorId | undefined): ImportColumn[] {
  const v = vendor ? vendorById(vendor) : undefined;
  if (!v) return [...columns];
  return columns.map((c) => ({ ...c, aliases: [...(v.aliases[c.key] ?? []), ...(c.aliases ?? [])] }));
}

/** Best guess at the source software from a file's headers (null when nothing stands out). */
export function detectVendor(headers: readonly string[]): VendorId | null {
  const norm = new Set(headers.map(normalizeHeader).filter(Boolean));
  let best: VendorId | null = null;
  let bestScore = 1; // need at least two fingerprint hits
  for (const v of VENDORS) {
    const score = v.fingerprint.filter((f) => norm.has(f)).length;
    if (score > bestScore) {
      best = v.id;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Finds the header row of a sheet that has title lines above it (company name, report name, date range ...):
 * the row within the first 40 that matches the most column names/aliases. Falls back to row 0.
 */
export function findHeaderRow(table: readonly (readonly string[])[], columns: readonly ImportColumn[]): number {
  let best = 0;
  let bestScore = 0;
  const limit = Math.min(table.length, 40);
  for (let i = 0; i < limit; i++) {
    const row = table[i]!;
    if (row.filter((c) => c.trim()).length < 2) continue;
    const { mapping } = autoMap(row, columns);
    const score = Object.values(mapping).filter((v) => v !== null).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : 0;
}

/** Rows that are report totals or footers rather than data. */
export function isFooterRow(cells: readonly string[]): boolean {
  const first = cells.find((c) => c.trim() !== "")?.trim().toLowerCase().replace(/[:.]+$/, "") ?? "";
  return /^(grand total|total|totals|sub total|subtotal|closing balance|opening balance|report total)$/.test(first);
}
