// E-invoice (IRN) + e-way bill helpers for the bill screen. Pure: no React, no fetch.
// Mirrors packages/einvoice (ewb.ts, gst.ts, drivers/mock.ts) — UI modules never import server packages.

import { gstinCheckChar } from "@srirealtime/gst";

// ------------------------------------------------------------------ API shapes (GET /v1/einvoice/...)

export type EInvoiceRecordStatus = "generated" | "cancelled" | "failed" | "ewb_only";
export type IssueSeverity = "error" | "warning";

export interface EInvoiceIssue {
  path: string;
  code: string;
  message: string;
  severity: IssueSeverity;
}

/** The QR payload NIC signs (same field names). */
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

export interface EInvoiceRecord {
  id: string;
  invoiceId: string;
  provider: string;
  mock: boolean;
  docType: string;
  docNo: string;
  docDate: string;
  status: EInvoiceRecordStatus;
  irn: string | null;
  ackNo: string | null;
  ackDate: string | null;
  signedQrCode: string | null;
  qr: QrPayload | null;
  cancellableUntil: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelRemark: string | null;
  error: { kind: string; code: string | null; message: string; errors?: { code: string | null; message: string }[] } | null;
  ewbNo: string | null;
  ewbDate: string | null;
  ewbValidTill: string | null;
  ewbStatus: "active" | "cancelled" | null;
  ewbCancelledAt: string | null;
  createdAt: string;
}

export interface InvoiceEInvoiceStatus {
  invoiceId: string;
  einvoice: EInvoiceRecord | null;
  ewb: { ewbNo: string; ewbDate: string | null; validTill: string | null; recordId: string } | null;
  history: EInvoiceRecord[];
}

export interface EInvoicePreview {
  payload: unknown;
  ok: boolean;
  issues: EInvoiceIssue[];
}

export interface GenerateIrnResult {
  record: EInvoiceRecord;
  alreadyGenerated: boolean;
  warnings: EInvoiceIssue[];
}

export interface Gstr1Summary {
  warnings: string[];
  counts: { b2b: number; b2cl: number; b2cs: number; cancelled: number; skipped: number };
  filename?: string;
  /** The GSTR-1 file itself (`fp` = its month, MMYYYY): the card saves this instead of building it again. */
  json?: { fp?: string } & Record<string, unknown>;
}

// ------------------------------------------------------------------ signed QR

function base64UrlToText(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Decodes a signed QR code: a NIC JWT (payload `data` is the JSON string of the QR payload) or plain base64url JSON
 * (the test provider). Null when it is neither. Does not verify the signature.
 */
export function decodeSignedQr(token: string | null | undefined): QrPayload | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    const body = parts.length === 3 ? parts[1]! : token;
    const json = JSON.parse(base64UrlToText(body)) as Record<string, unknown>;
    const data =
      typeof json.data === "string"
        ? (JSON.parse(json.data) as QrPayload)
        : ((json.data as QrPayload | undefined) ?? (json as unknown as QrPayload));
    return data && typeof data.Irn === "string" ? data : null;
  } catch {
    return null;
  }
}

/** "4328…80d0" style shortening for long ids (IRN is 64 hex characters). */
export function truncateMiddle(s: string, head = 10, tail = 8): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

// ------------------------------------------------------------------ transport details

/** 1 Road, 2 Rail, 3 Air, 4 Ship. */
export const TRANS_MODES = [1, 2, 3, 4] as const;
export type TransMode = (typeof TRANS_MODES)[number];
export const TRANS_MODE_KEYS: Record<TransMode, "road" | "rail" | "air" | "ship"> = { 1: "road", 2: "rail", 3: "air", 4: "ship" };
export type VehicleType = "R" | "O";
export const MAX_EWB_DISTANCE_KM = 4000;

/** IRN cancellation reasons (NIC): 1 Duplicate, 2 Data entry mistake, 3 Order cancelled, 4 Others. */
export const IRN_CANCEL_REASONS = { 1: "duplicate", 2: "dataEntry", 3: "orderCancelled", 4: "others" } as const;
/** E-way bill cancellation reasons (NIC): 1 Duplicate, 2 Order cancelled, 3 Data entry mistake, 4 Others. */
export const EWB_CANCEL_REASONS = { 1: "duplicate", 2: "orderCancelled", 3: "dataEntry", 4: "others" } as const;
export type CancelReasonCode = 1 | 2 | 3 | 4;
export const CANCEL_REASON_CODES: CancelReasonCode[] = [1, 2, 3, 4];
export const MAX_CANCEL_REMARK = 100;

