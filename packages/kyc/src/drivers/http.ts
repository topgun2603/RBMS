import { last4, scrubPii } from "../mask";
import {
  KycProviderError,
  type BankInput,
  type DigilockerStartInput,
  type DriverOutcome,
  type GstinInput,
  type KycDriver,
  type PanInput,
  type SelfieInput,
  type UpiInput,
} from "./types";

export const HTTP_ENDPOINTS = ["pan", "gstin", "bank", "upi", "digilockerStart", "digilockerFetch", "selfie"] as const;
export type HttpEndpoint = (typeof HTTP_ENDPOINTS)[number];

/** Surepass-style paths (relative to `baseUrl`). `{ref}` is replaced with the DigiLocker client id. */
export const DEFAULT_HTTP_PATHS: Record<HttpEndpoint, string> = {
  pan: "/api/v1/pan/pan-comprehensive",
  gstin: "/api/v1/corporate/gstin",
  bank: "/api/v1/bank-verification/",
  upi: "/api/v1/bank-verification/upi-verification",
  digilockerStart: "/api/v1/digilocker/initialize",
  digilockerFetch: "/api/v1/digilocker/download-aadhaar/{ref}",
  selfie: "/api/v1/face/face-match",
};

/** Turns a provider response body (HTTP 2xx, or a 4xx that is a provider answer) into an outcome. */
export type ResponseMapper = (json: unknown, httpStatus: number) => DriverOutcome;

export interface HttpProviderConfig {
  /** e.g. `https://kyc-api.surepass.io` (no trailing slash needed). */
  baseUrl: string;
  /** Bearer token (platform-wide, from the host's config — never per tenant). */
  token: string;
  /** Stored on each check; default `http`. Use the vendor's name, e.g. `surepass`. */
  provider?: string;
  /** Per-request timeout; default 15 s. */
  timeoutMs?: number;
  /** Path overrides, e.g. for an IDfy-like provider. */
  paths?: Partial<Record<HttpEndpoint, string>>;
  /** Response mapping overrides (defaults understand the Surepass `{ success, data, message_code }` envelope). */
  mappers?: Partial<Record<HttpEndpoint, ResponseMapper>>;
  /** Extra headers (e.g. an account id header some providers need). */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

// ---------------------------------------------------------------- mapping helpers

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const data = (json: unknown) => obj(obj(json).data);
const succeeded = (json: unknown, status: number) => status < 300 && obj(json).success !== false;
const errorCode = (json: unknown, fallback: string) => {
  const j = obj(json);
  const code = str(j.message_code) ?? str(j.error_code) ?? str(j.code);
  return code ? code.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60) : fallback;
};
const failed = (json: unknown, fallback: string, details: Obj = {}): DriverOutcome => ({
  status: "failed",
  name: null,
  details,
  error: errorCode(json, fallback),
});
const verified = (name: string | null, details: Obj, providerRef?: string | null): DriverOutcome => ({
  status: "verified",
  name,
  details: scrubPii(details) as Obj,
  providerRef: providerRef ?? null,
});
const yearOf = (dob: unknown) => {
  const m = /(\d{4})/.exec(str(dob) ?? "");
  return m ? Number(m[1]) : null;
};

/** Default mappers for a Surepass-like API. */
export const SUREPASS_MAPPERS: Record<HttpEndpoint, ResponseMapper> = {
  pan(json, status) {
    const d = data(json);
    const name = str(d.full_name) ?? str(d.name);
    if (!succeeded(json, status) || !name) return failed(json, "invalid_pan");
    return verified(name, { category: str(d.category), aadhaarLinked: d.aadhaar_linked ?? null, panStatus: str(d.status) }, str(d.client_id));
  },
  gstin(json, status) {
    const d = data(json);
    if (!succeeded(json, status)) return failed(json, "gstin_not_found");
    const gstStatus = str(d.gstin_status) ?? str(d.status);
    const legalName = str(d.legal_name) ?? str(d.business_name);
    const details = {
      gstStatus,
      legalName,
      tradeName: str(d.business_name) ?? str(d.trade_name),
      constitution: str(d.constitution_of_business),
      taxpayerType: str(d.taxpayer_type),
      registrationDate: str(d.date_of_registration),
      stateCode: str(d.gstin)?.slice(0, 2) ?? null,
    };
    if (!gstStatus || !/^active/i.test(gstStatus)) return { ...failed(json, "gstin_inactive", details), error: "gstin_inactive" };
    return verified(legalName, details, str(d.client_id));
  },
  bank(json, status) {
    const d = data(json);
    const ifsc = obj(d.ifsc_details);
    const details = { bankName: str(ifsc.bank_name) ?? str(ifsc.bank), branch: str(ifsc.branch), ifsc: str(ifsc.ifsc) };
    if (!succeeded(json, status) || d.account_exists !== true) return failed(json, "account_not_found", scrubPii(details) as Obj);
    return verified(str(d.full_name) ?? str(d.name_at_bank), details, str(d.client_id));
  },
  upi(json, status) {
    const d = data(json);
    if (!succeeded(json, status) || d.account_exists === false || !str(d.full_name)) return failed(json, "vpa_not_found");
    return verified(str(d.full_name), {}, str(d.client_id));
  },
  digilockerStart(json, status) {
    const d = data(json);
    const ref = str(d.client_id) ?? str(d.request_id);
    const url = str(d.url) ?? str(d.redirect_url);
    if (!succeeded(json, status) || !ref || !url) return failed(json, "digilocker_unavailable");
    return { status: "pending", name: null, details: {}, providerRef: ref, actionUrl: url };
  },
  digilockerFetch(json, status) {
    const d = data(json);
    const a = obj(d.aadhaar_xml_data);
    if (!succeeded(json, status)) {
      const code = errorCode(json, "digilocker_failed");
      // Providers answer "not yet" with a 4xx; keep the check pending.
      if (/pending|not_?(yet|completed)|in_?progress/.test(code)) return { status: "pending", name: null, details: {} };
      return failed(json, "digilocker_failed");
    }
    const name = str(a.full_name) ?? str(a.name);
    if (!name) return { status: "pending", name: null, details: {} };
    const masked = str(a.masked_aadhaar) ?? str(a.aadhaar_number) ?? "";
    return verified(name, {
      aadhaarLast4: last4(masked),
      gender: str(a.gender),
      yearOfBirth: yearOf(a.dob),
      state: str(obj(a.full_address).state) ?? str(obj(a.address).state),
    });
  },
  selfie(json, status) {
    const d = data(json);
    const raw = typeof d.confidence === "number" ? d.confidence : Number(str(d.confidence));
    const score = Number.isFinite(raw) ? Math.round(raw <= 1 ? raw * 100 : raw) : null;
    if (!succeeded(json, status)) return { ...failed(json, "face_match_failed"), score };
    if (d.match_status !== true) return { status: "failed", name: null, details: { confidence: score }, error: "face_mismatch", score };
    return { ...verified(null, { confidence: score, liveness: d.liveness ?? null }), score };
  },
};

