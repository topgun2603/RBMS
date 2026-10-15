import { sha256 } from "@srirealtime/core";
import { ewbValidTill, ewbValidityDays, type CancelEwbPayload, type CancelIrnPayload } from "../ewb";
import { financialYearLong, fromNicDate, toNicDateTime } from "../gst";
import type { EInvoicePayload } from "../nic";
import type { DocType } from "../ports";
import { EInvoiceError, type CancelEwbResult, type CancelIrnResult, type EInvoiceDriver, type EwbRequest, type EwbResult, type IrnResult } from "./types";

/** Deterministic NIC-like IRN: sha256 of seller GSTIN + doc type + doc number + financial year ("2026-27"). */
export function mockIrn(gstin: string, docType: DocType, docNo: string, docDateIso: string): string {
  return sha256(`${gstin.toUpperCase()}${docType}${docNo.toUpperCase()}${financialYearLong(docDateIso)}`);
}

/** 15-digit acknowledgement number derived from the IRN (NIC's are 15 digits too). */
export const mockAckNo = (irn: string) => `1${(BigInt(`0x${irn.slice(0, 16)}`) % 10n ** 14n).toString().padStart(14, "0")}`;

/** 12-digit e-way bill number derived from the IRN / document. */
export const mockEwbNo = (seed: string) => `1${(BigInt(`0x${sha256(`ewb:${seed}`).slice(0, 16)}`) % 10n ** 11n).toString().padStart(11, "0")}`;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");

/** The QR payload NIC signs (same field names), here unsigned and marked `mock: true`. */
export interface QrPayload {
  SellerGstin: string;
  BuyerGstin: string;
  DocNo: string;
  DocTyp: string;
  DocDt: string;
  TotInvVal: number;
  ItemCnt: number;
  MainHsnCode: string;
  Irn: string;
  IrnDt: string;
  mock?: boolean;
}

/**
 * Decodes a signed QR code: a NIC JWT (payload `data` is the JSON string of `QrPayload`) or the mock's plain
 * base64url JSON. Null when it is neither. Does not verify the NIC signature.
 */
export function decodeSignedQr(token: string | null | undefined): QrPayload | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    const body = parts.length === 3 ? parts[1]! : token;
    const json = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    const data = typeof json.data === "string" ? (JSON.parse(json.data) as QrPayload) : (json.data as QrPayload | undefined) ?? (json as unknown as QrPayload);
    return data && typeof data.Irn === "string" ? data : null;
  } catch {
    return null;
  }
}