const VEHICLE_FORMATS: RegExp[] = [
  // TN01AB1234, TN01A1234, TN011234, DL1CAB1234
  /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/,
  // Bharat series: 22BH1234AB
  /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/,
  // Temporary registration
  /^T[RM][A-Z0-9]{6,14}$/,
  // Defence vehicles
  /^DF[A-Z0-9]{5,18}$/,
];

/** Upper-case, without spaces, dots, dashes or slashes: "tn 01 ab-1234" → "TN01AB1234". */
export const normalizeVehicleNo = (v: string) => v.toUpperCase().replace(/[\s.\-/]/g, "");

/** True for an e-way bill vehicle number (regular, Bharat series, temporary or defence). */
export function isValidVehicleNo(v: string | null | undefined): boolean {
  if (typeof v !== "string") return false;
  const n = normalizeVehicleNo(v);
  return n.length >= 4 && n.length <= 20 && VEHICLE_FORMATS.some((re) => re.test(n));
}

export const normalizeTransporterId = (id: string) => id.replace(/\s+/g, "").toUpperCase();

/** Transporter GSTIN or 15-character TRANSIN (same mod-36 check character). */
export function isValidTransporterId(id: string | null | undefined): boolean {
  if (typeof id !== "string") return false;
  const g = normalizeTransporterId(id);
  if (!/^[0-9]{2}[0-9A-Z]{13}$/.test(g)) return false;
  return gstinCheckChar(g.slice(0, 14)) === g[14];
}

/** What staff type in the e-way bill dialog (strings as typed). */
export interface EwbForm {
  distance: string;
  transMode: TransMode;
  transporterId: string;
  transporterName: string;
  transDocNo: string;
  /** "YYYY-MM-DD" or "". */
  transDocDate: string;
  vehicleNo: string;
  vehicleType: VehicleType;
}

export const emptyEwbForm = (): EwbForm => ({
  distance: "0",
  transMode: 1,
  transporterId: "",
  transporterName: "",
  transDocNo: "",
  transDocDate: "",
  vehicleNo: "",
  vehicleType: "R",
});

export type EwbField = keyof EwbForm;
/** Field → error code (translated as billing.ewb.errors.<code>). */
export type EwbErrors = Partial<Record<EwbField, string>>;

/** Calendar difference b − a in days for "YYYY-MM-DD" strings. */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/**
 * The server's Part-B rules (packages/einvoice ewb.ts validateEwbInput), as field errors:
 * distance 0–4000 whole km; road needs a vehicle number unless a transporter id is given; rail/air/ship need the
 * transport document number + date; the document date can't be in the future or before the bill; ODC is road only.
 */
export function validateEwbForm(f: EwbForm, opts: { docDate?: string; today: string }): EwbErrors {
  const e: EwbErrors = {};
  const d = f.distance.trim();
  const dist = Number(d);
  if (!/^\d+$/.test(d) || !Number.isInteger(dist) || dist < 0 || dist > MAX_EWB_DISTANCE_KM) e.distance = "distance";

  const transId = f.transporterId.trim() ? normalizeTransporterId(f.transporterId) : "";
  if (transId && !isValidTransporterId(transId)) e.transporterId = "transporterId";
  const name = f.transporterName.trim();
  if (name && (name.length < 3 || name.length > 100)) e.transporterName = "transporterName";

  const road = f.transMode === 1;
  const veh = road && f.vehicleNo.trim() ? normalizeVehicleNo(f.vehicleNo) : "";
  if (veh && !isValidVehicleNo(veh)) e.vehicleNo = "vehicleNo";

  const docNo = f.transDocNo.trim();
  const docDate = f.transDocDate.trim();
  if (docNo && !/^[A-Za-z0-9/-]{1,15}$/.test(docNo)) e.transDocNo = "transDocNo";
  if (docNo && !docDate) e.transDocDate = "transDocDateMissing";
  if (docDate && !docNo) e.transDocNo = "transDocNoMissing";
  if (docDate) {
    if (!isIsoDate(docDate)) e.transDocDate = "transDocDate";
    else if (daysBetween(docDate, opts.today) < 0) e.transDocDate = "transDocDateFuture";
    else if (opts.docDate && daysBetween(opts.docDate, docDate) < 0) e.transDocDate = "transDocDateBeforeBill";
  }

  if (road) {
    if (!veh && !transId) e.vehicleNo ??= "vehicleRequired";
  } else if (!docNo) {
    e.transDocNo ??= "transDocRequired";
  }
  return e;
}

