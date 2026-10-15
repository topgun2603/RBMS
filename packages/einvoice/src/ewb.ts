import {
  daysBetween,
  isValidDate,
  isValidGstin,
  isValidTransporterId,
  normalizeGstin,
  normalizeStateCode,
  rupees,
  stateFromGstin,
  toNicDate,
  todayIST,
} from "./gst";
import { isServiceHsn, result, splitAddress, type ValidationIssue, type ValidationResult } from "./nic";
import type { EInvoiceSource } from "./ports";
import { toUqc } from "./units";

/** 1 Road, 2 Rail, 3 Air, 4 Ship. */
export const TRANS_MODES = [1, 2, 3, 4] as const;
export type TransMode = (typeof TRANS_MODES)[number];
export const TRANS_MODE_LABELS: Record<TransMode, string> = { 1: "Road", 2: "Rail", 3: "Air", 4: "Ship" };
/** R = regular, O = over-dimensional cargo. */
export type VehicleType = "R" | "O";
export const MAX_EWB_DISTANCE_KM = 4000;

/** Transport details as staff enter them (camelCase; dates "YYYY-MM-DD"). */
export interface EwbInput {
  /** Km, 0–4000. 0 lets NIC compute the distance from the two pincodes. */
  distance: number;
  transMode?: TransMode | null;
  /** Transporter GSTIN / TRANSIN. */
  transporterId?: string | null;
  transporterName?: string | null;
  /** LR / RR / airway bill / bill of lading number. */
  transDocNo?: string | null;
  transDocDate?: string | null;
  vehicleNo?: string | null;
  vehicleType?: VehicleType | null;
}

/** NIC "Generate e-way bill by IRN" payload. */
export interface EwbByIrnPayload {
  Irn: string;
  Distance: number;
  TransMode?: "1" | "2" | "3" | "4";
  TransId?: string;
  TransName?: string;
  TransDocNo?: string;
  /** "DD/MM/YYYY". */
  TransDocDt?: string;
  VehNo?: string;
  VehType?: VehicleType;
}

const VEHICLE_FORMATS: { name: string; re: RegExp }[] = [
  // TN01AB1234, TN01A1234, TN011234, DL1CAB1234 (Delhi single-digit RTO)
  { name: "regular", re: /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/ },
  // Bharat series: 22BH1234AB
  { name: "bharat", re: /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/ },
  // Temporary registration: TR / TM / TN-style prefixes followed by 6–14 characters
  { name: "temporary", re: /^T[RM][A-Z0-9]{6,14}$/ },
  // Defence vehicles
  { name: "defence", re: /^DF[A-Z0-9]{5,18}$/ },
];

/** Upper-case, without spaces, dots or dashes: "tn 01 ab-1234" → "TN01AB1234". */
export const normalizeVehicleNo = (v: string) => v.toUpperCase().replace(/[\s.\-/]/g, "");

/** True for an e-way bill vehicle number (regular, Bharat series, temporary or defence). */
export function isValidVehicleNo(v: string | null | undefined): boolean {
  if (typeof v !== "string") return false;
  const n = normalizeVehicleNo(v);
  return n.length >= 4 && n.length <= 20 && VEHICLE_FORMATS.some((f) => f.re.test(n));
}

export interface EwbValidateOptions {
  /** The invoice date ("YYYY-MM-DD"); the transport document cannot be older. */
  docDate?: string;
  /** "YYYY-MM-DD" IST; default today. */
  today?: string;
}

/**
 * Part-B rules: either a transporter id (Part-A only, the transporter adds the vehicle later) or Part-B
 * (mode + vehicle for road; mode + transport document for rail/air/ship). Distance 0–4000 km.
 */