/** The main HSN of an invoice: the one with the highest assessable value. */
export function mainHsn(p: EInvoicePayload): string {
  const by = new Map<string, number>();
  for (const it of p.ItemList) by.set(it.HsnCd, (by.get(it.HsnCd) ?? 0) + it.AssAmt);
  return [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

interface Stored {
  result: IrnResult;
  payload: EInvoicePayload;
  ackAt: Date;
  cancelledAt?: Date;
}

/**
 * Development driver: deterministic IRN and acknowledgement, unsigned QR. It keeps what it generated in memory so
 * it behaves like NIC: a second request for the same document → 2150 duplicate (with the existing IRN), cancel after
 * 24 h → 2270, cancelling twice → 9999.
 */
export class MockDriver implements EInvoiceDriver {
  readonly provider = "mock" as const;
  private irns = new Map<string, Stored>();
  private ewbs = new Map<string, { at: Date; cancelled: boolean }>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async authenticate(): Promise<void> {}

  async generateIrn(payload: EInvoicePayload): Promise<IrnResult> {
    const docDate = fromNicDate(payload.DocDtls.Dt);
    if (!docDate) throw new EInvoiceError("validation", "Invalid document date", { code: "2163" });
    const irn = mockIrn(payload.SellerDtls.Gstin, payload.DocDtls.Typ, payload.DocDtls.No, docDate);
    const existing = this.irns.get(irn);
    if (existing) {
      throw new EInvoiceError("duplicate_irn", "Duplicate IRN", {
        code: "2150",
        existing: { irn, ackNo: existing.result.ackNo, ackDate: existing.result.ackDate },
      });
    }
    const at = this.now();
    const ackDate = toNicDateTime(at);
    const qr: QrPayload = {
      SellerGstin: payload.SellerDtls.Gstin,
      BuyerGstin: payload.BuyerDtls.Gstin,
      DocNo: payload.DocDtls.No,
      DocTyp: payload.DocDtls.Typ,
      DocDt: payload.DocDtls.Dt,
      TotInvVal: payload.ValDtls.TotInvVal,
      ItemCnt: payload.ItemList.length,
      MainHsnCode: mainHsn(payload),
      Irn: irn,
      IrnDt: ackDate,
      mock: true,
    };
    const ackNo = mockAckNo(irn);
    const result: IrnResult = {
      irn,
      ackNo,
      ackDate,
      signedInvoice: b64({ ...payload, Irn: irn, AckNo: ackNo, AckDt: ackDate, mock: true }),
      signedQrCode: b64(qr),
      status: "ACT",
      mock: true,
    };
    this.irns.set(irn, { result, payload, ackAt: at });
    return result;
  }

  async cancelIrn(p: CancelIrnPayload): Promise<CancelIrnResult> {
    const s = this.irns.get(p.Irn);
    if (!s || s.cancelledAt) throw new EInvoiceError("not_active", "Invoice is not active", { code: "9999" });
    const now = this.now();
    if (now.getTime() - s.ackAt.getTime() > 24 * 3_600_000)
      throw new EInvoiceError("cancel_window", "The allowed cancellation time limit is crossed", { code: "2270" });
    s.cancelledAt = now;
    s.result = { ...s.result, status: "CNL" };
    return { irn: p.Irn, cancelDate: toNicDateTime(now) };
  }

  async getByIrn(irn: string): Promise<IrnResult | null> {
    return this.irns.get(irn)?.result ?? null;
  }

  async getByDocument(docType: DocType, docNo: string, docDate: string): Promise<IrnResult | null> {
    for (const s of this.irns.values()) {
      const d = s.payload.DocDtls;
      if (d.Typ === docType && d.No === docNo && d.Dt === docDate) return s.result;
    }
    return null;
  }

  async generateEwb(req: EwbRequest): Promise<EwbResult> {
    const at = this.now();
    let seed: string;
    let distance: number;
    let vehType: "R" | "O" = "R";
    if (req.kind === "irn") {
      if (!this.irns.has(req.payload.Irn) || this.irns.get(req.payload.Irn)!.cancelledAt)
        throw new EInvoiceError("not_active", "IRN is not active", { code: "9999" });
      seed = req.payload.Irn;
      distance = req.payload.Distance;
      vehType = req.payload.VehType ?? "R";
    } else {
      seed = `${req.payload.fromGstin}|${req.payload.docType}|${req.payload.docNo}|${req.payload.docDate}`;
      distance = Number(req.payload.transDistance) || 0;
      vehType = (req.payload.vehicleType as "R" | "O") || "R";
    }
    const ewbNo = mockEwbNo(seed);
    const prev = this.ewbs.get(ewbNo);
    if (prev && !prev.cancelled) throw new EInvoiceError("validation", "E-way bill already generated for this document");
    this.ewbs.set(ewbNo, { at, cancelled: false });
    // Distance 0 = NIC computes from pincodes; the mock assumes 100 km.
    const days = ewbValidityDays(distance || 100, vehType) ?? 1;
    // Part-A only (no vehicle / document) has no validity yet.
    const partB = req.kind === "irn" ? Boolean(req.payload.VehNo || req.payload.TransDocNo) : Boolean(req.payload.vehicleNo || req.payload.transDocNo);
    return { ewbNo, ewbDate: toNicDateTime(at), ewbValidTill: partB ? toNicDateTime(ewbValidTill(at, days)) : null };
  }

  async cancelEwb(p: CancelEwbPayload): Promise<CancelEwbResult> {
    const key = String(p.ewbNo);
    const s = this.ewbs.get(key);
    if (!s || s.cancelled) throw new EInvoiceError("not_active", "E-way bill is not active", { code: "9999" });
    const now = this.now();
    if (now.getTime() - s.at.getTime() > 24 * 3_600_000)
      throw new EInvoiceError("cancel_window", "E-way bill can only be cancelled within 24 hours", { code: "2270" });
    s.cancelled = true;
    return { ewbNo: key, cancelDate: toNicDateTime(now) };
  }

  /** Test helper: forget everything. */
  reset() {
    this.irns.clear();
    this.ewbs.clear();
  }
}
