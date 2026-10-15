import { createHash } from "node:crypto";
import { last4 } from "../mask";
import { PAN_ENTITY_TYPES, type PanEntityCode } from "../validators";
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

/** Name the mock returns for its "happy" identifiers. */
export const MOCK_NAME = "TEST NAME";
/** The PAN the mock knows by name. */
export const MOCK_PAN = "ABCDE1234F";
/** Name the mock returns for "someone else's" bank / UPI account (forces a name mismatch). */
export const MOCK_OTHER_NAME = "SOMEONE ELSE";

const ok = (name: string | null, details: Record<string, unknown>, extra: Partial<DriverOutcome> = {}): DriverOutcome => ({
  status: "verified",
  name,
  details,
  ...extra,
});
const fail = (error: string, details: Record<string, unknown> = {}): DriverOutcome => ({ status: "failed", name: null, details, error });
const outage = (): never => {
  throw new KycProviderError("mock", 503, "Mock provider unavailable", "server_error");
};
const upper = (s: string | null | undefined) => (s?.trim() ? s.trim().toUpperCase() : null);
const ref = (prefix: string, value: string) => `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;

/**
 * Deterministic provider for development and tests. No network. Outcomes:
 *
 * | check | input | outcome |
 * |---|---|---|
 * | PAN | `ABCDE1234F` | verified, name `TEST NAME` |
 * | PAN | ends in `Z` | failed `invalid_pan` |
 * | PAN | ends in `Y` | throws `KycProviderError` 503 (provider outage) |
 * | PAN | anything else | verified, name = the given `name` (upper-cased) or `TEST NAME` |
 * | GSTIN | embedded PAN ends in `Z` | failed `gstin_not_found` |
 * | GSTIN | embedded PAN ends in `Y` | failed `gstin_inactive` (status Cancelled) |
 * | GSTIN | anything else | verified, legal name `TEST NAME`, trade name `TEST TRADERS`, status Active |
 * | bank | account ends in `0000` | failed `account_not_found` |
 * | bank | account ends in `9999` | verified, holder `SOMEONE ELSE` (name mismatch → manual review) |
 * | bank | anything else | verified, holder = given `name` or `TEST NAME`, bank from the IFSC prefix |
 * | UPI | VPA starts with `fail` | failed `vpa_not_found` |
 * | UPI | VPA starts with `other` | verified, name `SOMEONE ELSE` |
 * | UPI | anything else | verified, name = given `name` or `TEST NAME` |
 * | DigiLocker start | any | pending, `providerRef` `mockdl_<name>`, consent URL |
 * | DigiLocker fetch | started with a name ending in `Z` | failed `consent_denied` |
 * | DigiLocker fetch | otherwise | verified, name = the start name or `TEST NAME`, Aadhaar last 4 `1234` |
 * | selfie | URL contains `fail` | failed `face_mismatch`, score 20 |
 * | selfie | URL contains `review` | verified, score 65 (below the default 80 → manual review) |
 * | selfie | anything else | verified, score 95 |
 */
export class MockKycDriver implements KycDriver {
  readonly provider = "mock";

  async verifyPan({ pan, name }: PanInput): Promise<DriverOutcome> {
    if (pan.endsWith("Y")) outage();
    if (pan.endsWith("Z")) return fail("invalid_pan");
    const code = pan[3] as PanEntityCode;
    const details = { category: PAN_ENTITY_TYPES[code] ?? null, aadhaarLinked: true, panStatus: "VALID" };
    return ok(pan === MOCK_PAN ? MOCK_NAME : (upper(name) ?? MOCK_NAME), details, { providerRef: ref("mockpan", pan) });
  }

  async verifyGstin({ gstin }: GstinInput): Promise<DriverOutcome> {
    const pan = gstin.slice(2, 12);
    if (pan.endsWith("Z")) return fail("gstin_not_found");
    const base = { stateCode: gstin.slice(0, 2), constitution: "Proprietorship", registrationDate: "2020-04-01", taxpayerType: "Regular" };
    if (pan.endsWith("Y")) return fail("gstin_inactive", { ...base, gstStatus: "Cancelled", legalName: MOCK_NAME });
    return ok(MOCK_NAME, { ...base, gstStatus: "Active", legalName: MOCK_NAME, tradeName: "TEST TRADERS" }, { providerRef: ref("mockgst", gstin) });
  }

  async verifyBankAccount({ accountNumber, ifsc, name }: BankInput): Promise<DriverOutcome> {
    const details = { ifsc, bankName: `${ifsc.slice(0, 4)} BANK`, accountLast4: last4(accountNumber) };
    if (accountNumber.endsWith("0000")) return fail("account_not_found", details);
    const holder = accountNumber.endsWith("9999") ? MOCK_OTHER_NAME : (upper(name) ?? MOCK_NAME);
    return ok(holder, details, { providerRef: ref("mockbank", ifsc + accountNumber) });
  }

  async verifyUpi({ vpa, name }: UpiInput): Promise<DriverOutcome> {
    if (vpa.startsWith("fail")) return fail("vpa_not_found");
    const holder = vpa.startsWith("other") ? MOCK_OTHER_NAME : (upper(name) ?? MOCK_NAME);
    return ok(holder, { handle: vpa.slice(vpa.indexOf("@") + 1) }, { providerRef: ref("mockupi", vpa) });
  }

  async startDigilocker({ name, redirectUrl }: DigilockerStartInput): Promise<DriverOutcome> {
    const providerRef = `mockdl_${Buffer.from(upper(name) ?? "", "utf8").toString("base64url")}`;
    const url = `https://digilocker.mock/consent?request=${encodeURIComponent(providerRef)}${redirectUrl ? `&redirect=${encodeURIComponent(redirectUrl)}` : ""}`;
    return { status: "pending", name: null, details: {}, providerRef, actionUrl: url };
  }

  async fetchDigilocker(providerRef: string): Promise<DriverOutcome> {
    if (!providerRef.startsWith("mockdl_")) return fail("unknown_request");
    const name = Buffer.from(providerRef.slice("mockdl_".length), "base64url").toString("utf8") || MOCK_NAME;
    if (name.endsWith("Z")) return fail("consent_denied");
    return ok(name, { aadhaarLast4: "1234", gender: "M", yearOfBirth: 1990, state: "Tamil Nadu" }, { providerRef });
  }

  async matchSelfie({ selfieUrl }: SelfieInput): Promise<DriverOutcome> {
    if (selfieUrl.includes("fail")) return { ...fail("face_mismatch", { liveness: true }), score: 20 };
    const score = selfieUrl.includes("review") ? 65 : 95;
    return ok(null, { liveness: true, confidence: score }, { score });
  }
}
