/**
 * Tally support.
 *  - Reading: Tally XML exports (masters: LEDGER, STOCKITEM; transactions: VOUCHER) are converted into the same flat
 *    table the Excel/CSV path produces, so the normal preview, mapping and validation apply.
 *  - Writing: sales/purchase vouchers as Tally import XML (TALLYMESSAGE / VOUCHER).
 *
 * The XML tag names below are the ones Tally documents for its XML integration (VOUCHER, VOUCHERTYPENAME,
 * VOUCHERNUMBER, PARTYLEDGERNAME, ALLLEDGERENTRIES.LIST, ALLINVENTORYENTRIES.LIST, LEDGER, STOCKITEM ...). Where
 * Prime and ERP 9 differ we accept both (LEDGERENTRIES.LIST / INVENTORYENTRIES.LIST). Not verified against a live
 * Tally in this repo: see docs/importing.md.
 */
import { stateName } from "./columns";
import { HISTORY_PURCHASES_KEY, HISTORY_SALES_KEY, MIGRATE_PARTIES_KEY, type BillKind } from "./history";
import { childText, decodeXmlBytes, deepText, escapeXml, findAll, kids, parseXml, type XmlNode } from "./xml";

export interface Table {
  headers: string[];
  data: string[][];
}

const abs = (n: number) => Math.abs(n);
/** "1,234.50", "-500.00", "10 Nos", "5.000 Kgs = 5000 Gms" → first number. */
export function tallyNumber(text: string): number {
  const m = /-?\d[\d,]*(\.\d+)?|-?\.\d+/.exec(text.replace(/\s/g, " "));
  return m ? Number(m[0].replace(/,/g, "")) : 0;
}
const unitOf = (text: string) => /[A-Za-z]+/.exec(text.replace(/^[\s\d.,-]+/, ""))?.[0] ?? "";
/** Tally dates are YYYYMMDD. */
export function tallyDate(text: string): string {
  const t = text.trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return t;
}
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

function nameOf(n: XmlNode): string {
  return n.attrs.NAME?.trim() || deepText(n, "NAME") || childText(n, "LANGUAGENAME") || "";
}

// ------------------------------------------------------------------ masters

export function tallyPartiesTable(root: XmlNode): Table {
  const headers = ["Party name", "Party type", "Phone", "Email", "GSTIN", "Address", "State", "Opening balance", "Balance side"];
  const data: string[][] = [];
  for (const l of findAll(root, "LEDGER")) {
    const parent = childText(l, "PARENT");
    const gstin = childText(l, "PARTYGSTIN", "GSTIN") || deepText(l, "PARTYGSTIN");
    const isDebtor = /debtor/i.test(parent);
    const isCreditor = /creditor/i.test(parent);
    if (!isDebtor && !isCreditor && !gstin) continue; // cash, bank, expense and tax ledgers are not parties
    const name = nameOf(l);
    if (!name) continue;
    const address = kids(l.children.find((c) => c.tag === "LEDMAILINGDETAILS.LIST") ?? { tag: "", attrs: {}, children: [], text: "" }, "ADDRESS.LIST")
      .flatMap((a) => kids(a, "ADDRESS").map((x) => x.text.trim()))
      .filter(Boolean)
      .join(", ") || findAll(l, "ADDRESS").map((x) => x.text.trim()).filter(Boolean).join(", ");
    const state = deepText(l, "LEDSTATENAME", "STATENAME", "PLACEOFSUPPLY");
    // Tally stores debit balances as negative numbers in exports.
    const ob = tallyNumber(childText(l, "OPENINGBALANCE"));
    const side = ob === 0 ? "" : ob < 0 ? "Dr" : "Cr";
    data.push([
      name,
      isCreditor ? "Supplier" : isDebtor ? "Customer" : "",
      childText(l, "LEDGERMOBILE", "LEDGERPHONE", "PHONENUMBER") || deepText(l, "LEDGERMOBILE", "LEDGERPHONE"),
      childText(l, "EMAIL") || deepText(l, "EMAIL"),
      gstin,
      address,
      state,
      ob === 0 ? "" : money(abs(ob)),
      side,
    ]);
  }
  return { headers, data };
}

