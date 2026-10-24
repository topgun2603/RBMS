import { AppError, badRequest, tooMany } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { authMfa } from "./schema";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  otpauthUri,
  RECOVERY_CODE_COUNT,
  verifyTotp,
  totpStep,
  type SecretBox,
} from "./totp";

/** Wrong 2FA codes allowed per user in `MFA_LOCK_WINDOW_MS`; after that the user is locked out of 2FA for the rest of the window. */
export const MFA_MAX_FAILURES = 5;
export const MFA_LOCK_WINDOW_MS = 10 * 60_000;
/** Lifetime of the sign-in challenge token between step 1 and step 2. */
export const MFA_CHALLENGE_TTL_MS = 5 * 60_000;
/** Roles a shop can require two-factor sign-in for. */
export const MFA_POLICY_ROLES = ["owner", "admin", "manager"] as const;

export interface MfaStatus {
  enabled: boolean;
  enabledAt: Date | null;
  recoveryCodesLeft: number;
}

/**
 * Two-factor (TOTP) state of users: enrolment, code checks, recovery codes. No sign-in logic here (see AuthService).
 * The failure counter is per process (like the OTP and Firebase limiters); the HTTP layer adds a shared per-IP limit.
 */
export class MfaService {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
    private readonly pepper: string,
    private readonly issuer: string,
    private readonly now: () => number = Date.now,
  ) {}

  private recentFailures(userId: string): number[] {
    const from = this.now() - MFA_LOCK_WINDOW_MS;
    const list = (this.failures.get(userId) ?? []).filter((t) => t > from);
    if (list.length) this.failures.set(userId, list);
    else this.failures.delete(userId);
    return list;
  }
  private assertNotLocked(userId: string) {
    if (this.recentFailures(userId).length >= MFA_MAX_FAILURES) throw tooMany("Too many wrong codes. Please wait a few minutes and try again");
  }
  private fail(userId: string): never {
    const list = this.recentFailures(userId);
    list.push(this.now());
    this.failures.set(userId, list);
    throw badRequest("That code is not right", { attemptsLeft: Math.max(0, MFA_MAX_FAILURES - list.length) });
  }

  private async row(userId: string) {
    const [r] = await this.db.select().from(authMfa).where(eq(authMfa.userId, userId)).limit(1);
    return r ?? null;
  }

  async isEnabled(userId: string): Promise<boolean> {
    const [r] = await this.db.select({ c: authMfa.confirmedAt }).from(authMfa).where(and(eq(authMfa.userId, userId), isNotNull(authMfa.confirmedAt))).limit(1);
    return !!r;
  }

  async status(userId: string): Promise<MfaStatus> {
    const r = await this.row(userId);
    if (!r?.confirmedAt) return { enabled: false, enabledAt: null, recoveryCodesLeft: 0 };
    return { enabled: true, enabledAt: r.confirmedAt, recoveryCodesLeft: r.recoveryHashes.length };
  }

  /** Starts (or restarts) enrolment: a fresh secret, not active until `confirmEnrol`. 409 when 2FA is already on. */
  async beginEnrol(userId: string, account: string): Promise<{ secret: string; otpauthUri: string }> {
    const existing = await this.row(userId);
    if (existing?.confirmedAt) throw new AppError(409, "mfa_already_enabled", "Two-factor sign-in is already on. Turn it off first to set it up again.");
    const secret = generateTotpSecret();
    const secretEnc = this.box.encrypt(secret);
    await this.db
      .insert(authMfa)
      .values({ userId, secretEnc })
      .onConflictDoUpdate({ target: authMfa.userId, set: { secretEnc, lastStep: null, recoveryHashes: [], updatedAt: new Date() } });
    return { secret, otpauthUri: otpauthUri({ secret, account, issuer: this.issuer }) };
  }

  /** Confirms enrolment with the first code from the app; returns the recovery codes (shown once). */
  async confirmEnrol(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    this.assertNotLocked(userId);
    const r = await this.row(userId);
    if (!r) throw badRequest("Start the setup first");
    if (r.confirmedAt) throw new AppError(409, "mfa_already_enabled", "Two-factor sign-in is already on.");
    const step = verifyTotp(this.box.decrypt(r.secretEnc), code);
    if (step === null) this.fail(userId);
    const recoveryCodes = generateRecoveryCodes();
    const done = await this.db
      .update(authMfa)
      .set({ confirmedAt: new Date(), lastStep: step, recoveryHashes: recoveryCodes.map((c) => hashRecoveryCode(this.pepper, c)), updatedAt: new Date() })
      .where(and(eq(authMfa.userId, userId), sql`${authMfa.confirmedAt} is null`))
      .returning({ u: authMfa.userId });
    if (done.length === 0) throw new AppError(409, "mfa_already_enabled", "Two-factor sign-in is already on.");
    this.failures.delete(userId);
    return { recoveryCodes };
  }

  /**
   * Checks a sign-in / re-auth code: a 6-digit authenticator code (each 30 s step usable once) or a recovery code
   * (single use). Throws 400 for a wrong code, 429 after too many wrong ones. Returns which kind matched.
   */
  async verifyCode(userId: string, rawCode: string): Promise<{ method: "totp" | "recovery"; recoveryCodesLeft: number }> {
    this.assertNotLocked(userId);
    const r = await this.row(userId);
    if (!r?.confirmedAt) throw badRequest("Two-factor sign-in is not set up for this account");
    if (looksLikeRecoveryCode(rawCode)) {
      const hash = hashRecoveryCode(this.pepper, rawCode);
      if (!r.recoveryHashes.includes(hash)) this.fail(userId);
      const rest = r.recoveryHashes.filter((h) => h !== hash);
      // Optimistic: only the request that still sees the old list consumes the code.
      const used = await this.db
        .update(authMfa)
        .set({ recoveryHashes: rest, updatedAt: new Date() })
        .where(and(eq(authMfa.userId, userId), sql`${authMfa.recoveryHashes} = ${JSON.stringify(r.recoveryHashes)}::jsonb`))
        .returning({ u: authMfa.userId });
      if (used.length === 0) this.fail(userId);
      this.failures.delete(userId);
      return { method: "recovery", recoveryCodesLeft: rest.length };
    }
    const step = verifyTotp(this.box.decrypt(r.secretEnc), rawCode, { atMs: this.now(), lastStep: r.lastStep });
    if (step === null) this.fail(userId);
    const taken = await this.db
      .update(authMfa)
      .set({ lastStep: step, updatedAt: new Date() })
      .where(and(eq(authMfa.userId, userId), sql`(${authMfa.lastStep} is null or ${authMfa.lastStep} < ${step})`))
      .returning({ u: authMfa.userId });
    if (taken.length === 0) this.fail(userId);
    this.failures.delete(userId);
    return { method: "totp", recoveryCodesLeft: r.recoveryHashes.length };
  }

  /** New recovery codes (the old ones stop working). The caller has re-authenticated the user with `verifyCode`. */
  async regenerateRecoveryCodes(userId: string): Promise<{ recoveryCodes: string[] }> {
    const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
    const done = await this.db
      .update(authMfa)
      .set({ recoveryHashes: recoveryCodes.map((c) => hashRecoveryCode(this.pepper, c)), updatedAt: new Date() })
      .where(and(eq(authMfa.userId, userId), isNotNull(authMfa.confirmedAt)))
      .returning({ u: authMfa.userId });
    if (done.length === 0) throw badRequest("Two-factor sign-in is not set up for this account");
    return { recoveryCodes };
  }

  async disable(userId: string): Promise<void> {
    await this.db.delete(authMfa).where(eq(authMfa.userId, userId));
    this.failures.delete(userId);
  }

  /** Current TOTP step (exposed for tests). */
  stepNow = () => totpStep(this.now());
}
