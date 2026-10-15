import type { CancelEwbPayload, CancelIrnPayload } from "../ewb";
import { parseNicDateTime } from "../gst";
import type { EInvoicePayload } from "../nic";
import type { DocType } from "../ports";
import {
  EInvoiceError,
  kindForCode,
  NIC_ERROR_KINDS,
  type CancelEwbResult,
  type CancelIrnResult,
  type EInvoiceDriver,
  type EInvoiceErrorKind,
  type EwbRequest,
  type EwbResult,
  type IrnResult,
} from "./types";

/**
 * Configurable GSP adapter for plain-JSON e-invoice APIs (Masters India / ClearTax / NIC-proxy style). The GSP does
 * the NIC payload encryption; we send the NIC JSON as-is. Paths may contain `{irn}`, `{docType}`, `{docNo}`,
 * `{docDate}` placeholders (URL-encoded on substitution).
 */
export interface GspEndpoints {
  auth: string;
  generateIrn: string;
  cancelIrn: string;
  getByIrn: string;
  getByDocument: string;
  generateEwb: string;
  generateEwbStandalone: string;
  cancelEwb: string;
}

/** NIC-like defaults; override per GSP in the module config. */
export const DEFAULT_GSP_ENDPOINTS: GspEndpoints = {
  auth: "/eivital/v1.04/auth",
  generateIrn: "/eicore/v1.03/Invoice",
  cancelIrn: "/eicore/v1.03/Invoice/Cancel",
  getByIrn: "/eicore/v1.03/Invoice/irn/{irn}",
  getByDocument: "/eicore/v1.03/Invoice/irnbydocdetails?doctype={docType}&docnum={docNo}&docdate={docDate}",
  generateEwb: "/eiewb/v1.03/ewaybill",
  generateEwbStandalone: "/ewaybillapi/v1.03/ewayapi/genewaybill",
  cancelEwb: "/ewaybillapi/v1.03/ewayapi/canewb",
};

export interface GspCredentials {
  gstin: string;
  username: string;
  password: string;
  clientId?: string | null;
  clientSecret?: string | null;
}

export interface CachedToken {
  token: string;
  /** Epoch ms. */
  expiresAt: number;
}

export interface TokenCache {
  get(key: string): CachedToken | undefined;
  set(key: string, value: CachedToken): void;
  delete(key: string): void;
}

export const memoryTokenCache = (): TokenCache => {
  const m = new Map<string, CachedToken>();
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v), delete: (k) => void m.delete(k) };
};

/** A provider response, normalised. */
export interface GspEnvelope {
  ok: boolean;
  data: Record<string, unknown> | null;
  errors: { code: string | null; message: string }[];
  /** NIC `InfoDtls`, e.g. `{ code: "DUPIRN", desc: { Irn, AckNo, AckDt } }`. */
  info: { code: string; desc: unknown }[];
}

export interface GspOptions {
  baseUrl: string;
  endpoints?: Partial<GspEndpoints>;
  credentials: GspCredentials;
  /** Static headers every request carries (e.g. a GSP subscription key). */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  /** Default 30 s. */
  timeoutMs?: number;
  tokenCache?: TokenCache;
  /** Used when the auth response has no expiry. Default 5 h 30 min (NIC tokens live 6 h). */
  tokenTtlMs?: number;
  now?: () => Date;
  /** Extra / overriding error code → kind entries. */
  errorKinds?: Record<string, EInvoiceErrorKind>;
  /** Body of the auth request. */
  authBody?: (c: GspCredentials) => unknown;
  /** Reads the token from the auth response. */
  readToken?: (body: unknown, now: Date) => CachedToken | null;
  /** Normalises a response body. */
  parse?: (body: unknown) => GspEnvelope;
}

// ------------------------------------------------------------------ parsing helpers

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const maybeJson = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return v;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
};

/** Case-insensitive field lookup over several candidate names. */
export function pick(o: unknown, ...names: string[]): unknown {
  if (!isObj(o)) return undefined;
  for (const n of names) {
    if (n in o && o[n] !== undefined && o[n] !== null) return o[n];
    const k = Object.keys(o).find((x) => x.toLowerCase() === n.toLowerCase());
    if (k && o[k] !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
}

const str = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v));