export function validateEwbInput(input: EwbInput, opts: EwbValidateOptions = {}): ValidationResult {
  const issues: ValidationIssue[] = [];
  const err = (path: string, code: string, message: string) => issues.push({ path, code, message, severity: "error" });
  const today = opts.today ?? todayIST();

  if (!Number.isInteger(input.distance) || input.distance < 0 || input.distance > MAX_EWB_DISTANCE_KM)
    err("distance", "distance", `Distance must be a whole number of km between 0 and ${MAX_EWB_DISTANCE_KM}`);

  const mode = input.transMode ?? (input.vehicleNo ? 1 : null);
  if (mode !== null && !TRANS_MODES.includes(mode)) err("transMode", "trans_mode", "Transport mode must be 1 (road), 2 (rail), 3 (air) or 4 (ship)");

  const transId = input.transporterId?.trim() ? normalizeGstin(input.transporterId) : null;
  if (transId && !isValidTransporterId(transId)) err("transporterId", "transporter_id", "Transporter id must be a valid GSTIN / TRANSIN");
  const name = input.transporterName?.trim();
  if (name && (name.length < 3 || name.length > 100)) err("transporterName", "transporter_name", "Transporter name must be 3–100 characters");

  const veh = input.vehicleNo?.trim() ? normalizeVehicleNo(input.vehicleNo) : null;
  if (veh && !isValidVehicleNo(veh)) err("vehicleNo", "vehicle_no", "Vehicle number is not in a valid format (e.g. TN01AB1234)");
  if (input.vehicleType && input.vehicleType !== "R" && input.vehicleType !== "O")
    err("vehicleType", "vehicle_type", 'Vehicle type must be "R" (regular) or "O" (over-dimensional cargo)');

  const docNo = input.transDocNo?.trim() || null;
  const docDate = input.transDocDate?.trim() || null;
  if (docNo && !/^[A-Za-z0-9/-]{1,15}$/.test(docNo)) err("transDocNo", "trans_doc_no", "Transport document number: up to 15 letters, digits, / or -");
  if (docNo && !docDate) err("transDocDate", "trans_doc_date_missing", "Enter the transport document date");
  if (docDate && !docNo) err("transDocNo", "trans_doc_no_missing", "Enter the transport document number");
  if (docDate) {
    if (!isValidDate(docDate)) err("transDocDate", "trans_doc_date", "Transport document date must be YYYY-MM-DD");
    else {
      if (daysBetween(docDate, today) < 0) err("transDocDate", "trans_doc_date_future", "Transport document date cannot be in the future");
      if (opts.docDate && daysBetween(opts.docDate, docDate) < 0)
        err("transDocDate", "trans_doc_date_before_invoice", "Transport document date cannot be before the invoice date");
    }
  }

  if (mode === null) {
    if (!transId) err("transMode", "part_b_required", "Give a transporter id, or the transport mode with vehicle / document details");
  } else if (mode === 1) {
    if (!veh && !transId) err("vehicleNo", "vehicle_required", "Vehicle number is required for road transport");
  } else {
    if (!docNo) err("transDocNo", "trans_doc_required", `${TRANS_MODE_LABELS[mode as TransMode] ?? "This"} transport needs the transport document number and date`);
  }
  if (input.vehicleType === "O" && mode !== null && mode !== 1)
    err("vehicleType", "odc_not_road", "Over-dimensional cargo applies to road transport only");
  return result(issues);
}

/** The NIC "e-way bill by IRN" payload. Call `validateEwbInput` first. */
export function buildEwbByIrn(irn: string, input: EwbInput): EwbByIrnPayload {
  const out: EwbByIrnPayload = { Irn: irn, Distance: input.distance };
  const mode = input.transMode ?? (input.vehicleNo ? 1 : null);
  if (mode) out.TransMode = String(mode) as EwbByIrnPayload["TransMode"];
  if (input.transporterId?.trim()) out.TransId = normalizeGstin(input.transporterId);
  if (input.transporterName?.trim()) out.TransName = input.transporterName.trim();
  if (input.transDocNo?.trim()) out.TransDocNo = input.transDocNo.trim();
  if (input.transDocDate?.trim()) out.TransDocDt = toNicDate(input.transDocDate.trim());
  if (input.vehicleNo?.trim()) {
    out.VehNo = normalizeVehicleNo(input.vehicleNo);
    out.VehType = input.vehicleType ?? "R";
  }
  return out;
}

/** Days an e-way bill stays valid: 1 per 200 km (or part) for regular cargo, 1 per 20 km for ODC. Null when distance is 0 (NIC computes it). */
export function ewbValidityDays(distanceKm: number, vehicleType: VehicleType = "R"): number | null {
  if (!(distanceKm > 0)) return null;
  return Math.ceil(distanceKm / (vehicleType === "O" ? 20 : 200));
}

/**
 * Valid-till of an e-way bill generated at `generatedAt`: each day runs to midnight of the following day (IST),
 * so 1 day from 15 Oct 10:00 → 16 Oct 23:59:59 IST.
 */