/** POST /invoices/:id/ewb body. Vehicle fields only for road; `standalone` when the bill has no active IRN. */
export function ewbRequestBody(f: EwbForm, standalone: boolean) {
  const road = f.transMode === 1;
  const s = (v: string) => (v.trim() ? v.trim() : undefined);
  const vehicleNo = road && f.vehicleNo.trim() ? normalizeVehicleNo(f.vehicleNo) : undefined;
  return {
    distance: Number(f.distance.trim() || "0"),
    transMode: f.transMode,
    transporterId: f.transporterId.trim() ? normalizeTransporterId(f.transporterId) : undefined,
    transporterName: s(f.transporterName),
    transDocNo: s(f.transDocNo),
    transDocDate: s(f.transDocDate),
    vehicleNo,
    vehicleType: vehicleNo ? f.vehicleType : undefined,
    ...(standalone ? { standalone: true } : {}),
  };
}

// ------------------------------------------------------------------ cancel window

export interface CancelWindow {
  open: boolean;
  /** Milliseconds left (0 when closed). */
  msLeft: number;
  until: Date | null;
}

/** Whether an IRN can still be cancelled at `now` (server sends `cancellableUntil`; null = not active). */
export function cancelWindow(until: string | Date | null | undefined, now: Date): CancelWindow {
  if (!until) return { open: false, msLeft: 0, until: null };
  const u = until instanceof Date ? until : new Date(until);
  if (Number.isNaN(u.getTime())) return { open: false, msLeft: 0, until: null };
  const left = u.getTime() - now.getTime();
  return { open: left > 0, msLeft: Math.max(0, left), until: u };
}

/** { hours, minutes } left, rounded up to the minute. */
export function splitDuration(ms: number): { hours: number; minutes: number } {
  const mins = Math.ceil(Math.max(0, ms) / 60_000);
  return { hours: Math.floor(mins / 60), minutes: mins % 60 };
}

// ------------------------------------------------------------------ GSTR-1 periods

export interface Period {
  /** "MMYYYY" as GSTN uses it. */
  value: string;
  year: number;
  /** 1–12. */
  month: number;
}

const ist = (now: Date) => new Date(now.getTime() + 330 * 60_000);

/** The last `count` months before the current IST month (newest first; the current month is included only with `includeCurrent`). */
export function gstr1Periods(now: Date, count = 18, includeCurrent = true): Period[] {
  const d = ist(now);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth() + 1;
  if (!includeCurrent) {
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  const out: Period[] = [];
  for (let i = 0; i < count; i++) {
    if (y < 2017 || (y === 2017 && m < 7)) break; // GST started July 2017
    out.push({ value: `${String(m).padStart(2, "0")}${y}`, year: y, month: m });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** Last month (IST) as "MMYYYY" — the return usually being filed. */
export const defaultGstr1Period = (now: Date) => gstr1Periods(now, 1, false)[0]!.value;

// ------------------------------------------------------------------ timeline

export type TimelineKind = "generated" | "failed" | "cancelled" | "ewbGenerated" | "ewbCancelled";

export interface TimelineEvent {
  key: string;
  kind: TimelineKind;
  at: string;
  /** Failure message, cancel reason code or e-way bill number. */
  detail: string | null;
  /** Cancel reason code (1–4) when known. */
  reason?: CancelReasonCode;
  remark?: string | null;
  mock: boolean;
}

const asReason = (v: string | null | undefined): CancelReasonCode | undefined => {
  const n = Number(v);
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : undefined;
};

/** Every IRN / e-way bill event in the records, newest first. */
export function einvoiceTimeline(history: readonly EInvoiceRecord[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const r of history) {
    if (r.status === "failed") {
      out.push({ key: `${r.id}:f`, kind: "failed", at: r.createdAt, detail: r.error?.message ?? null, mock: r.mock });
    } else if (r.status !== "ewb_only" && r.irn) {
      out.push({ key: `${r.id}:g`, kind: "generated", at: r.ackDate ?? r.createdAt, detail: r.ackNo, mock: r.mock });
    }
    if (r.status === "cancelled") {
      out.push({
        key: `${r.id}:c`,
        kind: "cancelled",
        at: r.cancelledAt ?? r.createdAt,
        detail: r.cancelReason,
        reason: asReason(r.cancelReason),
        remark: r.cancelRemark,
        mock: r.mock,
      });
    }
    if (r.ewbNo) {
      out.push({ key: `${r.id}:e`, kind: "ewbGenerated", at: r.ewbDate ?? r.createdAt, detail: r.ewbNo, mock: r.mock });
      if (r.ewbStatus === "cancelled" || r.ewbCancelledAt) {
        out.push({ key: `${r.id}:ec`, kind: "ewbCancelled", at: r.ewbCancelledAt ?? r.ewbDate ?? r.createdAt, detail: r.ewbNo, mock: r.mock });
      }
    }
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Blocking errors and non-blocking warnings of a preview. */
export function splitIssues(issues: readonly EInvoiceIssue[] | null | undefined) {
  const list = issues ?? [];
  return { errors: list.filter((i) => i.severity === "error"), warnings: list.filter((i) => i.severity !== "error") };
}