/** "2150 : Duplicate IRN" / "[2150] Duplicate IRN" → { code: "2150", message }. */
function splitCodeMessage(text: string): { code: string | null; message: string } {
  const m = /^\s*\[?(\d{3,5})\]?\s*[:\-–]?\s*(.*)$/s.exec(text);
  return m ? { code: m[1]!, message: m[2]!.trim() || text } : { code: null, message: text };
}

function readErrors(raw: unknown): { code: string | null; message: string }[] {
  const v = maybeJson(raw);
  if (v === undefined || v === null || v === "") return [];
  if (typeof v === "string") return [splitCodeMessage(v)];
  const arr = Array.isArray(v) ? v : [v];
  return arr.flatMap((e) => {
    if (typeof e === "string") return [splitCodeMessage(e)];
    if (!isObj(e)) return [];
    const code = str(pick(e, "ErrorCode", "errorCode", "error_code", "code"));
    const message = str(pick(e, "ErrorMessage", "errorMessage", "message", "error_description", "msg")) ?? "Request failed";
    if (code) return [{ code, message }];
    return [splitCodeMessage(message)];
  });
}

function readInfo(raw: unknown): { code: string; desc: unknown }[] {
  const v = maybeJson(raw);
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((i) => ({ code: String(pick(i, "InfCd", "infCd", "code") ?? ""), desc: maybeJson(pick(i, "Desc", "desc")) }));
}

/**
 * Default response parser. Understands NIC's `{ Status, Data, ErrorDetails, InfoDtls }` (Data may be a JSON string),
 * Masters India's `{ results: { status, message, errorMessage, code, InfoDtls } }` and generic `{ success, data, error }`.
 */
export function parseGspEnvelope(body: unknown): GspEnvelope {
  if (!isObj(body)) return { ok: false, data: null, errors: [{ code: null, message: "Unexpected response from the e-invoice provider" }], info: [] };
  const results = pick(body, "results");
  if (isObj(results)) {
    const status = String(pick(results, "status") ?? "").toLowerCase();
    const msg = maybeJson(pick(results, "message"));
    const ok = status === "success" || status === "1";
    const errText = pick(results, "errorMessage", "error");
    const errors = ok ? [] : readErrors(errText ?? (typeof msg === "string" ? msg : "Request failed"));
    return { ok, data: isObj(msg) ? msg : null, errors, info: readInfo(pick(results, "InfoDtls") ?? (isObj(msg) ? pick(msg, "InfoDtls") : undefined)) };
  }
  const statusRaw = pick(body, "Status", "status", "success");
  const data = maybeJson(pick(body, "Data", "data", "result"));
  const ok = statusRaw === true || statusRaw === 1 || statusRaw === "1" || String(statusRaw).toLowerCase() === "success";
  const errors = ok ? [] : readErrors(pick(body, "ErrorDetails", "errorDetails", "errors", "error", "message"));
  return {
    ok,
    data: isObj(data) ? data : null,
    errors: ok ? [] : errors.length ? errors : [{ code: null, message: "Request failed" }],
    info: readInfo(pick(body, "InfoDtls", "infoDtls") ?? (isObj(data) ? pick(data, "InfoDtls") : undefined)),
  };
}

/** Default token reader: AuthToken / token / access_token at the top or under data / Data / results.message. */
export function readGspToken(body: unknown, now: Date, ttlMs = 5.5 * 3_600_000): CachedToken | null {
  const places = [body, pick(body, "Data", "data"), pick(pick(body, "results"), "message")].map(maybeJson);
  for (const p of places) {
    const token = str(pick(p, "AuthToken", "authToken", "token", "access_token", "accessToken"));
    if (!token) continue;
    const expiry = pick(p, "TokenExpiry", "tokenExpiry", "expiry");
    const expiresIn = Number(pick(p, "expires_in", "expiresIn"));
    let expiresAt = now.getTime() + ttlMs;
    const parsed = typeof expiry === "string" ? parseNicDateTime(expiry) : null;
    if (parsed) expiresAt = parsed.getTime() - 5 * 60_000;
    else if (Number.isFinite(expiresIn) && expiresIn > 0) expiresAt = now.getTime() + expiresIn * 1000 - 5 * 60_000;
    return { token, expiresAt };
  }
  return null;
}