export function ewbValidTill(generatedAt: Date, days: number): Date {
  const istDate = new Date(generatedAt.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const end = new Date(`${istDate}T23:59:59+05:30`);
  return new Date(end.getTime() + days * 86_400_000);
}

// ------------------------------------------------------------------ standalone (no IRN) — NIC e-way bill API

export interface EwbStandaloneItem {
  productName: string;
  productDesc: string;
  hsnCode: number;
  quantity: number;
  qtyUnit: string;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cessRate: number;
  cessNonadvol: number;
  taxableAmount: number;
}

/** NIC e-way bill API `GENEWAYBILL` payload (outward supply of goods, tax invoice). */
export interface EwbStandalonePayload {
  supplyType: "O";
  subSupplyType: "1";
  subSupplyDesc: string;
  docType: "INV" | "CHL" | "BIL";
  docNo: string;
  docDate: string;
  fromGstin: string;
  fromTrdName: string;
  fromAddr1: string;
  fromAddr2: string;
  fromPlace: string;
  fromPincode: number;
  fromStateCode: number;
  actFromStateCode: number;
  toGstin: string;
  toTrdName: string;
  toAddr1: string;
  toAddr2: string;
  toPlace: string;
  toPincode: number;
  toStateCode: number;
  actToStateCode: number;
  /** 1 Regular. */
  transactionType: 1;
  otherValue: number;
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  cessValue: number;
  cessNonAdvolValue: number;
  totInvValue: number;
  transporterId: string;
  transporterName: string;
  transDocNo: string;
  transMode: string;
  transDistance: string;
  transDocDate: string;
  vehicleNo: string;
  vehicleType: string;
  itemList: EwbStandaloneItem[];
}

/**
 * Standalone e-way bill (for bills without an IRN, e.g. B2C or below the e-invoice threshold). Unregistered buyers
 * are "URP" with the place of supply as their state. Service (SAC 99…) lines are left out: e-way bills cover goods.
 */
export function buildStandaloneEwb(src: EInvoiceSource, input: EwbInput): EwbStandalonePayload {
  const from = splitAddress(src.seller.address, src.seller.city, src.seller.pincode);
  const to = splitAddress(src.buyer.address, src.buyer.city, src.buyer.pincode);
  const sellerState = Number(stateFromGstin(src.seller.gstin) ?? normalizeStateCode(src.seller.stateCode) ?? 0);
  const pos = Number(normalizeStateCode(src.placeOfSupply) ?? 0);
  const buyerGstin = src.buyer.gstin && isValidGstin(src.buyer.gstin) ? normalizeGstin(src.buyer.gstin) : "URP";
  const buyerState = buyerGstin === "URP" ? pos : Number(stateFromGstin(buyerGstin) ?? pos);
  const goods = src.lines.filter((l) => !isServiceHsn(l.hsn));
  const sum = (k: "taxable" | "cgst" | "sgst" | "igst") => goods.reduce((s, l) => s + l[k], 0);
  const taxable = sum("taxable"), cgst = sum("cgst"), sgst = sum("sgst"), igst = sum("igst");
  const services = src.lines.filter((l) => isServiceHsn(l.hsn)).reduce((s, l) => s + l.total, 0);
  const otherPaise = (src.otherCharges ?? 0) + src.totals.roundOff;
  const mode = input.transMode ?? (input.vehicleNo ? 1 : null);
  return {
    supplyType: "O",
    subSupplyType: "1",
    subSupplyDesc: "",
    docType: "INV",
    docNo: (src.number ?? "").trim(),
    docDate: toNicDate(src.date),
    fromGstin: normalizeGstin(src.seller.gstin ?? ""),
    fromTrdName: (src.seller.tradeName || src.seller.name || "").trim().slice(0, 100),
    fromAddr1: from.addr1,
    fromAddr2: from.addr2 ?? "",
    fromPlace: from.loc,
    fromPincode: from.pin ?? 0,
    fromStateCode: sellerState,
    actFromStateCode: sellerState,
    toGstin: buyerGstin,
    toTrdName: (src.buyer.tradeName || src.buyer.name || "").trim().slice(0, 100),
    toAddr1: to.addr1,
    toAddr2: to.addr2 ?? "",
    toPlace: to.loc,
    toPincode: to.pin ?? 0,
    toStateCode: buyerState,
    actToStateCode: pos,
    transactionType: 1,
    otherValue: rupees(otherPaise),
    totalValue: rupees(taxable),
    cgstValue: rupees(cgst),
    sgstValue: rupees(sgst),
    igstValue: rupees(igst),
    cessValue: 0,
    cessNonAdvolValue: 0,
    // The goods value carried; service lines on the same bill are not part of the consignment.
    totInvValue: rupees(src.totals.total - services),
    transporterId: input.transporterId?.trim() ? normalizeGstin(input.transporterId) : "",
    transporterName: input.transporterName?.trim() ?? "",
    transDocNo: input.transDocNo?.trim() ?? "",
    transMode: mode ? String(mode) : "",
    transDistance: String(input.distance),
    transDocDate: input.transDocDate?.trim() ? toNicDate(input.transDocDate.trim()) : "",
    vehicleNo: input.vehicleNo?.trim() ? normalizeVehicleNo(input.vehicleNo) : "",
    vehicleType: input.vehicleNo?.trim() ? (input.vehicleType ?? "R") : "",
    itemList: goods.map((l) => {
      const inter = src.interState;
      return {
        productName: l.description.trim().slice(0, 100),
        productDesc: l.description.trim().slice(0, 100),
        hsnCode: Number((l.hsn ?? "").replace(/\s+/g, "") || 0),
        quantity: l.qty,
        qtyUnit: toUqc(l.unit),
        cgstRate: inter ? 0 : l.gstRate / 2,
        sgstRate: inter ? 0 : l.gstRate / 2,
        igstRate: inter ? l.gstRate : 0,
        cessRate: 0,
        cessNonadvol: 0,
        taxableAmount: rupees(l.taxable),
      };
    }),
  };
}

/** Checks a standalone e-way bill payload's party / item fields (Part-B is checked by `validateEwbInput`). */
export function validateStandaloneEwb(p: EwbStandalonePayload): ValidationResult {
  const issues: ValidationIssue[] = [];
  const err = (path: string, code: string, message: string) => issues.push({ path, code, message, severity: "error" });
  if (!p.docNo) err("docNo", "doc_no_missing", "The bill has no number yet (issue it first)");
  if (!isValidGstin(p.fromGstin)) err("fromGstin", "gstin_invalid", "Seller GSTIN is missing or invalid");
  if (p.toGstin !== "URP" && !isValidGstin(p.toGstin)) err("toGstin", "gstin_invalid", "Buyer GSTIN is invalid");
  if (p.fromPincode < 100000 || p.fromPincode > 999999) err("fromPincode", "pincode", "Seller 6-digit pincode is required");
  if (p.toPincode < 100000 || p.toPincode > 999999) err("toPincode", "pincode", "Buyer 6-digit pincode is required (delivery address)");
  if (!p.fromPlace || p.fromPlace.length < 3) err("fromPlace", "location", "Seller city / location is required");
  if (!p.toPlace || p.toPlace.length < 3) err("toPlace", "location", "Buyer city / location is required");
  if (p.itemList.length === 0) err("itemList", "no_goods", "E-way bills are for goods; this bill has only services");
  p.itemList.forEach((it, i) => {
    if (!/^\d{4,8}$/.test(String(it.hsnCode)) || ![4, 6, 8].includes(String(it.hsnCode).length))
      err(`itemList[${i}].hsnCode`, "hsn_format", `Line ${i + 1}: HSN must be 4, 6 or 8 digits`);
  });
  return result(issues);
}

/** IRN cancellation reasons (NIC): 1 Duplicate, 2 Data entry mistake, 3 Order cancelled, 4 Others. */
export const IRN_CANCEL_REASONS = { 1: "Duplicate", 2: "Data entry mistake", 3: "Order cancelled", 4: "Others" } as const;
/** E-way bill cancellation reasons (NIC): 1 Duplicate, 2 Order cancelled, 3 Data entry mistake, 4 Others. */
export const EWB_CANCEL_REASONS = { 1: "Duplicate", 2: "Order cancelled", 3: "Data entry mistake", 4: "Others" } as const;
export type CancelReasonCode = 1 | 2 | 3 | 4;

/** NIC cancel-IRN payload. */
export interface CancelIrnPayload {
  Irn: string;
  CnlRsn: "1" | "2" | "3" | "4";
  /** ≤ 100 characters. */
  CnlRem: string;
}

/** NIC cancel-e-way-bill payload. */
export interface CancelEwbPayload {
  ewbNo: number;
  cancelRsnCode: CancelReasonCode;
  cancelRmrk: string;
}

export const buildCancelIrn = (irn: string, reason: CancelReasonCode, remark?: string | null): CancelIrnPayload => ({
  Irn: irn,
  CnlRsn: String(reason) as CancelIrnPayload["CnlRsn"],
  CnlRem: (remark?.trim() || IRN_CANCEL_REASONS[reason]).slice(0, 100),
});

export const buildCancelEwb = (ewbNo: string, reason: CancelReasonCode, remark?: string | null): CancelEwbPayload => ({
  ewbNo: Number(ewbNo),
  cancelRsnCode: reason,
  cancelRmrk: (remark?.trim() || EWB_CANCEL_REASONS[reason]).slice(0, 50),
});

/** Within `hours` (default 24) of `from`? */
export const withinHours = (from: Date, now: Date, hours = 24) => now.getTime() - from.getTime() <= hours * 3_600_000;