export function tallyItemsTable(root: XmlNode): Table {
  const headers = ["Name", "Category", "Unit", "HSN", "GST %", "Price", "Cost", "Opening stock"];
  const data: string[][] = [];
  for (const it of findAll(root, "STOCKITEM")) {
    const name = nameOf(it);
    if (!name) continue;
    const qtyText = childText(it, "OPENINGBALANCE");
    const qty = tallyNumber(qtyText);
    const value = abs(tallyNumber(childText(it, "OPENINGVALUE")));
    const rateText = childText(it, "OPENINGRATE");
    const cost = rateText ? abs(tallyNumber(rateText)) : qty > 0 ? value / qty : 0;
    const hsn = deepText(it, "HSNCODE", "HSN");
    // GST rate: IGST rate of the latest rate detail, else twice the CGST rate.
    let gst = 0;
    for (const rd of findAll(it, "RATEDETAILS.LIST")) {
      const head = childText(rd, "GSTRATEDUTYHEAD");
      const rate = tallyNumber(childText(rd, "GSTRATE"));
      if (/integrated/i.test(head) && rate) gst = rate;
      else if (/central/i.test(head) && rate && !gst) gst = rate * 2;
    }
    if (!gst) gst = tallyNumber(deepText(it, "GSTRATE"));
    const sale = deepText(it, "STANDARDPRICE") ? abs(tallyNumber(findAll(it, "RATE")[0]?.text ?? "")) : 0;
    const unit = childText(it, "BASEUNITS") || unitOf(qtyText);
    data.push([name, childText(it, "PARENT"), unit, hsn, gst ? String(gst) : "", money(sale || cost), cost ? money(cost) : "", qty ? String(qty) : ""]);
  }
  return { headers, data };
}

// ------------------------------------------------------------------ vouchers

const BILL_HEADERS = [
  "Invoice no",
  "Date",
  "Customer name",
  "Customer GSTIN",
  "Place of supply",
  "Item",
  "HSN",
  "Qty",
  "Unit",
  "Rate",
  "Discount",
  "Taxable value",
  "GST %",
  "CGST",
  "SGST",
  "IGST",
  "Cess",
  "Bill total",
  "Notes",
];

const GST_SLABS = [0, 0.25, 3, 5, 12, 18, 28];
const snap = (p: number) => GST_SLABS.reduce((b, r) => (Math.abs(r - p) < Math.abs(b - p) ? r : b), 0);