export function toIrnResult(d: Obj): IrnResult {
  const status = String(pick(d, "Status", "status") ?? "ACT").toUpperCase();
  return {
    irn: String(pick(d, "Irn", "irn") ?? ""),
    ackNo: String(pick(d, "AckNo", "ackNo") ?? ""),
    ackDate: String(pick(d, "AckDt", "ackDt", "AckDate") ?? ""),
    signedInvoice: str(pick(d, "SignedInvoice", "signedInvoice")),
    signedQrCode: str(pick(d, "SignedQRCode", "signedQRCode", "SignedQrCode")),
    status: status === "CNL" || status === "CANCELLED" ? "CNL" : "ACT",
    ewbNo: str(pick(d, "EwbNo", "ewbNo")),
    ewbDate: str(pick(d, "EwbDt", "ewbDt")),
    ewbValidTill: str(pick(d, "EwbValidTill", "ewbValidTill")),
  };
}

// ------------------------------------------------------------------ driver

export class GspDriver implements EInvoiceDriver {
  readonly provider = "gsp" as const;
  private readonly endpoints: GspEndpoints;
  private readonly fetchFn: typeof fetch;
  private readonly cache: TokenCache;
  private readonly now: () => Date;
  private readonly kinds: Record<string, EInvoiceErrorKind>;
  private readonly parse: (body: unknown) => GspEnvelope;

  constructor(private readonly opts: GspOptions) {
    this.endpoints = { ...DEFAULT_GSP_ENDPOINTS, ...opts.endpoints };
    this.fetchFn = opts.fetch ?? fetch;
    this.cache = opts.tokenCache ?? memoryTokenCache();
    this.now = opts.now ?? (() => new Date());
    this.kinds = { ...NIC_ERROR_KINDS, ...opts.errorKinds };
    this.parse = opts.parse ?? parseGspEnvelope;
  }

  private get cacheKey() {
    const c = this.opts.credentials;
    return `${this.opts.baseUrl}|${c.gstin}|${c.username}`;
  }

