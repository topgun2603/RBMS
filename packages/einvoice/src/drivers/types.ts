import type { CancelEwbPayload, CancelIrnPayload, EwbByIrnPayload, EwbStandalonePayload } from "../ewb";
import type { EInvoicePayload } from "../nic";
import type { DocType } from "../ports";

export const EINVOICE_PROVIDERS = ["mock", "gsp"] as const;
export type EInvoiceProvider = (typeof EINVOICE_PROVIDERS)[number];

/** IRN details as NIC returns them (AckDt etc. are NIC IST strings "YYYY-MM-DD HH:mm:ss"). */
export interface IrnResult {
  irn: string;
  ackNo: string;
  ackDate: string;
  /** Signed JWT of the invoice (mock: base64url JSON). */
  signedInvoice: string | null;
  /** Signed JWT for the QR code (mock: base64url JSON, unsigned, `mock: true`). */
  signedQrCode: string | null;
  /** "ACT" active, "CNL" cancelled. */
  status: "ACT" | "CNL";
  ewbNo?: string | null;
  ewbDate?: string | null;
  ewbValidTill?: string | null;
  /** True for results of the mock driver. */
  mock?: boolean;
}

export interface CancelIrnResult {
  irn: string;
  cancelDate: string;
}

export interface EwbResult {
  ewbNo: string;
  ewbDate: string;
  ewbValidTill: string | null;
}

export interface CancelEwbResult {
  ewbNo: string;
  cancelDate: string;
}

export type EwbRequest = { kind: "irn"; payload: EwbByIrnPayload } | { kind: "standalone"; payload: EwbStandalonePayload };

/** One e-invoice provider. Instances are per account (they hold the shop's credentials). */
export interface EInvoiceDriver {
  readonly provider: EInvoiceProvider;
  /** Logs in (or checks the credentials). Throws `EInvoiceError` kind "auth" when rejected. */
  authenticate(): Promise<void>;
  generateIrn(payload: EInvoicePayload): Promise<IrnResult>;
  cancelIrn(payload: CancelIrnPayload): Promise<CancelIrnResult>;
  /** Null when NIC has no such IRN (or no longer serves it). */
  getByIrn(irn: string): Promise<IrnResult | null>;
  /** IRN lookup by document (used to recover from a duplicate IRN without details). `docDate` "DD/MM/YYYY". */
  getByDocument?(docType: DocType, docNo: string, docDate: string): Promise<IrnResult | null>;
  generateEwb(req: EwbRequest): Promise<EwbResult>;
  cancelEwb(payload: CancelEwbPayload): Promise<CancelEwbResult>;
}

export type EInvoiceErrorKind =
  /** Bad credentials / token (NIC 1005, 1004…). */
  | "auth"
  /** NIC 2150: an IRN already exists for this document; `existing` carries what NIC returned. */
  | "duplicate_irn"
  /** NIC 2270 / e-way bill 312…: outside the 24 h cancellation window. */
  | "cancel_window"
  /** NIC 9999 / 2143: the IRN / e-way bill is not active (already cancelled). */
  | "not_active"
  /** NIC 3028 / 3029 / 2176 …: a GSTIN is unknown or inactive. */
  | "invalid_gstin"
  /** The provider rejected the data (schema / business rule). */
  | "validation"
  /** Timeout, DNS, 5xx. */
  | "network"
  | "provider";

/** A provider refused or failed a request. The service maps it to an HTTP error. */
export class EInvoiceError extends Error {
  constructor(
    readonly kind: EInvoiceErrorKind,
    message: string,
    readonly opts: {
      /** NIC error code, e.g. "2150". */
      code?: string | null;
      /** All errors the provider returned. */
      errors?: { code: string | null; message: string }[];
      existing?: { irn: string; ackNo: string | null; ackDate: string | null } | null;
      httpStatus?: number;
      details?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "EInvoiceError";
  }
  get code() {
    return this.opts.code ?? null;
  }
}

/** NIC / GSP error codes we recognise → kinds. Anything else with a code is "validation". */
export const NIC_ERROR_KINDS: Record<string, EInvoiceErrorKind> = {
  "1004": "auth", // header GSTIN / user name missing or wrong
  "1005": "auth", // invalid token
  "2150": "duplicate_irn", // duplicate IRN
  "2270": "cancel_window", // allowed cancellation time limit crossed
  "9999": "not_active", // invoice is not active (already cancelled)
  "3028": "invalid_gstin", // GSTIN not present in the taxpayer master
  "3029": "invalid_gstin", // GSTIN is not active
  // GSPs add their own codes; extend per deployment with `GspOptions.errorKinds`.
};

export const kindForCode = (code: string | null | undefined, map: Record<string, EInvoiceErrorKind> = NIC_ERROR_KINDS): EInvoiceErrorKind =>
  code ? (map[code] ?? "validation") : "provider";