export function tallyVouchersTable(root: XmlNode, kind: BillKind): Table {
  const data: string[][] = [];
  for (const v of findAll(root, "VOUCHER")) {
    const type = v.attrs.VCHTYPE || childText(v, "VOUCHERTYPENAME");
    const t = type.toLowerCase();
    if (kind === "sale" ? !/sales/.test(t) || /order|return|credit/.test(t) : !/purchase/.test(t) || /order|return|debit/.test(t)) continue;
    if (/^yes$/i.test(childText(v, "ISCANCELLED")) || /^yes$/i.test(childText(v, "ISOPTIONAL"))) continue;
    const number = childText(v, "VOUCHERNUMBER") || childText(v, "REFERENCE");
    const date = tallyDate(childText(v, "DATE"));
    const party = childText(v, "PARTYLEDGERNAME") || childText(v, "PARTYNAME");
    const gstin = childText(v, "PARTYGSTIN");
    const pos = childText(v, "PLACEOFSUPPLY") || childText(v, "STATENAME");
    const narration = childText(v, "NARRATION");
    const ledgerEntries = [...kids(v, "ALLLEDGERENTRIES.LIST"), ...kids(v, "LEDGERENTRIES.LIST")];
    const invEntries = [...kids(v, "ALLINVENTORYENTRIES.LIST"), ...kids(v, "INVENTORYENTRIES.LIST")];

    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    let cess = 0;
    let roundOff = 0;
    let total = 0;
    let other = 0;
    const otherNames: string[] = [];
    for (const le of ledgerEntries) {
      const lname = childText(le, "LEDGERNAME");
      const amt = tallyNumber(childText(le, "AMOUNT"));
      if (/^yes$/i.test(childText(le, "ISPARTYLEDGER")) || (party && lname === party)) {
        total = abs(amt);
      } else if (/cgst|central tax/i.test(lname)) cgst += abs(amt);
      else if (/sgst|utgst|state tax/i.test(lname)) sgst += abs(amt);
      else if (/igst|integrated/i.test(lname)) igst += abs(amt);
      else if (/cess/i.test(lname)) cess += abs(amt);
      else if (/round/i.test(lname)) {
        // Round-off direction relative to the party amount sign: keep signed share of the total.
        roundOff += kind === "sale" ? -amt : amt;
      } else if (invEntries.length === 0) {
        // Accounting voucher: the sales/purchase ledger is the taxable value.
        other += abs(amt);
        otherNames.push(lname);
      } else {
        // Item invoice: remaining ledgers are charges (freight, packing) or discounts.
        other += kind === "sale" ? -amt : amt;
        otherNames.push(lname);
      }
    }
    const base = { number, date, party, gstin, pos, narration };
    if (invEntries.length === 0) {
      data.push([number, date, party, gstin, pos, "", "", "", "", "", "", money(other), "", money(cgst), money(sgst), money(igst), money(cess), total ? money(total) : "", narration]);
      continue;
    }
    const lines = invEntries.map((ie) => {
      const qtyText = childText(ie, "BILLEDQTY") || childText(ie, "ACTUALQTY");
      const qty = abs(tallyNumber(qtyText));
      const rateText = childText(ie, "RATE");
      const rate = abs(tallyNumber(rateText));
      const amount = abs(tallyNumber(childText(ie, "AMOUNT")));
      const gross = qty * rate;
      const hsn = deepText(ie, "HSNCODE", "HSN");
      return { name: childText(ie, "STOCKITEMNAME"), qty, unit: unitOf(qtyText) || unitOf(rateText.split("/")[1] ?? ""), rate, amount, discount: Math.max(0, gross - amount), hsn };
    });
    const taxable = lines.reduce((s, l) => s + l.amount, 0);
    const taxTotal = cgst + sgst + igst;
    const rate = taxable > 0 ? snap((taxTotal * 100) / taxable) : 0;
    // Split the tax over the items in proportion to their value; the last item takes the remainder.
    let remC = cgst;
    let remS = sgst;
    let remI = igst;
    lines.forEach((l, i) => {
      const last = i === lines.length - 1;
      const share = taxable > 0 ? l.amount / taxable : 0;
      const c = last ? remC : Math.round(cgst * share * 100) / 100;
      const s = last ? remS : Math.round(sgst * share * 100) / 100;
      const g = last ? remI : Math.round(igst * share * 100) / 100;
      remC -= c;
      remS -= s;
      remI -= g;
      data.push([base.number, base.date, base.party, base.gstin, base.pos, l.name, l.hsn, String(l.qty), l.unit, money(l.rate), l.discount ? money(l.discount) : "", money(l.amount), String(rate), money(c), money(s), money(g), "", total ? money(total) : "", base.narration]);
    });
    if (cess > 0) data.push([number, date, party, gstin, pos, "Cess", "", "1", "", money(cess), "", money(cess), "0", "", "", "", "", total ? money(total) : "", narration]);
    if (Math.abs(other) > 0.005) {
      data.push([number, date, party, gstin, pos, otherNames.join(", ") || "Other charges", "", "1", "", money(other), "", money(other), "0", "", "", "", "", total ? money(total) : "", narration]);
    }
    void roundOff; // differences within ₹1 become the bill's round-off when the bill total is compared with its lines
  }
  const headers = kind === "purchase" ? BILL_HEADERS.map((h) => h.replace("Customer", "Supplier")) : BILL_HEADERS;
  return { headers, data };
}

