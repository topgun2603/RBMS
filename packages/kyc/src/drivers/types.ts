/**
 * One KYC provider. Every method gets inputs that already passed the local format checks (normalised: upper-case PAN,
 * GSTIN and IFSC, digits-only account number, lower-case VPA). Methods return an outcome for "the provider answered"
 * (including "this PAN does not exist" → `failed`) and throw `KycProviderError` when the provider could not answer
 * (network, timeout, auth, 5xx).
 *
 * `details` must be safe to store: no full Aadhaar / account numbers, no photos or XML. The service scrubs it again.
 */

export type DriverOutcomeStatus = "verified" | "failed" | "pending";

export interface DriverOutcome {
  status: DriverOutcomeStatus;
  /** Name on the provider's record (PAN holder, legal name, account holder, Aadhaar name). */
  name: string | null;
  /** Whitelisted, masked fields worth keeping (category, bank name, GST status, last 4 of Aadhaar …). */
  details: Record<string, unknown>;
  /** Machine-readable reason when `failed`, e.g. `invalid_pan`, `account_not_found`, `gstin_inactive`. */
  error?: string | null;
  /** Provider request id (needed for async flows like DigiLocker). */
  providerRef?: string | null;
  /** Where the user must go next (DigiLocker consent page). */
  actionUrl?: string | null;
  /** 0–100 confidence for selfie / face match. */
  score?: number | null;
}

export interface PanInput {
  pan: string;
  /** Name the caller expects; some providers do a name match themselves. */
  name?: string | null;
  /** `YYYY-MM-DD`, optional. */
  dob?: string | null;
}
export interface GstinInput {
  gstin: string;
}
export interface BankInput {
  accountNumber: string;
  ifsc: string;
  name?: string | null;
}
export interface UpiInput {
  vpa: string;
  name?: string | null;
}
export interface DigilockerStartInput {
  /** Where DigiLocker sends the user back after consent. */
  redirectUrl?: string | null;
  /** Name the caller expects (used by the mock only). */
  name?: string | null;
}
export interface SelfieInput {
  /** Upload URL of the selfie. */
  selfieUrl: string;
  /** Upload URL of a photo ID to compare with (optional; liveness-only without it). */
  referenceUrl?: string | null;
}

export interface KycDriver {
  /** Stored on each check, e.g. `mock`, `http`. */
  readonly provider: string;
  verifyPan(input: PanInput): Promise<DriverOutcome>;
  verifyGstin(input: GstinInput): Promise<DriverOutcome>;
  verifyBankAccount(input: BankInput): Promise<DriverOutcome>;
  verifyUpi(input: UpiInput): Promise<DriverOutcome>;
  /** Starts a DigiLocker consent flow → `pending` with `providerRef` + `actionUrl`. */
  startDigilocker(input: DigilockerStartInput): Promise<DriverOutcome>;
  /** Polls a DigiLocker flow started earlier → `pending` until the user has consented. */
  fetchDigilocker(providerRef: string): Promise<DriverOutcome>;
  matchSelfie(input: SelfieInput): Promise<DriverOutcome>;
}

/** The provider could not answer. `status` is the HTTP status (0 for network errors / timeouts). */
export class KycProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    message: string,
    /** Short machine code: `timeout`, `network`, `unauthorized`, `rate_limited`, `server_error`, `bad_response`. */
    readonly code: string = "provider_error",
  ) {
    super(message);
    this.name = "KycProviderError";
  }
}
