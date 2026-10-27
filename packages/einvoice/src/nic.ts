import {
  daysBetween,
  fromNicDate,
  isValidGstin,
  isValidStateCode,
  normalizeGstin,
  normalizeStateCode,
  NIC_GST_RATES,
  roundTo,
  rupees,
  stateFromGstin,
  toNicDate,
  toPaise,
  todayIST,
} from "./gst";
import type { DocType, EInvoiceSource, PartySource } from "./ports";
import { toUqc } from "./units";

/**
 * NIC IRP e-invoice JSON, schema version 1.1 (the fields we fill). Amounts are rupees with 2 decimals, quantities up
 * to 3 decimals. Optional fields are left out rather than sent as null.
 */

export const NIC_SCHEMA_VERSION = "1.1";
export const SUPPLY_TYPES = ["B2B", "SEZWP", "SEZWOP", "EXPWP", "EXPWOP", "DEXP"] as const;
export type SupplyType = (typeof SUPPLY_TYPES)[number];
/** Regular B2B, SEZ with / without payment and exports with / without payment (deemed exports are not built). */
export const SUPPORTED_SUPPLY_TYPES: readonly SupplyType[] = ["B2B", "SEZWP", "SEZWOP", "EXPWP", "EXPWOP"];
const EXPORT_TYPES: readonly SupplyType[] = ["EXPWP", "EXPWOP"];
const IGST_TYPES: readonly SupplyType[] = ["SEZWP", "SEZWOP", "EXPWP", "EXPWOP"];

/** NIC supply type of a bill from its invoices supply type (docs/recurring-export-gstin.md). */
export function nicSupplyTypeOf(t: EInvoiceSource["supplyType"]): SupplyType {
  return t === "export_wpay" ? "EXPWP" : t === "export_wopay" ? "EXPWOP" : t === "sez_wpay" ? "SEZWP" : t === "sez_wopay" ? "SEZWOP" : "B2B";
}

/** Export details (NIC schema 1.1 `ExpDtls`). */
export interface NicExpDtls {
  ShipBNo?: string;
  /** "DD/MM/YYYY". */
  ShipBDt?: string;
  /** 6-character port code. */
  Port?: string;
  /** Refund of IGST claimed: "Y" for an export with payment, else "N". */
  RefClm: "Y" | "N";
  /** ISO 4217 code of the bill's currency. */
  ForCur?: string;
  /** ISO 3166 alpha-2 country of the buyer. */
  CntCode?: string;
}

export interface NicTranDtls {
  TaxSch: "GST";
  SupTyp: SupplyType;
  RegRev: "Y" | "N";
  IgstOnIntra: "Y" | "N";
}

export interface NicDocDtls {
  Typ: DocType;
  /** ≤ 16 characters: first A-Z / 1-9, then A-Z, 0-9, "/" and "-". */
  No: string;
  /** "DD/MM/YYYY". */
  Dt: string;
}

export interface NicParty {
  Gstin: string;
  LglNm: string;
  TrdNm?: string;
  Addr1: string;
  Addr2?: string;
  Loc: string;
  /** 6-digit number. */
  Pin: number;
  /** 2-digit state code (string). */
  Stcd: string;
  Ph?: string;
  Em?: string;
}

export interface NicBuyer extends NicParty {
  /** Place of supply (2-digit state code). */
  Pos: string;
}

export interface NicItem {
  SlNo: string;
  PrdDesc: string;
  IsServc: "Y" | "N";
  HsnCd: string;
  Qty: number;
  Unit: string;
  UnitPrice: number;
  TotAmt: number;
  Discount: number;
  AssAmt: number;
  GstRt: number;
  IgstAmt: number;
  CgstAmt: number;
  SgstAmt: number;
  CesRt: number;
  CesAmt: number;
  TotItemVal: number;
}

export interface NicValDtls {
  AssVal: number;
  CgstVal: number;
  SgstVal: number;
  IgstVal: number;
  CesVal: number;
  Discount: number;
  OthChrg: number;
  RndOffAmt: number;
  TotInvVal: number;
}

export interface NicRefDtls {
  PrecDocDtls: { InvNo: string; InvDt: string }[];
}

