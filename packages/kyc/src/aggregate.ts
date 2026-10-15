import { NAME_MATCH_THRESHOLD, nameMatchScore } from "./names";
import type { CheckStatus, CheckType, SubjectStatus, SubjectType } from "./schema";

/** What the status rules look at for one check. */
export interface CheckFacts {
  type: CheckType;
  status: CheckStatus;
  createdAt: Date;
  /** Name returned by the provider. */
  nameOnRecord?: string | null;
  nameMatchScore?: number | null;
  /** A super-admin approved it; approval overrides a low name-match score. */
  approved?: boolean;
}

export interface SubjectSummary {
  status: SubjectStatus;
  verified: boolean;
  /** Best verified name: PAN > GSTIN legal name > DigiLocker (Aadhaar) > bank > UPI. */
  verifiedName: string | null;
  /** Verified checks as badges (`pan`, `gstin`, `bank`, `upi`, `aadhaar`, `selfie`), plus `verified` when the rule passes. */
  badges: string[];
  /** Human-readable reasons the subject is not verified yet (empty when verified). */
  missing: string[];
}

export interface AggregateOptions {
  /** Name-match pass mark for the vendor payout check (bank / UPI vs PAN name). Default 80. */
  nameMatchThreshold?: number;
}

const BADGE: Record<CheckType, string> = {
  pan: "pan",
  gstin: "gstin",
  bank_account: "bank",
  upi: "upi",
  digilocker_aadhaar: "aadhaar",
  selfie: "selfie",
};
const NAME_PRIORITY: CheckType[] = ["pan", "gstin", "digilocker_aadhaar", "bank_account", "upi"];

/** The newest check of each type (ties: the later entry in the list wins). */
export function latestByType(checks: readonly CheckFacts[]): Map<CheckType, CheckFacts> {
  const latest = new Map<CheckType, CheckFacts>();
  for (const c of checks) {
    const cur = latest.get(c.type);
    if (!cur || c.createdAt.getTime() >= cur.createdAt.getTime()) latest.set(c.type, c);
  }
  return latest;
}

/**
 * Subject status rules (pure). Only the newest check of each type counts, so a re-check replaces the old result.
 *
 * Verified when:
 * - vendor: PAN verified AND (bank account OR UPI verified with name match ≥ threshold against the PAN name, or approved
 *   by a reviewer);
 * - shop: GSTIN verified OR PAN verified;
 * - user: PAN verified OR DigiLocker (Aadhaar) verified.
 *
 * Otherwise, in this order: any newest check in `manual_review` → `manual_review`; any `pending` → `pending`; any
 * `failed` → `failed`; some verified but the rule not met yet → `pending`; no checks → `none`.
 */
export function aggregateSubject(subjectType: SubjectType, checks: readonly CheckFacts[], opts: AggregateOptions = {}): SubjectSummary {
  const threshold = opts.nameMatchThreshold ?? NAME_MATCH_THRESHOLD;
  const latest = latestByType(checks);
  const ok = (t: CheckType) => latest.get(t)?.status === "verified";
  /** Payout check passes: approved by a reviewer, or its name matches the verified PAN name (recomputed here, so the
   * order in which PAN and bank were checked doesn't matter), or — without names — its stored score passes. */
  const nameOk = (t: CheckType) => {
    const c = latest.get(t);
    if (!c || c.status !== "verified") return false;
    if (c.approved === true) return true;
    const pan = latest.get("pan");
    const score = pan?.status === "verified" && pan.nameOnRecord && c.nameOnRecord ? nameMatchScore(pan.nameOnRecord, c.nameOnRecord) : c.nameMatchScore ?? 0;
    return score >= threshold;
  };

  const missing: string[] = [];
  let verified: boolean;
  switch (subjectType) {
    case "vendor": {
      const panOk = ok("pan");
      if (!panOk) missing.push("PAN");
      if (!ok("bank_account") && !ok("upi")) missing.push("Bank account or UPI ID");
      else if (panOk && !nameOk("bank_account") && !nameOk("upi")) missing.push(`Bank or UPI name matching the PAN (${threshold}%+)`);
      verified = missing.length === 0;
      break;
    }
    case "shop":
      verified = ok("gstin") || ok("pan");
      if (!verified) missing.push("GSTIN or PAN");
      break;
    case "user":
      verified = ok("pan") || ok("digilocker_aadhaar");
      if (!verified) missing.push("PAN or DigiLocker (Aadhaar)");
      break;
  }

  const badges = [...latest.values()].filter((c) => c.status === "verified").map((c) => BADGE[c.type]);
  badges.sort((a, b) => Object.values(BADGE).indexOf(a) - Object.values(BADGE).indexOf(b));
  if (verified) badges.push("verified");

  let verifiedName: string | null = null;
  for (const t of NAME_PRIORITY) {
    const c = latest.get(t);
    if (c?.status === "verified" && c.nameOnRecord) {
      verifiedName = c.nameOnRecord;
      break;
    }
  }

  let status: SubjectStatus;
  const statuses = [...latest.values()].map((c) => c.status);
  if (verified) status = "verified";
  else if (statuses.includes("manual_review")) status = "manual_review";
  else if (statuses.includes("pending")) status = "pending";
  else if (statuses.includes("failed")) status = "failed";
  else if (statuses.includes("verified")) status = "pending";
  else status = "none";

  return { status, verified, verifiedName, badges, missing: verified ? [] : missing };
}

/**
 * Which name a new check is compared against: the subject's best verified name (PAN first), else the name the caller
 * expects (e.g. the vendor's registered name). Null = nothing to compare (no score is recorded).
 */
export function referenceName(checks: readonly CheckFacts[], expected?: string | null): string | null {
  const latest = latestByType(checks);
  for (const t of NAME_PRIORITY) {
    const c = latest.get(t);
    if (c?.status === "verified" && c.nameOnRecord) return c.nameOnRecord;
  }
  return expected?.trim() ? expected.trim() : null;
}
