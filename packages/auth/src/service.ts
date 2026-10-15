import {
  addDays,
  addMinutes,
  AppError,
  badRequest,
  forbidden,
  notFound,
  randomDigits,
  randomToken,
  safeEqual,
  sha256,
  tooMany,
} from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, desc, eq, gt, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { signGuestToken, verifyGuestTokenWith } from "./guest-token";
import { detectTarget, maskTarget, matchesTestTarget, normalizeEmail, otpHash, otpRetryAfter, type Target } from "./helpers";
import type { GoogleClaims, GoogleTokenVerifier, LoggerPort, MembershipLookup, OtpSender, PermissionResolverPort } from "./ports";
import { authIdentities, authOtps, authSessions, users, type OtpChannel, type SessionRow, type UserRow, type UserStatus } from "./schema";

export interface AuthConfig {
  sessionTtlDays: number;
  otpTtlMinutes: number;
  /** Digits in a one-time code. Default 6. */
  otpLength?: number;
  /** Wrong guesses allowed per code. Default 5. */
  maxOtpAttempts?: number;
  /** Minimum seconds between two codes for the same target. Default 30. */
  otpResendSeconds?: number;
  /** Codes per target per rolling hour. Default 5. */
  otpMaxPerHour?: number;
  /** OAuth client ids accepted as the `aud` of Google ID tokens (web, Android, iOS). */
  googleClientIds?: string[];
  /** Session cookie name. Default "sr_session". */
  cookieName?: string;
  /**
   * Development/test only: a fixed code for test identities. Matching targets (exact values or `*` patterns such as
   * "+9199990*" or "e2e-*@example.com") skip the resend/hourly limits, get no message sent and accept `code`.
   * The host must never pass this in production (apps/api only wires it when NODE_ENV !== "production").
   */
  testOtp?: { code: string; targets: string[] };
  /**
   * Secret for guest phone tokens (`verifyGuestOtp` / `verifyGuestToken`). Without it guest verification answers
   * 503 not_configured. Use a long random value distinct from other secrets.
   */
  guestTokenSecret?: string;
  /** Lifetime of a guest phone token. Default 60 minutes. */
  guestTokenTtlMinutes?: number;
}

export interface GuestVerifyResult {
  /** Signed token proving the phone was verified for this tenant; send it back to guest endpoints. */
  guestToken: string;
  expiresAt: Date;
  /** The verified phone number in E.164 form. */
  phone: string;
}

export interface AuthDeps {
  db: Db;
  config: AuthConfig;
  otp: OtpSender;
  memberships: MembershipLookup;
  /** Resolves `user.permissions` from tenant roles (wire to staff.resolver). Default: owner/admin → ["*"], others → []. */
  permissions?: PermissionResolverPort;
  log?: LoggerPort;
  /** Override Google ID token verification (tests). */
  verifyGoogleToken?: GoogleTokenVerifier;
}

/** Public user shape. Safe to return from the API. */
export interface AuthUser {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  locale: string;
  platformRoles: string[];
  status: UserStatus;
  createdAt: Date;
}

/** Minimal user details for member lists. */
export interface DirectoryUser {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  lastLoginAt: Date | null;
}