export interface EInvoicePayload {
  Version: typeof NIC_SCHEMA_VERSION;
  TranDtls: NicTranDtls;
  DocDtls: NicDocDtls;
  SellerDtls: NicParty;
  BuyerDtls: NicBuyer;
  ItemList: NicItem[];
  ValDtls: NicValDtls;
  RefDtls?: NicRefDtls;
  ExpDtls?: NicExpDtls;
}

// ------------------------------------------------------------------ mapping helpers

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max).trim() : s);
const PIN_IN_TEXT = /(?<!\d)[1-9]\d{5}(?!\d)/g;

export interface SplitAddress {
  addr1: string;
  addr2: string | null;
  loc: string;
  pin: number | null;
}

/**
 * Splits a free-text address into NIC `Addr1` / `Addr2` (≤ 100 each), `Loc` (≤ 50) and `Pin`. Address parts are
 * split on newlines and commas; a 6-digit pincode found in the text is used when `pincode` is not given, and is
 * removed from the address lines.
 */
export function splitAddress(address: string | null | undefined, city?: string | null, pincode?: string | null): SplitAddress {
  const text = address ?? "";
  const pinGiven = (pincode ?? "").replace(/\s+/g, "");
  const found = [...text.matchAll(PIN_IN_TEXT)].map((m) => m[0]);
  const pinText = /^[1-9]\d{5}$/.test(pinGiven) ? pinGiven : (found[found.length - 1] ?? null);
  const parts = text
    .split(/\r?\n|,/)
    .map((p) => clean(pinText ? p.replace(pinText, "") : p).replace(/^[-–\s]+|[-–\s]+$/g, ""))
    .filter(Boolean);
  const cityText = clean(city);
  // Drop a trailing part that only repeats the city.
  if (cityText && parts.length > 1 && parts[parts.length - 1]!.toLowerCase() === cityText.toLowerCase()) parts.pop();

  let addr1 = "";
  let i = 0;
  for (; i < parts.length; i++) {
    const next = addr1 ? `${addr1}, ${parts[i]}` : parts[i]!;
    if (next.length > 100 && addr1) break;
    addr1 = cut(next, 100);
  }
  const rest = parts.slice(i).join(", ");
  const loc = cut(cityText || parts[parts.length - 1] || "", 50);
  return {
    addr1: addr1 || cut(cityText, 100),
    // NIC needs Addr2 to be 3–100 characters when present.
    addr2: rest.length >= 3 ? cut(rest, 100) : null,
    loc,
    pin: pinText ? Number(pinText) : null,
  };
}

/** Digits only; Indian +91 numbers → last 10 digits; null unless 6–12 digits remain. */
export function nicPhone(phone: string | null | undefined): string | null {
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("91")) d = d.slice(-10);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d.length >= 6 && d.length <= 12 ? d : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const nicEmail = (email: string | null | undefined): string | null => {
  const e = clean(email);
  return e.length >= 6 && e.length <= 100 && EMAIL_RE.test(e) ? e : null;
};

/** HSN / SAC codes starting with 99 are services. */
export const isServiceHsn = (hsn: string | null | undefined) => /^99/.test((hsn ?? "").trim());

function party(p: PartySource): NicParty {
  const gstin = normalizeGstin(p.gstin ?? "");
  const addr = splitAddress(p.address, p.city, p.pincode);
  const out: NicParty = {
    Gstin: gstin,
    LglNm: cut(clean(p.name), 100),
    Addr1: addr.addr1,
    Loc: addr.loc,
    Pin: addr.pin ?? 0,
    Stcd: stateFromGstin(gstin) ?? normalizeStateCode(p.stateCode) ?? "",
  };
  const trd = cut(clean(p.tradeName), 100);
  if (trd && trd !== out.LglNm) out.TrdNm = trd;
  if (addr.addr2) out.Addr2 = addr.addr2;
  const ph = nicPhone(p.phone);
  if (ph) out.Ph = ph;
  const em = nicEmail(p.email);
  if (em) out.Em = em;
  return out;
}