// ---------------------------------------------------------------- driver

/**
 * Generic REST adapter (Surepass / IDfy-like): `POST baseUrl + path` with `Authorization: Bearer <token>` and a JSON body.
 * 2xx and 400/404/422 responses are provider answers (mapped to verified/failed); 401/403, 429, 5xx, timeouts and
 * network errors throw `KycProviderError`. Request bodies (they carry raw identifiers) are never logged or kept.
 */
export class HttpKycDriver implements KycDriver {
  readonly provider: string;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly paths: Record<HttpEndpoint, string>;
  private readonly mappers: Record<HttpEndpoint, ResponseMapper>;

  constructor(private readonly config: HttpProviderConfig) {
    if (!config.baseUrl) throw new Error("kyc http provider: baseUrl is required");
    if (!config.token) throw new Error("kyc http provider: token is required");
    this.provider = config.provider ?? "http";
    this.fetchFn = config.fetch ?? globalThis.fetch;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.paths = { ...DEFAULT_HTTP_PATHS, ...(config.paths ?? {}) };
    this.mappers = { ...SUREPASS_MAPPERS, ...(config.mappers ?? {}) };
  }

  verifyPan({ pan }: PanInput) {
    return this.call("pan", "POST", { id_number: pan });
  }
  verifyGstin({ gstin }: GstinInput) {
    return this.call("gstin", "POST", { id_number: gstin });
  }
  async verifyBankAccount({ accountNumber, ifsc }: BankInput) {
    const out = await this.call("bank", "POST", { id_number: accountNumber, ifsc, ifsc_details: true });
    return { ...out, details: { ...out.details, ifsc: out.details.ifsc ?? ifsc, accountLast4: last4(accountNumber) } };
  }
  verifyUpi({ vpa }: UpiInput) {
    return this.call("upi", "POST", { upi_id: vpa });
  }
  startDigilocker({ redirectUrl }: DigilockerStartInput) {
    return this.call("digilockerStart", "POST", { data: { signup_flow: true, ...(redirectUrl ? { redirect_url: redirectUrl } : {}) } });
  }
  async fetchDigilocker(providerRef: string) {
    const out = await this.call("digilockerFetch", "GET", undefined, providerRef);
    return { ...out, providerRef };
  }
  matchSelfie({ selfieUrl, referenceUrl }: SelfieInput) {
    return this.call("selfie", "POST", { selfie_url: selfieUrl, ...(referenceUrl ? { id_card_url: referenceUrl } : {}) });
  }

  private async call(endpoint: HttpEndpoint, method: "GET" | "POST", body?: unknown, ref?: string): Promise<DriverOutcome> {
    const path = this.paths[endpoint].replace("{ref}", encodeURIComponent(ref ?? ""));
    const url = `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.config.token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(this.config.headers ?? {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
    } catch (err) {
      const aborted = ctl.signal.aborted || (err as { name?: string })?.name === "AbortError";
      throw new KycProviderError(
        this.provider,
        0,
        aborted ? `KYC provider timed out after ${this.timeoutMs} ms (${endpoint})` : `KYC provider unreachable (${endpoint})`,
        aborted ? "timeout" : "network",
      );
    } finally {
      clearTimeout(timer);
    }

    const status = res.status;
    if (status === 401 || status === 403) throw new KycProviderError(this.provider, status, "KYC provider rejected the token", "unauthorized");
    if (status === 429) throw new KycProviderError(this.provider, status, "KYC provider rate limit", "rate_limited");
    if (status >= 500) throw new KycProviderError(this.provider, status, `KYC provider error ${status} (${endpoint})`, "server_error");

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new KycProviderError(this.provider, status, `KYC provider returned non-JSON (${endpoint})`, "bad_response");
    }
    if (status >= 300 && ![400, 404, 409, 422].includes(status)) {
      throw new KycProviderError(this.provider, status, `KYC provider HTTP ${status} (${endpoint})`, "bad_response");
    }
    return this.mappers[endpoint](json, status);
  }
}