  private url(path: string, vars: Record<string, string> = {}) {
    const p = path.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(vars[k] ?? ""));
    return `${this.opts.baseUrl.replace(/\/+$/, "")}${p.startsWith("/") ? p : `/${p}`}`;
  }

  private baseHeaders(): Record<string, string> {
    const c = this.opts.credentials;
    const h: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      gstin: c.gstin,
      user_name: c.username,
      ...this.opts.headers,
    };
    if (c.clientId) h.client_id = c.clientId;
    if (c.clientSecret) h.client_secret = c.clientSecret;
    return h;
  }

  private async send(method: "GET" | "POST", url: string, headers: Record<string, string>, body?: unknown): Promise<{ status: number; body: unknown }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 30_000);
    let res: Response;
    try {
      res = await this.fetchFn(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    } catch (err) {
      throw new EInvoiceError("network", "Could not reach the e-invoice provider", { details: String((err as Error)?.message ?? err) });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (res.status >= 500 && !isObj(parsed))
      throw new EInvoiceError("network", `E-invoice provider error (HTTP ${res.status})`, { httpStatus: res.status });
    return { status: res.status, body: parsed };
  }

  private async token(force = false): Promise<string> {
    const key = this.cacheKey;
    const now = this.now();
    const hit = force ? undefined : this.cache.get(key);
    if (hit && hit.expiresAt > now.getTime()) return hit.token;
    const c = this.opts.credentials;
    const body = this.opts.authBody
      ? this.opts.authBody(c)
      : { username: c.username, password: c.password, client_id: c.clientId ?? undefined, client_secret: c.clientSecret ?? undefined, gstin: c.gstin };
    const res = await this.send("POST", this.url(this.endpoints.auth), this.baseHeaders(), body);
    const tok = this.opts.readToken ? this.opts.readToken(res.body, now) : readGspToken(res.body, now, this.opts.tokenTtlMs);
    if (!tok) {
      const env = this.parse(res.body);
      const e = env.errors[0];
      throw new EInvoiceError("auth", e?.message ?? "The e-invoice provider rejected the login", {
        code: e?.code ?? null,
        errors: env.errors,
        httpStatus: res.status,
      });
    }
    this.cache.set(key, tok);
    return tok.token;
  }

  /** Calls an endpoint; re-authenticates once on 401 / auth error codes. Returns the envelope's data. */
  private async call(endpoint: keyof GspEndpoints, method: "GET" | "POST", body?: unknown, vars?: Record<string, string>): Promise<Obj> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.token(attempt > 0);
      const headers = { ...this.baseHeaders(), authtoken: token, authorization: `Bearer ${token}` };
      const res = await this.send(method, this.url(this.endpoints[endpoint], vars), headers, body);
      const env = this.parse(res.body);
      if (env.ok && res.status < 400) return env.data ?? {};
      const first = env.errors[0];
      const kind: EInvoiceErrorKind = res.status === 401 || res.status === 403 ? "auth" : kindForCode(first?.code, this.kinds);
      if (kind === "auth" && attempt === 0) {
        this.cache.delete(this.cacheKey);
        continue;
      }
      let existing: { irn: string; ackNo: string | null; ackDate: string | null } | null = null;
      if (kind === "duplicate_irn") {
        const dup = env.info.find((i) => i.code.toUpperCase() === "DUPIRN") ?? env.info[0];
        const src = isObj(dup?.desc) ? dup.desc : (env.data ?? {});
        const irn = str(pick(src, "Irn", "irn"));
        if (irn) existing = { irn, ackNo: str(pick(src, "AckNo", "ackNo")), ackDate: str(pick(src, "AckDt", "ackDt")) };
      }
      throw new EInvoiceError(kind, first?.message ?? `E-invoice provider error (HTTP ${res.status})`, {
        code: first?.code ?? null,
        errors: env.errors,
        existing,
        httpStatus: res.status,
      });
    }
  }

  async authenticate(): Promise<void> {
    await this.token(true);
  }

  async generateIrn(payload: EInvoicePayload): Promise<IrnResult> {
    return toIrnResult(await this.call("generateIrn", "POST", payload));
  }

  async cancelIrn(payload: CancelIrnPayload): Promise<CancelIrnResult> {
    const d = await this.call("cancelIrn", "POST", payload);
    return { irn: String(pick(d, "Irn", "irn") ?? payload.Irn), cancelDate: String(pick(d, "CancelDate", "cancelDate") ?? "") };
  }

  async getByIrn(irn: string): Promise<IrnResult | null> {
    try {
      const d = await this.call("getByIrn", "GET", undefined, { irn });
      return pick(d, "Irn", "irn") ? toIrnResult(d) : null;
    } catch (err) {
      if (err instanceof EInvoiceError && err.kind === "validation") return null;
      throw err;
    }
  }

  async getByDocument(docType: DocType, docNo: string, docDate: string): Promise<IrnResult | null> {
    try {
      const d = await this.call("getByDocument", "GET", undefined, { docType, docNo, docDate });
      return pick(d, "Irn", "irn") ? toIrnResult(d) : null;
    } catch (err) {
      if (err instanceof EInvoiceError && err.kind === "validation") return null;
      throw err;
    }
  }

  async generateEwb(req: EwbRequest): Promise<EwbResult> {
    const d = await this.call(req.kind === "irn" ? "generateEwb" : "generateEwbStandalone", "POST", req.payload);
    const ewbNo = str(pick(d, "EwbNo", "ewayBillNo", "ewbNo"));
    if (!ewbNo) throw new EInvoiceError("provider", "The provider did not return an e-way bill number", { details: d });
    return {
      ewbNo,
      ewbDate: String(pick(d, "EwbDt", "ewayBillDate", "ewbDate") ?? ""),
      ewbValidTill: str(pick(d, "EwbValidTill", "validUpto", "ewbValidTill")),
    };
  }

  async cancelEwb(payload: CancelEwbPayload): Promise<CancelEwbResult> {
    const d = await this.call("cancelEwb", "POST", payload);
    return {
      ewbNo: String(pick(d, "ewayBillNo", "EwbNo", "ewbNo") ?? payload.ewbNo),
      cancelDate: String(pick(d, "cancelDate", "CancelDate") ?? ""),
    };
  }
}