export interface BuildOptions {
  /** Default: from the bill's supply type (B2B for a domestic bill). */
  supplyType?: SupplyType;
  /** Reverse charge. Default "N". */
  reverseCharge?: boolean;
}

/** Builds the NIC e-invoice v1.1 JSON from a bill. Pure; check the result with `validateEInvoice`. */
export function buildEInvoice(src: EInvoiceSource, opts: BuildOptions = {}): EInvoicePayload {
  const supplyType = opts.supplyType ?? nicSupplyTypeOf(src.supplyType);
  const exporting = EXPORT_TYPES.includes(supplyType);
  const seller = party(src.seller);
  const b = party(src.buyer);
  // A buyer abroad: GSTIN "URP" (unregistered person), state and place of supply 96, PIN 999999 (NIC rules for exports).
  const buyer: NicBuyer = {
    Gstin: exporting ? "URP" : b.Gstin,
    LglNm: b.LglNm,
    ...(b.TrdNm ? { TrdNm: b.TrdNm } : {}),
    Pos: exporting ? "96" : (normalizeStateCode(src.placeOfSupply) ?? src.placeOfSupply),
    Addr1: b.Addr1 || cut(clean(src.buyer.name), 100),
    ...(b.Addr2 ? { Addr2: b.Addr2 } : {}),
    Loc: exporting && b.Loc.length < 3 ? cut(clean(src.exportDetails?.country ?? "Abroad"), 50) : b.Loc,
    Pin: exporting ? 999999 : b.Pin,
    Stcd: exporting ? "96" : b.Stcd,
    ...(b.Ph ? { Ph: b.Ph } : {}),
    ...(b.Em ? { Em: b.Em } : {}),
  };

  const items: NicItem[] = src.lines.map((l, i) => {
    const hsn = (l.hsn ?? "").replace(/\s+/g, "");
    const discount = l.discount ?? 0;
    return {
      SlNo: String(i + 1),
      PrdDesc: cut(clean(l.description), 300),
      IsServc: isServiceHsn(hsn) ? "Y" : "N",
      HsnCd: hsn,
      Qty: roundTo(l.qty, 3),
      Unit: toUqc(l.unit),
      UnitPrice: rupees(l.rate),
      TotAmt: rupees(l.amount),
      Discount: rupees(discount),
      AssAmt: rupees(l.taxable),
      GstRt: l.gstRate,
      IgstAmt: rupees(l.igst),
      CgstAmt: rupees(l.cgst),
      SgstAmt: rupees(l.sgst),
      CesRt: 0,
      CesAmt: 0,
      TotItemVal: rupees(l.taxable + l.cgst + l.sgst + l.igst),
    };
  });

  const sum = (k: "taxable" | "cgst" | "sgst" | "igst") => src.lines.reduce((s, l) => s + l[k], 0);
  const payload: EInvoicePayload = {
    Version: NIC_SCHEMA_VERSION,
    TranDtls: { TaxSch: "GST", SupTyp: supplyType, RegRev: opts.reverseCharge ? "Y" : "N", IgstOnIntra: "N" },
    DocDtls: { Typ: src.docType ?? "INV", No: (src.number ?? "").trim(), Dt: toNicDate(src.date) },
    SellerDtls: seller,
    BuyerDtls: buyer,
    ItemList: items,
    ValDtls: {
      AssVal: rupees(sum("taxable")),
      CgstVal: rupees(sum("cgst")),
      SgstVal: rupees(sum("sgst")),
      IgstVal: rupees(sum("igst")),
      CesVal: 0,
      Discount: 0,
      OthChrg: rupees(src.otherCharges ?? 0),
      RndOffAmt: rupees(src.totals.roundOff),
      TotInvVal: rupees(src.totals.total),
    },
  };
  if (src.precedingDoc && payload.DocDtls.Typ !== "INV") {
    payload.RefDtls = { PrecDocDtls: [{ InvNo: src.precedingDoc.number, InvDt: toNicDate(src.precedingDoc.date) }] };
  }
  if (exporting) {
    const x = src.exportDetails ?? {};
    const exp: NicExpDtls = { RefClm: supplyType === "EXPWP" ? "Y" : "N" };
    if (x.shippingBillNo) exp.ShipBNo = cut(clean(x.shippingBillNo), 20);
    if (x.shippingBillDate) exp.ShipBDt = toNicDate(x.shippingBillDate);
    if (x.portCode) exp.Port = clean(x.portCode).toUpperCase();
    if (x.currency) exp.ForCur = x.currency.toUpperCase();
    if (x.country) exp.CntCode = x.country.toUpperCase();
    payload.ExpDtls = exp;
  }
  return payload;
}