/** Tally XML bytes → the table for an importer key, or null when this importer has no XML form. */
export function tallyXmlTable(bytes: Buffer, importerKey: string): Table | null {
  const root = parseXml(decodeXmlBytes(bytes));
  switch (importerKey) {
    case MIGRATE_PARTIES_KEY:
    case "invoices.customers":
    case "inventory.suppliers":
      return tallyPartiesTable(root);
    case "catalog.products":
      return tallyItemsTable(root);
    case HISTORY_SALES_KEY:
      return tallyVouchersTable(root, "sale");
    case HISTORY_PURCHASES_KEY:
      return tallyVouchersTable(root, "purchase");
    default:
      return null;
  }
}

// ------------------------------------------------------------------ export: vouchers as Tally import XML

export interface TallyVoucherLine {
  name: string;
  qty: number;
  unit: string;
  /** Rupees per unit. */
  rate: number;
  /** Rupees (net of discount). */
  amount: number;
  hsn?: string;
  gstRate?: number;
}

export interface TallyVoucher {
  kind: BillKind;
  number: string;
  /** YYYY-MM-DD */
  date: string;
  party: string;
  partyGstin?: string | null;
  /** State code or name of the place of supply. */
  placeOfSupply?: string | null;
  lines: TallyVoucherLine[];
  /** Rupees. */
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  narration?: string | null;
}

export interface TallyLedgerNames {
  sales: string;
  purchase: string;
  cgst: string;
  sgst: string;
  igst: string;
  roundOff: string;
}

export const DEFAULT_TALLY_LEDGERS: TallyLedgerNames = {
  sales: "Sales",
  purchase: "Purchase",
  cgst: "Output CGST",
  sgst: "Output SGST",
  igst: "Output IGST",
  roundOff: "Round Off",
};

const tag = (name: string, value: string | number) => `<${name}>${escapeXml(String(value))}</${name}>`;
const amt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/**
 * Tally "Import Data" envelope with one VOUCHER per bill (Tally's own sign convention: for a sale the party ledger is
 * debit (ISDEEMEDPOSITIVE Yes, negative amount) and sales/tax ledgers are credit (positive); a purchase is the
 * mirror). Ledgers and stock items must exist in Tally with these names; we only reference them (the file carries
 * party ledger names as written in this app).
 */