export interface SessionInfo {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface SessionMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface SignInResult {
  token: string;
  expiresAt: Date;
  user: AuthUser;
  isNewUser: boolean;
}

export const toAuthUser = (u: UserRow): AuthUser => ({
  id: u.id,
  phone: u.phone,
  email: u.email,
  name: u.name,
  avatarUrl: u.avatarUrl,
  locale: u.locale,
  platformRoles: u.platformRoles,
  status: u.status,
  createdAt: u.createdAt,
});

const toSessionInfo = (s: SessionRow): SessionInfo => ({
  id: s.id,
  ip: s.ip,
  userAgent: s.userAgent,
  createdAt: s.createdAt,
  lastSeenAt: s.lastSeenAt,
  expiresAt: s.expiresAt,
});

const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const TOUCH_INTERVAL_MS = 5 * 60_000;

/** Default Google verifier: Google's JWKS (fetched lazily and cached by jose). */
export function createGoogleVerifier(): GoogleTokenVerifier {
  let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  return async (idToken, audience) => {
    jwks ??= createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
    const { payload } = await jwtVerify(idToken, jwks, { issuer: GOOGLE_ISSUERS, audience });
    if (typeof payload.sub !== "string") throw new Error("Google token has no subject");
    return payload as unknown as GoogleClaims;
  };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class AuthService {
  private readonly db: Db;
  private readonly cfg: Required<Omit<AuthConfig, "googleClientIds" | "testOtp" | "guestTokenSecret">> & {
    googleClientIds: string[];
    guestTokenSecret: string | null;
  };
  private readonly testOtp: { code: string; targets: string[] } | null;
  private readonly verifyGoogle: GoogleTokenVerifier;

  constructor(private readonly deps: AuthDeps) {
    this.db = deps.db;
    const c = deps.config;
    this.cfg = {
      sessionTtlDays: c.sessionTtlDays,
      otpTtlMinutes: c.otpTtlMinutes,
      otpLength: c.otpLength ?? 6,
      maxOtpAttempts: c.maxOtpAttempts ?? 5,
      otpResendSeconds: c.otpResendSeconds ?? 30,
      otpMaxPerHour: c.otpMaxPerHour ?? 5,
      googleClientIds: c.googleClientIds ?? [],
      cookieName: c.cookieName ?? "sr_session",
      guestTokenSecret: c.guestTokenSecret || null,
      guestTokenTtlMinutes: c.guestTokenTtlMinutes && c.guestTokenTtlMinutes > 0 ? c.guestTokenTtlMinutes : 60,
    };
    const t = c.testOtp;
    const targets = (t?.targets ?? []).map((s) => s.trim()).filter(Boolean);
    this.testOtp = t && /^\d{4,10}$/.test(t.code) && targets.length ? { code: t.code, targets } : null;
    this.verifyGoogle = deps.verifyGoogleToken ?? createGoogleVerifier();
  }

  get cookieName() {
    return this.cfg.cookieName;
  }

  get sessionTtlDays() {
    return this.cfg.sessionTtlDays;
  }

  // ---------------------------------------------------------------- OTP

  async requestOtp(input: {
    target: string;
    channel?: OtpChannel;
    locale: string;
    ip?: string | null;
    tenantId?: string | null;
  }): Promise<{ target: string; channel: OtpChannel; expiresInSeconds: number; resendInSeconds: number }> {
    const target = this.parseTarget(input.target);
    const channel: OtpChannel = input.channel ?? (target.kind === "phone" ? "sms" : "email");
    if (target.kind === "phone" && channel === "email") throw badRequest("Use sms or whatsapp for a phone number");
    if (target.kind === "email" && channel !== "email") throw badRequest("Use email for an email address");

    if (this.isTestTarget(target.value)) {
      // Test identity (dev only): nothing is sent or stored and no limits apply; verify accepts the fixed code.
      this.deps.log?.info({ target: maskTarget(target.value), channel }, "auth: test OTP target, no code sent");
      return {
        target: maskTarget(target.value),
        channel,
        expiresInSeconds: this.cfg.otpTtlMinutes * 60,
        resendInSeconds: 0,
      };
    }

    const now = new Date();
    const recent = await this.db
      .select({ createdAt: authOtps.createdAt })
      .from(authOtps)
      .where(and(eq(authOtps.target, target.value), gt(authOtps.createdAt, new Date(now.getTime() - 3_600_000))));
    const wait = otpRetryAfter({
      recent: recent.map((r) => r.createdAt),
      now,
      resendSeconds: this.cfg.otpResendSeconds,
      maxPerHour: this.cfg.otpMaxPerHour,
    });
    if (wait > 0) {
      throw tooMany(`Please wait ${wait} seconds before requesting another code`);
    }

    // Only the newest code is valid.
    await this.db
      .update(authOtps)
      .set({ expiresAt: now })
      .where(and(eq(authOtps.target, target.value), isNull(authOtps.consumedAt), gt(authOtps.expiresAt, now)));

    const code = randomDigits(this.cfg.otpLength);
    const [row] = await this.db
      .insert(authOtps)
      .values({
        target: target.value,
        channel,
        codeHash: otpHash(code, target.value),
        expiresAt: addMinutes(now, this.cfg.otpTtlMinutes),
        ip: input.ip ?? null,
      })
      .returning({ id: authOtps.id });

    try {
      await this.deps.otp.sendOtp({
        channel,
        to: target.value,
        code,
        locale: input.locale,
        ttlMinutes: this.cfg.otpTtlMinutes,
        tenantId: input.tenantId ?? null,
      });
    } catch (err) {
      if (row) await this.db.update(authOtps).set({ expiresAt: new Date() }).where(eq(authOtps.id, row.id));
      this.deps.log?.error({ err, channel }, "auth: failed to send OTP");
      throw err;
    }

    return {
      target: maskTarget(target.value),
      channel,
      expiresInSeconds: this.cfg.otpTtlMinutes * 60,
      resendInSeconds: this.cfg.otpResendSeconds,
    };
  }

  async verifyOtp(input: {
    target: string;
    code: string;
    ip?: string | null;
    userAgent?: string | null;
    name?: string | null;
  }): Promise<SignInResult> {
    const target = this.parseTarget(input.target);
    await this.checkOtpCode(target, input.code);
    return this.signInTarget(target.value, input);
  }

  /**
   * Verifies a phone OTP for a guest (no account): never creates a user or a session. Returns a short-lived token
   * bound to the tenant and phone that guest endpoints check with `verifyGuestToken`. Request the code first with
   * `requestOtp` (POST /otp/request), exactly like sign-in.
   */
  async verifyGuestOtp(input: { target: string; code: string; tenantId: string; ip?: string | null }): Promise<GuestVerifyResult> {
    const secret = this.cfg.guestTokenSecret;
    if (!secret) throw new AppError(503, "not_configured", "Guest verification is not configured");
    if (!input.tenantId) throw new AppError(400, "tenant_required", "Guest verification needs a shop");
    const target = this.parseTarget(input.target);
    if (target.kind !== "phone") throw badRequest("Enter a valid mobile number");
    await this.checkOtpCode(target, input.code);
    const expiresAt = addMinutes(new Date(), this.cfg.guestTokenTtlMinutes);
    const guestToken = signGuestToken(secret, { tenantId: input.tenantId, phone: target.value, expiresAt });
    this.deps.log?.info({ tenantId: input.tenantId, target: maskTarget(target.value) }, "auth: guest phone verified");
    return { guestToken, expiresAt, phone: target.value };
  }

  /** Checks a guest token from `verifyGuestOtp`: signature, expiry and tenant must match. Null otherwise. */
  verifyGuestToken(tenantId: string, token: string): { phone: string } | null {
    const secret = this.cfg.guestTokenSecret;
    if (!secret || !tenantId || !token) return null;
    return verifyGuestTokenWith(secret, tenantId, token);
  }

  /**
   * Checks a code for a normalised target: test identities accept the fixed test code; otherwise the newest live
   * code is checked, counting attempts, and consumed atomically on success. Throws on any failure.
   */
  private async checkOtpCode(target: Target, rawCode: string): Promise<void> {
    if (this.isTestTarget(target.value)) {
      const code = String(rawCode ?? "").replace(/\s/g, "");
      if (!safeEqual(code, this.testOtp!.code)) throw badRequest("Incorrect code");
      return;
    }
    const now = new Date();
    const [otp] = await this.db
      .select()
      .from(authOtps)
      .where(and(eq(authOtps.target, target.value), isNull(authOtps.consumedAt), gt(authOtps.expiresAt, now)))
      .orderBy(desc(authOtps.createdAt))
      .limit(1);
    if (!otp) throw badRequest("The code has expired. Please request a new one");

    const max = this.cfg.maxOtpAttempts;
    if (otp.attempts >= max) {
      await this.db.update(authOtps).set({ expiresAt: now }).where(eq(authOtps.id, otp.id));
      throw tooMany("Too many wrong attempts. Please request a new code");
    }
    const [bumped] = await this.db
      .update(authOtps)
      .set({ attempts: sql`${authOtps.attempts} + 1` })
      .where(eq(authOtps.id, otp.id))
      .returning({ attempts: authOtps.attempts });
    const attempts = bumped?.attempts ?? otp.attempts + 1;

    const code = String(rawCode ?? "").replace(/\s/g, "");
    if (!safeEqual(otpHash(code, target.value), otp.codeHash)) {
      if (attempts >= max) {
        await this.db.update(authOtps).set({ expiresAt: now }).where(eq(authOtps.id, otp.id));
        throw tooMany("Too many wrong attempts. Please request a new code");
      }
      throw badRequest("Incorrect code", { attemptsLeft: max - attempts });
    }

    // Consume atomically so a code can only be used once even under concurrent requests.
    const consumed = await this.db
      .update(authOtps)
      .set({ consumedAt: now })
      .where(and(eq(authOtps.id, otp.id), isNull(authOtps.consumedAt)))
      .returning({ id: authOtps.id });
    if (consumed.length === 0) throw badRequest("The code has already been used");

  }

  /** True when test OTPs are configured and `target` (normalised) is one of the test identities. */
  isTestTarget(target: string): boolean {
    return !!this.testOtp && matchesTestTarget(target, this.testOtp.targets);
  }

  private async signInTarget(
    target: string,
    input: { name?: string | null; ip?: string | null; userAgent?: string | null },
  ): Promise<SignInResult> {
    const { user, isNewUser } = await this.findOrCreateByTarget(target, { name: input.name ?? null });
    this.assertCanSignIn(user);
    if (!isNewUser && !user.name && input.name?.trim()) {
      await this.db.update(users).set({ name: input.name.trim() }).where(eq(users.id, user.id));
    }
    return this.completeSignIn(user.id, isNewUser, input);
  }

  // ---------------------------------------------------------------- Google

  async signInWithGoogle(input: { idToken: string; ip?: string | null; userAgent?: string | null }): Promise<SignInResult> {
    if (this.cfg.googleClientIds.length === 0) throw badRequest("Google sign-in is not configured");
    let claims: GoogleClaims;
    try {
      claims = await this.verifyGoogle(input.idToken, this.cfg.googleClientIds);
    } catch (err) {
      this.deps.log?.warn({ err }, "auth: Google token rejected");
      throw badRequest("Invalid Google sign-in token");
    }
    const verified = claims.email_verified === true || claims.email_verified === "true";
    const email = claims.email ? normalizeEmail(claims.email) : null;
    if (!email || !verified) throw badRequest("Your Google account email is not verified");

    const [linked] = await this.db
      .select({ user: users })
      .from(authIdentities)
      .innerJoin(users, eq(users.id, authIdentities.userId))
      .where(and(eq(authIdentities.provider, "google"), eq(authIdentities.providerUserId, claims.sub)))
      .limit(1);

    let userId: string;
    let isNewUser = false;
    if (linked) {
      this.assertCanSignIn(toAuthUser(linked.user));
      userId = linked.user.id;
    } else {
      const res = await this.findOrCreateByTarget(email, { name: claims.name ?? null, avatarUrl: claims.picture ?? null });
      this.assertCanSignIn(res.user);
      userId = res.user.id;
      isNewUser = res.isNewUser;
      await this.db
        .insert(authIdentities)
        .values({ userId, provider: "google", providerUserId: claims.sub, email })
        .onConflictDoNothing();
      if (!isNewUser && (!res.user.name || !res.user.avatarUrl)) {
        await this.db
          .update(users)
          .set({ name: res.user.name ?? claims.name ?? null, avatarUrl: res.user.avatarUrl ?? claims.picture ?? null })
          .where(eq(users.id, userId));
      }
    }
    return this.completeSignIn(userId, isNewUser, input);
  }

  // ---------------------------------------------------------------- Sessions

  async createSession(userId: string, meta: SessionMeta = {}): Promise<{ token: string; session: SessionInfo }> {
    const token = randomToken();
    const now = new Date();
    const [row] = await this.db
      .insert(authSessions)
      .values({
        userId,
        tokenHash: sha256(token),
        expiresAt: addDays(now, this.cfg.sessionTtlDays),
        lastSeenAt: now,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ? meta.userAgent.slice(0, 512) : null,
      })
      .returning();
    return { token, session: toSessionInfo(row!) };
  }

  /** Resolves a session token. Returns null for unknown, expired or revoked sessions and inactive users. */
  async authenticate(token: string | null | undefined): Promise<{ user: AuthUser; session: SessionInfo } | null> {
    if (!token || token.length > 256) return null;
    const now = new Date();
    const [row] = await this.db
      .select({ session: authSessions, user: users })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(eq(authSessions.tokenHash, sha256(token)))
      .limit(1);
    if (!row) return null;
    const { session, user } = row;
    if (session.revokedAt || session.expiresAt <= now || user.status !== "active") return null;
    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.db.update(authSessions).set({ lastSeenAt: now }).where(eq(authSessions.id, session.id));
      session.lastSeenAt = now;
    }
    return { user: toAuthUser(user), session: toSessionInfo(session) };
  }

  async revokeSession(id: string, userId: string): Promise<void> {
    const res = await this.db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.id, id), eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id });
    if (res.length === 0) throw notFound("Session");
  }

  /** Revokes every active session of the user except `exceptSessionId`. Returns how many were revoked. */
  async revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
    const conds = [eq(authSessions.userId, userId), isNull(authSessions.revokedAt)];
    if (exceptSessionId) conds.push(ne(authSessions.id, exceptSessionId));
    const res = await this.db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(...conds))
      .returning({ id: authSessions.id });
    return res.length;
  }

  /** Active sessions, newest activity first. */
  async listSessions(userId: string): Promise<SessionInfo[]> {
    const rows = await this.db
      .select()
      .from(authSessions)
      .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date())))
      .orderBy(desc(authSessions.lastSeenAt));
    return rows.map(toSessionInfo);
  }

  // ---------------------------------------------------------------- Users

  async getUser(id: string): Promise<AuthUser | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? toAuthUser(row) : null;
  }

  /**
   * Directory entries for many users at once (staff lists). Unknown ids are left out.
   * Shape matches the staff module's `UserDirectoryPort.getUsers`.
   */
  async getUsers(ids: string[]): Promise<DirectoryUser[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const rows = await this.db
      .select({ id: users.id, name: users.name, phone: users.phone, email: users.email, lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(inArray(users.id, unique));
    return rows;
  }

  async updateProfile(id: string, patch: { name?: string | null; avatarUrl?: string | null; locale?: string }): Promise<AuthUser> {
    const set: Partial<typeof users.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name?.trim() || null;
    if (patch.avatarUrl !== undefined) set.avatarUrl = patch.avatarUrl || null;
    if (patch.locale !== undefined) set.locale = patch.locale;
    if (Object.keys(set).length === 0) {
      const u = await this.getUser(id);
      if (!u) throw notFound("User");
      return u;
    }
    const [row] = await this.db.update(users).set(set).where(eq(users.id, id)).returning();
    if (!row) throw notFound("User");
    return toAuthUser(row);
  }

  /** Looks up a user by a raw phone number or email. Returns null if invalid or not found. */
  async findByPhoneOrEmail(target: string): Promise<AuthUser | null> {
    const t = detectTarget(target);
    if (!t) return null;
    const [row] = await this.db
      .select()
      .from(users)
      .where(t.kind === "phone" ? eq(users.phone, t.value) : eq(users.email, t.value))
      .limit(1);
    return row ? toAuthUser(row) : null;
  }

  /**
   * Finds the user owning a phone/email or creates one. Used by sign-in and by apps/api to invite staff.
   * Throws badRequest if `target` is not a valid phone or email.
   */
  async findOrCreateByTarget(
    target: string,
    defaults: { name?: string | null; avatarUrl?: string | null; locale?: string } = {},
  ): Promise<{ user: AuthUser; isNewUser: boolean }> {
    const t = this.parseTarget(target);
    const match = t.kind === "phone" ? eq(users.phone, t.value) : eq(users.email, t.value);
    const [existing] = await this.db.select().from(users).where(match).limit(1);
    if (existing) return { user: toAuthUser(existing), isNewUser: false };
    const [created] = await this.db
      .insert(users)
      .values({
        phone: t.kind === "phone" ? t.value : null,
        email: t.kind === "email" ? t.value : null,
        name: defaults.name?.trim() || null,
        avatarUrl: defaults.avatarUrl || null,
        ...(defaults.locale ? { locale: defaults.locale } : {}),
      })
      .onConflictDoNothing()
      .returning();
    if (created) return { user: toAuthUser(created), isNewUser: true };
    // Lost a race with a concurrent insert.
    const [again] = await this.db.select().from(users).where(match).limit(1);
    if (!again) throw new Error("auth: could not create user");
    return { user: toAuthUser(again), isNewUser: false };
  }

  async setPlatformRoles(userId: string, roles: string[]): Promise<AuthUser> {
    const unique = [...new Set(roles.map((r) => r.trim()).filter(Boolean))];
    const [row] = await this.db.update(users).set({ platformRoles: unique }).where(eq(users.id, userId)).returning();
    if (!row) throw notFound("User");
    return toAuthUser(row);
  }

  /** Changes account status. Disabling or deleting signs the user out everywhere. */
  async setStatus(userId: string, status: UserStatus): Promise<AuthUser> {
    const [row] = await this.db
      .update(users)
      .set({ status, deletedAt: status === "deleted" ? new Date() : null })
      .where(eq(users.id, userId))
      .returning();
    if (!row) throw notFound("User");
    if (status !== "active") await this.revokeAllSessions(userId);
    return toAuthUser(row);
  }

  async listUsers(opts: { q?: string; limit?: number; offset?: number } = {}): Promise<{ items: AuthUser[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const q = opts.q?.trim();
    let where;
    if (q) {
      const like = `%${escapeLike(q)}%`;
      const phone = detectTarget(q);
      where = or(
        ilike(users.email, like),
        ilike(users.name, like),
        ilike(users.phone, like),
        ...(phone?.kind === "phone" ? [eq(users.phone, phone.value)] : []),
      );
    }
    const [items, [count]] = await Promise.all([
      this.db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(limit).offset(offset),
      this.db.select({ n: sql<number>`count(*)::int` }).from(users).where(where),
    ]);
    return { items: items.map(toAuthUser), total: count?.n ?? 0 };
  }

  // ---------------------------------------------------------------- DPDP

  /**
   * Anonymises a user for account deletion: clears personal fields, marks the account deleted,
   * removes linked identities and pending codes, and revokes every session. The row is kept so
   * foreign keys in other modules stay valid.
   */
  async eraseUser(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!u) return;
      const now = new Date();
      const targets = [u.phone, u.email].filter((v): v is string => !!v);
      for (const target of targets) await tx.delete(authOtps).where(eq(authOtps.target, target));
      await tx.delete(authIdentities).where(eq(authIdentities.userId, userId));
      await tx
        .update(authSessions)
        .set({ revokedAt: now, ip: null, userAgent: null })
        .where(eq(authSessions.userId, userId));
      await tx
        .update(users)
        .set({
          phone: null,
          email: null,
          name: null,
          avatarUrl: null,
          platformRoles: [],
          status: "deleted",
          deletedAt: now,
        })
        .where(eq(users.id, userId));
    });
    this.deps.log?.info({ userId }, "auth: user erased");
  }

  /** Personal data held by auth, for a DPDP data export. */
  async exportUser(userId: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return null;
    const [identities, sessions] = await Promise.all([
      this.db
        .select({ provider: authIdentities.provider, createdAt: authIdentities.createdAt })
        .from(authIdentities)
        .where(eq(authIdentities.userId, userId)),
      this.db.select().from(authSessions).where(eq(authSessions.userId, userId)).orderBy(desc(authSessions.createdAt)),
    ]);
    return {
      profile: { ...toAuthUser(u), lastLoginAt: u.lastLoginAt, updatedAt: u.updatedAt },
      identities,
      sessions: sessions.map((s) => ({
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        revokedAt: s.revokedAt,
        ip: s.ip,
        userAgent: s.userAgent,
      })),
    };
  }

  // ---------------------------------------------------------------- internals

  private parseTarget(input: string): Target {
    const t = detectTarget(input);
    if (!t) throw badRequest("Enter a valid mobile number or email address");
    return t;
  }

  private assertCanSignIn(user: AuthUser) {
    if (user.status === "disabled") throw forbidden("This account has been disabled");
    if (user.status === "deleted") throw forbidden("This account has been deleted");
  }

  private async completeSignIn(userId: string, isNewUser: boolean, meta: SessionMeta): Promise<SignInResult> {
    const [row] = await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId)).returning();
    if (!row) throw notFound("User");
    const { token, session } = await this.createSession(userId, meta);
    return { token, expiresAt: session.expiresAt, user: toAuthUser(row), isNewUser };
  }
}