// ------------------------------------------------------------------ validation

export type IssueSeverity = "error" | "warning";
export interface ValidationIssue {
  /** JSON path, e.g. "BuyerDtls.Gstin", "ItemList[1].HsnCd". */
  path: string;
  code: string;
  message: string;
  severity: IssueSeverity;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface ValidateOptions {
  /** "YYYY-MM-DD" in IST; default today. */
  today?: string;
  /**
   * IRN must be generated within this many days of the document date (NIC: 30 days for taxpayers with AATO ≥ ₹100 cr).
   * null = no limit. Default 30.
   */
  maxAgeDays?: number | null;
  /** Minimum HSN length (4, 6 or 8). NIC accepts 4/6/8; 6 is required by law above ₹5 cr turnover. Default 4. */
  minHsnDigits?: 4 | 6 | 8;
  /** Rupees of rounding difference allowed when totals are cross-checked (NIC allows ₹1). Default 1. */
  toleranceRupees?: number;
}

export const DEFAULT_MAX_AGE_DAYS = 30;
export const DOC_NO_RE = /^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/;
const HSN_RE = /^(\d{4}|\d{6}|\d{8})$/;

export const result = (issues: ValidationIssue[]): ValidationResult => ({
  ok: !issues.some((i) => i.severity === "error"),
  issues,
});

/** Validates a built (or hand-made) e-invoice payload against NIC's rules. Pure. */
export function validateEInvoice(p: EInvoicePayload, opts: ValidateOptions = {}): ValidationResult {
  const issues: ValidationIssue[] = [];
  const err = (path: string, code: string, message: string) => issues.push({ path, code, message, severity: "error" });
  const warn = (path: string, code: string, message: string) => issues.push({ path, code, message, severity: "warning" });
  const tol = Math.round((opts.toleranceRupees ?? 1) * 100);
  const minHsn = opts.minHsnDigits ?? 4;
  const near = (a: number, b: number) => Math.abs(toPaise(a) - toPaise(b)) <= tol;
  const money = (n: unknown) => typeof n === "number" && Number.isFinite(n);

  if (p.Version !== NIC_SCHEMA_VERSION) err("Version", "version", `Schema version must be "${NIC_SCHEMA_VERSION}"`);

  // ---- transaction
  const t = p.TranDtls;
  if (t?.TaxSch !== "GST") err("TranDtls.TaxSch", "tax_scheme", 'Tax scheme must be "GST"');
  if (!SUPPLY_TYPES.includes(t?.SupTyp)) err("TranDtls.SupTyp", "supply_type", "Unknown supply type");
  else if (!SUPPORTED_SUPPLY_TYPES.includes(t.SupTyp))
    err("TranDtls.SupTyp", "supply_type_unsupported", `Deemed exports are not supported (got ${t.SupTyp})`);
  const exporting = EXPORT_TYPES.includes(t?.SupTyp);
  const igstOnly = IGST_TYPES.includes(t?.SupTyp);
  if (t?.RegRev !== "Y" && t?.RegRev !== "N") err("TranDtls.RegRev", "reverse_charge", 'RegRev must be "Y" or "N"');
  if (t?.IgstOnIntra !== "N" && t?.IgstOnIntra !== "Y") err("TranDtls.IgstOnIntra", "igst_on_intra", 'IgstOnIntra must be "Y" or "N"');

  // ---- document
  const d = p.DocDtls;
  if (!["INV", "CRN", "DBN"].includes(d?.Typ)) err("DocDtls.Typ", "doc_type", "Document type must be INV, CRN or DBN");
  if (!d?.No) err("DocDtls.No", "doc_no_missing", "The bill has no number yet (issue it first)");
  else if (d.No.length > 16) err("DocDtls.No", "doc_no_length", "Document number can be at most 16 characters");
  else if (!DOC_NO_RE.test(d.No))
    err("DocDtls.No", "doc_no_format", "Document number may only use A-Z, 0-9, / and -, and cannot start with 0, / or -");
  const docDate = d?.Dt ? fromNicDate(d.Dt) : null;
  if (!docDate) err("DocDtls.Dt", "doc_date", "Document date must be DD/MM/YYYY");
  else {
    const today = opts.today ?? todayIST();
    const age = daysBetween(docDate, today);
    if (age < 0) err("DocDtls.Dt", "doc_date_future", "Document date cannot be in the future");
    const maxAge = opts.maxAgeDays === undefined ? DEFAULT_MAX_AGE_DAYS : opts.maxAgeDays;
    if (maxAge !== null && age > maxAge)
      err("DocDtls.Dt", "doc_date_too_old", `IRN must be generated within ${maxAge} days of the document date (this one is ${age} days old)`);
  }

  // ---- parties
  const checkParty = (path: string, x: NicParty | undefined, who: string) => {
    if (!x) {
      err(path, "party_missing", `${who} details are missing`);
      return;
    }
    if (!isValidGstin(x.Gstin)) err(`${path}.Gstin`, "gstin_invalid", `${who} GSTIN is missing or invalid`);
    else if (x.Stcd !== stateFromGstin(x.Gstin))
      err(`${path}.Stcd`, "state_gstin_mismatch", `${who} state code must match the GSTIN (${stateFromGstin(x.Gstin)})`);
    if (!isValidStateCode(x.Stcd)) err(`${path}.Stcd`, "state_code", `${who} state code is invalid`);
    const name = x.LglNm ?? "";
    if (name.length < 3 || name.length > 100) err(`${path}.LglNm`, "legal_name", `${who} legal name must be 3–100 characters`);
    if (x.TrdNm !== undefined && (x.TrdNm.length < 3 || x.TrdNm.length > 100))
      err(`${path}.TrdNm`, "trade_name", `${who} trade name must be 3–100 characters`);
    if (!x.Addr1 || x.Addr1.length > 100) err(`${path}.Addr1`, "address", `${who} address line 1 is required (≤ 100 characters)`);
    if (x.Addr2 !== undefined && (x.Addr2.length < 3 || x.Addr2.length > 100))
      err(`${path}.Addr2`, "address2", `${who} address line 2 must be 3–100 characters`);
    if (!x.Loc || x.Loc.length < 3 || x.Loc.length > 50) err(`${path}.Loc`, "location", `${who} city / location must be 3–50 characters`);
    if (!Number.isInteger(x.Pin) || x.Pin < 100000 || x.Pin > 999999) err(`${path}.Pin`, "pincode", `${who} 6-digit pincode is required`);
    if (x.Ph !== undefined && !/^\d{6,12}$/.test(x.Ph)) err(`${path}.Ph`, "phone", `${who} phone must be 6–12 digits`);
    if (x.Em !== undefined && !nicEmail(x.Em)) err(`${path}.Em`, "email", `${who} email is invalid`);
  };
  checkParty("SellerDtls", p.SellerDtls, "Seller");
  if (exporting) {
    // A buyer abroad: URP, 96, 999999; name, address and place as for any party.
    const x = p.BuyerDtls;
    if (!x) err("BuyerDtls", "party_missing", "Buyer details are missing");
    else {
      if (x.Gstin !== "URP") err("BuyerDtls.Gstin", "export_buyer_gstin", 'An export buyer\'s GSTIN must be "URP"');
      if (x.Stcd !== "96" || x.Pos !== "96") err("BuyerDtls.Stcd", "export_buyer_state", "An export buyer's state and place of supply must be 96");
      if (x.Pin !== 999999) err("BuyerDtls.Pin", "export_buyer_pin", "An export buyer's PIN must be 999999");
      const name = x.LglNm ?? "";
      if (name.length < 3 || name.length > 100) err("BuyerDtls.LglNm", "legal_name", "Buyer legal name must be 3–100 characters");
      if (!x.Addr1 || x.Addr1.length > 100) err("BuyerDtls.Addr1", "address", "Buyer address line 1 is required (≤ 100 characters)");
      if (!x.Loc || x.Loc.length < 3 || x.Loc.length > 50) err("BuyerDtls.Loc", "location", "Buyer city / location must be 3–50 characters");
    }
    if (!p.ExpDtls) err("ExpDtls", "export_details", "Export details are missing");
    else {
      if (!p.ExpDtls.CntCode) warn("ExpDtls.CntCode", "export_country", "Add the buyer's country on the customer");
      if (!p.ExpDtls.ForCur) warn("ExpDtls.ForCur", "export_currency", "The bill has no foreign currency");
      if (p.ExpDtls.Port !== undefined && !/^[A-Z0-9]{6}$/.test(p.ExpDtls.Port)) err("ExpDtls.Port", "export_port", "Port code is 6 letters and digits");
    }
  } else checkParty("BuyerDtls", p.BuyerDtls, "Buyer");
  const sellerGstin = p.SellerDtls?.Gstin;
  const buyer = p.BuyerDtls;
  if (buyer?.Gstin && sellerGstin && normalizeGstin(buyer.Gstin) === normalizeGstin(sellerGstin))
    err("BuyerDtls.Gstin", "buyer_is_seller", "Buyer GSTIN cannot be the same as the seller GSTIN");
  if (!exporting && buyer?.Gstin?.toUpperCase() === "URP")
    err("BuyerDtls.Gstin", "buyer_unregistered", "E-invoices need a registered buyer (B2B), or an export supply type");
  const pos = buyer?.Pos;
  // 96 "Other Country" is only the place of supply of an export.
  if (!isValidStateCode(pos) && !(exporting && pos === "96")) err("BuyerDtls.Pos", "place_of_supply", "Place of supply must be a valid 2-digit state code");
  // SEZ and export supplies are IGST even inside the State.
  const inter = igstOnly || (Boolean(pos) && Boolean(p.SellerDtls?.Stcd) && pos !== p.SellerDtls.Stcd);

  // ---- items
  const items = Array.isArray(p.ItemList) ? p.ItemList : [];
  if (items.length === 0) err("ItemList", "no_items", "The bill has no lines");
  if (items.length > 1000) err("ItemList", "too_many_items", "NIC accepts at most 1000 lines per invoice");
  const seen = new Set<string>();
  let sAss = 0, sCgst = 0, sSgst = 0, sIgst = 0, sCes = 0, sItem = 0;
  items.forEach((it, i) => {
    const at = (f: string) => `ItemList[${i}].${f}`;
    const label = `Line ${i + 1}`;
    if (!/^\d{1,6}$/.test(it.SlNo ?? "")) err(at("SlNo"), "serial", `${label}: serial number must be 1–6 digits`);
    else if (seen.has(it.SlNo)) err(at("SlNo"), "serial_duplicate", `${label}: serial number repeats`);
    seen.add(it.SlNo);
    const hsn = it.HsnCd ?? "";
    if (!hsn) err(at("HsnCd"), "hsn_missing", `${label} (${it.PrdDesc || "item"}): HSN / SAC code is required`);
    else if (!HSN_RE.test(hsn)) err(at("HsnCd"), "hsn_format", `${label}: HSN / SAC must be 4, 6 or 8 digits`);
    else if (hsn.length < minHsn) err(at("HsnCd"), "hsn_length", `${label}: HSN must have at least ${minHsn} digits`);
    if (hsn && (it.IsServc === "Y") !== isServiceHsn(hsn))
      err(at("IsServc"), "service_flag", `${label}: IsServc must be "Y" exactly for SAC codes starting with 99`);
    const desc = it.PrdDesc ?? "";
    if (desc.length > 300) err(at("PrdDesc"), "description", `${label}: description can be at most 300 characters`);
    else if (desc.length < 3) warn(at("PrdDesc"), "description_short", `${label}: description should be at least 3 characters`);
    if (!NIC_GST_RATES.includes(it.GstRt)) err(at("GstRt"), "gst_rate", `${label}: ${it.GstRt}% is not a valid GST rate`);
    if (!(it.Qty >= 0) || roundTo(it.Qty, 3) !== it.Qty) err(at("Qty"), "quantity", `${label}: quantity must be ≥ 0 with up to 3 decimals`);
    for (const f of ["UnitPrice", "TotAmt", "Discount", "AssAmt", "IgstAmt", "CgstAmt", "SgstAmt", "CesAmt", "TotItemVal"] as const) {
      if (!money(it[f]) || it[f] < 0) err(at(f), "amount", `${label}: ${f} must be a non-negative amount`);
    }
    if (!near(it.TotAmt, it.Qty * it.UnitPrice))
      err(at("TotAmt"), "total_amount", `${label}: TotAmt (${it.TotAmt}) must equal Qty × UnitPrice (${roundTo(it.Qty * it.UnitPrice, 2)})`);
    if (it.Discount > it.TotAmt) err(at("Discount"), "discount", `${label}: discount is more than the line amount`);
    if (!near(it.AssAmt, it.TotAmt - it.Discount))
      err(at("AssAmt"), "assessable", `${label}: AssAmt must equal TotAmt − Discount (${roundTo(it.TotAmt - it.Discount, 2)})`);
    const tax = (it.AssAmt * it.GstRt) / 100;
    if (inter) {
      if (it.CgstAmt !== 0 || it.SgstAmt !== 0) err(at("CgstAmt"), "cgst_on_inter", `${label}: inter-state supply must charge IGST, not CGST/SGST`);
      if (!near(it.IgstAmt, tax)) err(at("IgstAmt"), "igst_amount", `${label}: IGST should be ${roundTo(tax, 2)}`);
    } else {
      if (it.IgstAmt !== 0) err(at("IgstAmt"), "igst_on_intra", `${label}: intra-state supply must charge CGST + SGST, not IGST`);
      if (!near(it.CgstAmt, tax / 2)) err(at("CgstAmt"), "cgst_amount", `${label}: CGST should be ${roundTo(tax / 2, 2)}`);
      if (!near(it.SgstAmt, tax / 2)) err(at("SgstAmt"), "sgst_amount", `${label}: SGST should be ${roundTo(tax / 2, 2)}`);
    }
    if (it.CesAmt !== 0 || it.CesRt !== 0) warn(at("CesAmt"), "cess", `${label}: cess is not computed by this module`);
    const itemVal = it.AssAmt + it.CgstAmt + it.SgstAmt + it.IgstAmt + it.CesAmt;
    if (!near(it.TotItemVal, itemVal)) err(at("TotItemVal"), "item_value", `${label}: TotItemVal should be ${roundTo(itemVal, 2)}`);
    sAss += toPaise(it.AssAmt);
    sCgst += toPaise(it.CgstAmt);
    sSgst += toPaise(it.SgstAmt);
    sIgst += toPaise(it.IgstAmt);
    sCes += toPaise(it.CesAmt);
    sItem += toPaise(it.TotItemVal);
  });

  // ---- totals
  const v = p.ValDtls;
  if (!v) err("ValDtls", "totals_missing", "Invoice totals are missing");
  else {
    const within = (a: number, paise: number) => Math.abs(toPaise(a) - paise) <= tol;
    if (!within(v.AssVal, sAss)) err("ValDtls.AssVal", "total_assessable", `AssVal must equal the sum of line AssAmt (${rupees(sAss)})`);
    if (!within(v.CgstVal, sCgst)) err("ValDtls.CgstVal", "total_cgst", `CgstVal must equal the sum of line CGST (${rupees(sCgst)})`);
    if (!within(v.SgstVal, sSgst)) err("ValDtls.SgstVal", "total_sgst", `SgstVal must equal the sum of line SGST (${rupees(sSgst)})`);
    if (!within(v.IgstVal, sIgst)) err("ValDtls.IgstVal", "total_igst", `IgstVal must equal the sum of line IGST (${rupees(sIgst)})`);
    if (!within(v.CesVal, sCes)) err("ValDtls.CesVal", "total_cess", "CesVal must equal the sum of line cess");
    for (const f of ["AssVal", "CgstVal", "SgstVal", "IgstVal", "CesVal", "Discount", "OthChrg", "TotInvVal"] as const) {
      if (!money(v[f]) || v[f] < 0) err(`ValDtls.${f}`, "amount", `${f} must be a non-negative amount`);
    }
    if (!money(v.RndOffAmt) || Math.abs(v.RndOffAmt) > 99.99) err("ValDtls.RndOffAmt", "round_off", "Round-off must be between −99.99 and 99.99");
    if (inter && (v.CgstVal !== 0 || v.SgstVal !== 0)) err("ValDtls.CgstVal", "cgst_on_inter", "Inter-state invoice cannot carry CGST/SGST");
    if (!inter && v.IgstVal !== 0) err("ValDtls.IgstVal", "igst_on_intra", "Intra-state invoice cannot carry IGST");
    const expected = v.AssVal + v.CgstVal + v.SgstVal + v.IgstVal + v.CesVal + v.OthChrg - v.Discount + v.RndOffAmt;
    if (!near(v.TotInvVal, expected))
      err("ValDtls.TotInvVal", "invoice_value", `TotInvVal (${v.TotInvVal}) must equal assessable + taxes + other charges − discount + round-off (${roundTo(expected, 2)})`);
    const fromItems = rupees(sItem) + v.OthChrg - v.Discount + v.RndOffAmt;
    if (!near(v.TotInvVal, fromItems))
      err("ValDtls.TotInvVal", "invoice_value_items", `TotInvVal must equal the sum of line values + other charges − discount + round-off (${roundTo(fromItems, 2)})`);
  }

  if (p.RefDtls) {
    p.RefDtls.PrecDocDtls.forEach((r, i) => {
      if (!r.InvNo || r.InvNo.length > 16) err(`RefDtls.PrecDocDtls[${i}].InvNo`, "ref_doc_no", "Original invoice number is required (≤ 16 characters)");
      if (!fromNicDate(r.InvDt)) err(`RefDtls.PrecDocDtls[${i}].InvDt`, "ref_doc_date", "Original invoice date must be DD/MM/YYYY");
    });
  }
  return result(issues);
}

/** Checks on the bill itself that the payload cannot show (status, totals vs lines, interState flag). */
export function validateSource(src: EInvoiceSource, tolerancePaise = 100): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (path: string, code: string, message: string) => issues.push({ path, code, message, severity: "error" });
  if (src.status === "draft") err("status", "draft", "Issue the bill before generating an e-invoice");
  if (src.status === "cancelled") err("status", "cancelled", "This bill is cancelled");
  const st = nicSupplyTypeOf(src.supplyType);
  if (!src.buyer.gstin && !EXPORT_TYPES.includes(st)) {
    err("BuyerDtls.Gstin", "buyer_gstin_missing", "E-invoices are only for registered (B2B) buyers: add the customer's GSTIN");
  }
  if (!src.seller.gstin) err("SellerDtls.Gstin", "seller_gstin_missing", "Add the shop's GSTIN in billing settings");
  const sellerState = stateFromGstin(src.seller.gstin) ?? normalizeStateCode(src.seller.stateCode);
  const pos = normalizeStateCode(src.placeOfSupply);
  if (sellerState && pos && !IGST_TYPES.includes(st) && src.interState !== (sellerState !== pos))
    err("BuyerDtls.Pos", "inter_state_flag", "The bill's inter-state flag does not match the seller state and place of supply");
  const sum = (k: "taxable" | "cgst" | "sgst" | "igst") => src.lines.reduce((s, l) => s + l[k], 0);
  for (const k of ["taxable", "cgst", "sgst", "igst"] as const) {
    if (Math.abs(sum(k) - src.totals[k]) > tolerancePaise) err(`totals.${k}`, "totals_mismatch", `Bill ${k} total does not match its lines`);
  }
  return issues;
}

/** Builds and validates in one go. */
export function prepareEInvoice(src: EInvoiceSource, opts: BuildOptions & ValidateOptions = {}) {
  const payload = buildEInvoice(src, opts);
  const issues = [...validateSource(src, Math.round((opts.toleranceRupees ?? 1) * 100)), ...validateEInvoice(payload, opts).issues];
  return { payload, ...result(issues) };
}