export function buildTallyVouchersXml(vouchers: TallyVoucher[], company: string | null, ledgers: Partial<TallyLedgerNames> = {}): string {
  const L = { ...DEFAULT_TALLY_LEDGERS, ...ledgers };
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>', "<ENVELOPE>", "<HEADER>", tag("TALLYREQUEST", "Import Data"), "</HEADER>", "<BODY>", "<IMPORTDATA>", "<REQUESTDESC>", tag("REPORTNAME", "Vouchers"));
  if (company) out.push("<STATICVARIABLES>", tag("SVCURRENTCOMPANY", company), "</STATICVARIABLES>");
  out.push("</REQUESTDESC>", "<REQUESTDATA>");
  for (const v of vouchers) {
    const sale = v.kind === "sale";
    const type = sale ? "Sales" : "Purchase";
    const party = sign(sale ? -v.total : v.total, sale);
    out.push(
      '<TALLYMESSAGE xmlns:UDF="TallyUDF">',
      `<VOUCHER VCHTYPE="${type}" ACTION="Create" OBJVIEW="Invoice Voucher View">`,
      tag("DATE", v.date.replace(/-/g, "")),
      tag("VOUCHERTYPENAME", type),
      tag("VOUCHERNUMBER", v.number),
      tag("REFERENCE", v.number),
      tag("PARTYLEDGERNAME", v.party),
      ...(v.partyGstin ? [tag("PARTYGSTIN", v.partyGstin)] : []),
      ...(v.placeOfSupply ? [tag("PLACEOFSUPPLY", stateName(v.placeOfSupply) ?? v.placeOfSupply)] : []),
      tag("PERSISTEDVIEW", "Invoice Voucher View"),
      tag("ISINVOICE", "Yes"),
      ...(v.narration ? [tag("NARRATION", v.narration)] : []),
    );
    for (const l of v.lines) {
      out.push(
        "<ALLINVENTORYENTRIES.LIST>",
        tag("STOCKITEMNAME", l.name),
        tag("ISDEEMEDPOSITIVE", sale ? "No" : "Yes"),
        tag("RATE", `${amt(l.rate)}/${l.unit || "Nos"}`),
        tag("AMOUNT", amt(sale ? l.amount : -l.amount)),
        tag("ACTUALQTY", ` ${l.qty} ${l.unit || "Nos"}`),
        tag("BILLEDQTY", ` ${l.qty} ${l.unit || "Nos"}`),
        "<ACCOUNTINGALLOCATIONS.LIST>",
        tag("LEDGERNAME", sale ? L.sales : L.purchase),
        tag("ISDEEMEDPOSITIVE", sale ? "No" : "Yes"),
        tag("AMOUNT", amt(sale ? l.amount : -l.amount)),
        "</ACCOUNTINGALLOCATIONS.LIST>",
        "</ALLINVENTORYENTRIES.LIST>",
      );
    }
    const taxLedger = (name: string, value: number) =>
      value
        ? [ "<ALLLEDGERENTRIES.LIST>", tag("LEDGERNAME", name), tag("ISDEEMEDPOSITIVE", sale ? "No" : "Yes"), tag("AMOUNT", amt(sale ? value : -value)), "</ALLLEDGERENTRIES.LIST>" ]
        : [];
    out.push(
      "<ALLLEDGERENTRIES.LIST>",
      tag("LEDGERNAME", v.party),
      tag("ISDEEMEDPOSITIVE", sale ? "Yes" : "No"),
      tag("ISPARTYLEDGER", "Yes"),
      tag("AMOUNT", party),
      "</ALLLEDGERENTRIES.LIST>",
      ...taxLedger(sale ? L.cgst : L.cgst.replace("Output", "Input"), v.cgst),
      ...taxLedger(sale ? L.sgst : L.sgst.replace("Output", "Input"), v.sgst),
      ...taxLedger(sale ? L.igst : L.igst.replace("Output", "Input"), v.igst),
      ...taxLedger(L.roundOff, v.roundOff),
      "</VOUCHER>",
      "</TALLYMESSAGE>",
    );
  }
  out.push("</REQUESTDATA>", "</IMPORTDATA>", "</BODY>", "</ENVELOPE>");
  return out.join("\n");
}

function sign(value: number, _sale: boolean): string {
  return amt(value);
}

/** Excel layout equivalent of the voucher XML, for shops that prefer Tally's Excel/ODBC route. */
export const TALLY_EXCEL_HEADERS = [
  "Voucher Type",
  "Voucher No.",
  "Date",
  "Party Ledger",
  "Party GSTIN",
  "Place of Supply",
  "Item",
  "HSN/SAC",
  "Qty",
  "Unit",
  "Rate",
  "Amount",
  "GST %",
  "CGST",
  "SGST",
  "IGST",
  "Round Off",
  "Total",
  "Narration",
];

export function tallyExcelRows(vouchers: TallyVoucher[]): (string | number)[][] {
  const rows: (string | number)[][] = [];
  for (const v of vouchers) {
    const type = v.kind === "sale" ? "Sales" : "Purchase";
    v.lines.forEach((l, i) => {
      const first = i === 0;
      rows.push([type, v.number, v.date, v.party, v.partyGstin ?? "", v.placeOfSupply ? (stateName(v.placeOfSupply) ?? v.placeOfSupply) : "", l.name, l.hsn ?? "", l.qty, l.unit, l.rate, l.amount, l.gstRate ?? "", first ? v.cgst : "", first ? v.sgst : "", first ? v.igst : "", first ? v.roundOff : "", first ? v.total : "", first ? (v.narration ?? "") : ""]);
    });
  }
  return rows;
}
