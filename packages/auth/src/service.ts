import { createHash } from "node:crypto";
import {
  addDays,
  addMinutes,
  AppError,
  badRequest,
  facetCounts,
  forbidden,
  notFound,
  runList,
  randomDigits,
  randomToken,
  safeEqual,
  sha256,
  tooMany,
  type AuditPort,
  type ListPage,
} from "@srirealtime/core";
import { roleCondition, USER_SORT, userListConditions, userListQuerySchema, type UserListQuery } from "./list";
import type { Db } from "@srirealtime/db";
import { and, desc, eq, gt, ilike, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { matchStoreOrigin, matchStoreReturn, type StoreOriginsPort } from "./store-origin";
import { MfaService, MFA_CHALLENGE_TTL_MS, MFA_POLICY_ROLES, type MfaStatus } from "./mfa";
import { createSecretBox, signMfaChallenge, verifyMfaChallenge, type MfaChallenge } from "./totp";
import { createFirebaseVerifier, FirebaseTokenError, type FirebasePhoneClaims, type FirebaseTokenVerifier } from "./firebase";
import { signGuestToken, verifyGuestTokenWith } from "./guest-token";
import { detectTarget, maskTarget, matchesTestTarget, normalizeEmail, normalizePhone, otpHash, otpRetryAfter, type Target } from "./helpers";
import type { GoogleClaims, GoogleTokenVerifier, LoggerPort, MembershipLookup, OtpSender, PermissionResolverPort } from "./ports";
import {
  DEFAULT_SIGN_IN_OPTIONS,
  effectiveAudience,
  methodForChannel,
  methodForFirebaseProvider,
  platformMethods,
  readAudienceOptions,
  signInOptionsPatchSchema,
  SIGN_IN_METHODS,
  type Audience,
  type AudienceOptions,
  type PlatformMethods,
  type SignInMethod,
  type SignInOptions,
  type SignInOptionsPatch,
} from "./sign-in-options";
import { authHandoffs, authIdentities, authOtps, authSessions, authTenantSettings, users, type OtpChannel, type SessionRow, type UserRow, type UserStatus } from "./schema";

/** The shop and audience whose sign-in options apply to a request (from the shop header and the audience header). */
export interface SignInPolicy {
  tenantId: string;
  audience: Audience;
}

/** Lifetime of a cross-origin sign-in handoff code. */
export const HANDOFF_TTL_SECONDS = 60;

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
  /**
   * Firebase project whose Phone Authentication ID tokens `POST /firebase` accepts (docs/firebase-auth.md). Unset =
   * Firebase sign-in is off (503 not_configured) and clients use the OTP flow for phones.
   */
  firebaseProjectId?: string;
  /**
   * Refuse to send phone codes by SMS from `requestOtp` (400 `sms_via_firebase`). The host sets this in production when
   * Firebase sends the SMS and no real SMS provider is configured (the console driver would silently drop the code).
   * WhatsApp, email and test identities are unaffected.
   */
  smsOtpDisabled?: boolean;
  /**
   * Lifetime of a mobile app session (`SessionMeta.client` set). Mobile sessions slide: each use (at most every five
   * minutes) moves the expiry this many days ahead, so a phone in daily use stays signed in. Default 90.
   */
  mobileSessionTtlDays?: number;
  /**
   * Secret that protects two-factor sign-in: TOTP secrets are encrypted with it (AES-256-GCM), recovery codes are
   * keyed with it and sign-in challenge tokens are signed with it. Without it two-factor is off (enrolment answers
   * 503 not_configured). Use a long random value; changing it invalidates every enrolment.
   */
  mfaSecret?: string;
  /** Name shown in the authenticator app. Default "RBMS". */
  mfaIssuer?: string;
}

/** What clients need to pick a sign-in method (`GET /config`). */
export interface AuthClientConfig {
  /** How phone numbers are verified: Firebase Phone Authentication, or our own OTP (`/otp/request`). */
  phone: { method: "firebase" | "otp"; firebaseProjectId: string | null; smsOtp: boolean };
  /** Google sign-in is configured. */
  google: boolean;
  /** Email + password sign-in is available (it is a Firebase provider, so this is true when Firebase is set up). */
  password: boolean;
  /** Development/test only: the test-identity patterns that always use the OTP flow (absent when test OTPs are off). */
  testTargets?: string[];
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
  /** Override Firebase ID token verification (tests). Default: `createFirebaseVerifier` for `config.firebaseProjectId`. */
  verifyFirebaseToken?: FirebaseTokenVerifier;
  /** The app URL of a shop the user belongs to (null when not a member), for `POST /handoff { tenantId }`. */
  handoffTargets?: { appUrl(userId: string, tenantId: string): Promise<string | null> };
  /** A shop's storefront origins, for `POST /store/handoff` (shopper sign-in through the landing site). */
  storeOrigins?: StoreOriginsPort;
  /** A shop's id and name by slug (any active shop), for `GET /config?shop=`. Defaults to `storeOrigins.shop`. */
  shopBySlug?: (slug: string) => Promise<{ id: string; slug: string; name: string } | null>;
  /** Records sign-ins, handoffs and super-admin user changes (the host audit hook can't: no user yet, or no shop). */
  audit?: AuditPort;
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
  /** The mobile app that signed in; null for the web. "srikit-pos" for a POS PIN session. */
  client: string | null;
  /** The POS terminal a PIN session is bound to; null for every other session. */
  terminalId: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface SessionMeta {
  ip?: string | null;
  userAgent?: string | null;
  /** A srikit mobile app (`parseClient` of the `x-client` header). Makes the session a long, sliding mobile one. */
  client?: string | null;
}

const CLIENT_RE = /^srikit-[a-z]+\/\d+\.\d+\.\d+(?:[+-][0-9A-Za-z.]+)?(?: \((?:android|ios)\))?$/;

/** The `x-client` header of a srikit mobile app, e.g. "srikit-business/1.0.0 (android)"; null for anything else. */
export function parseClient(header: string | string[] | undefined): string | null {
  const v = (Array.isArray(header) ? header[0] : header)?.trim();
  return v && v.length <= 80 && CLIENT_RE.test(v) ? v : null;
}

export interface SignInResult {
  token: string;
  expiresAt: Date;
  user: AuthUser;
  isNewUser: boolean;
}

/**
 * Step 1 of sign-in passed but the account needs two-factor before a session exists. No session is created: the client
 * sends `challengeToken` and a code to `POST /mfa/verify` (or, when `enrolRequired`, sets 2FA up first).
 */
export interface MfaPending {
  mfaRequired: true;
  /** The shop requires two-factor and this user has not set it up yet. */
  enrolRequired: boolean;
  challengeToken: string;
  expiresAt: Date;
}
export const isMfaPending = (r: SignInResult | MfaPending): r is MfaPending => "mfaRequired" in r;

/** Extra inputs of the sign-in steps: the shop policy, and `skipMfa` for test identities. */
type SignInInput = SessionMeta & { policy?: SignInPolicy | null; skipMfa?: boolean };

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
  client: s.client,
  terminalId: s.terminalId ?? null,
  createdAt: s.createdAt,
  lastSeenAt: s.lastSeenAt,
  expiresAt: s.expiresAt,
});

/** `client` of POS PIN sessions (`createTerminalSession`). */
export const POS_SESSION_CLIENT = "srikit-pos";

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

export class AuthService {
  private readonly db: Db;
  private readonly cfg: Required<Omit<AuthConfig, "googleClientIds" | "testOtp" | "guestTokenSecret" | "firebaseProjectId" | "mfaSecret" | "mfaIssuer">> & {
    googleClientIds: string[];
    guestTokenSecret: string | null;
    firebaseProjectId: string | null;
  };
  private readonly testOtp: { code: string; targets: string[] } | null;
  private readonly verifyGoogle: GoogleTokenVerifier;
  private readonly verifyFirebase: FirebaseTokenVerifier | null;
  /** Two-factor (TOTP); null without `config.mfaSecret`. */
  readonly mfa: MfaService | null;
  private readonly mfaSecret: string | null;

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
      firebaseProjectId: c.firebaseProjectId?.trim() || null,
      smsOtpDisabled: c.smsOtpDisabled ?? false,
      mobileSessionTtlDays: c.mobileSessionTtlDays && c.mobileSessionTtlDays > 0 ? c.mobileSessionTtlDays : 90,
    };
    const t = c.testOtp;
    const targets = (t?.targets ?? []).map((s) => s.trim()).filter(Boolean);
    this.testOtp = t && /^\d{4,10}$/.test(t.code) && targets.length ? { code: t.code, targets } : null;
    this.verifyGoogle = deps.verifyGoogleToken ?? createGoogleVerifier();
    const projectId = this.cfg.firebaseProjectId;
    this.mfaSecret = c.mfaSecret ? createHash("sha256").update(`mfa-challenge:${c.mfaSecret}`).digest("hex") : null;
    this.mfa = c.mfaSecret ? new MfaService(deps.db, createSecretBox(c.mfaSecret), createHash("sha256").update(`mfa-recovery:${c.mfaSecret}`).digest("hex"), c.mfaIssuer ?? "RBMS") : null;
    this.verifyFirebase = projectId ? (deps.verifyFirebaseToken ?? createFirebaseVerifier({ projectId })) : null;
  }

  /** Which sign-in methods clients should offer (`GET /config`). */
  clientConfig(): AuthClientConfig {
    const firebase = !!this.verifyFirebase;
    return {
      phone: { method: firebase ? "firebase" : "otp", firebaseProjectId: this.cfg.firebaseProjectId, smsOtp: !this.cfg.smsOtpDisabled },
      google: this.cfg.googleClientIds.length > 0,
      password: firebase,
      ...(this.testOtp ? { testTargets: [...this.testOtp.targets] } : {}),
    };
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
    /** Which sign-in options of the shop apply (routes pass it from the audience header). */
    audience?: Audience;
  }): Promise<{ target: string; channel: OtpChannel; expiresInSeconds: number; resendInSeconds: number }> {
    const target = this.parseTarget(input.target);
    const channel: OtpChannel = input.channel ?? (target.kind === "phone" ? "sms" : "email");
    if (target.kind === "phone" && channel === "email") throw badRequest("Use sms or whatsapp for a phone number");
    if (target.kind === "email" && channel !== "email") throw badRequest("Use email for an email address");

    if (!this.isTestTarget(target.value)) await this.assertMethodAllowed(input.tenantId, input.audience, methodForChannel(channel));

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

    if (target.kind === "phone" && channel === "sms" && this.cfg.smsOtpDisabled) {
      throw new AppError(400, "sms_via_firebase", "SMS codes are sent through Firebase phone sign-in. Please update or reload the app.");
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
    client?: string | null;
    name?: string | null;
    /** The shop and audience whose sign-in options apply (routes pass them when the request has a shop). */
    policy?: SignInPolicy | null;
  }): Promise<SignInResult | MfaPending> {
    const target = this.parseTarget(input.target);
    const channel = await this.checkOtpCode(target, input.code);
    // A code requested without a shop can't be redeemed for a shop that turned that channel off.
    if (channel) await this.assertMethodAllowed(input.policy?.tenantId, input.policy?.audience, methodForChannel(channel));
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
  /** Checks and consumes a code. Returns the channel it was sent on (null for a dev test identity). */
  private async checkOtpCode(target: Target, rawCode: string): Promise<OtpChannel | null> {
    if (this.isTestTarget(target.value)) {
      const code = String(rawCode ?? "").replace(/\s/g, "");
      if (!safeEqual(code, this.testOtp!.code)) throw badRequest("Incorrect code");
      return null;
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
    return otp.channel;

  }

  /** True when test OTPs are configured and `target` (normalised) is one of the test identities. */
  isTestTarget(target: string): boolean {
    return !!this.testOtp && matchesTestTarget(target, this.testOtp.targets);
  }

  private async signInTarget(
    target: string,
    input: SignInInput & { name?: string | null },
  ): Promise<SignInResult | MfaPending> {
    const { user, isNewUser } = await this.findOrCreateByTarget(target, { name: input.name ?? null });
    this.assertCanSignIn(user);
    if (!isNewUser && !user.name && input.name?.trim()) {
      await this.db.update(users).set({ name: input.name.trim() }).where(eq(users.id, user.id));
    }
    // Test identities (TEST_OTP) never meet the second step, so e2e and demo flows keep working.
    return this.completeSignIn(user.id, isNewUser, { ...input, skipMfa: input.skipMfa || this.isTestTarget(target) });
  }

  // ---------------------------------------------------------------- Google

  async signInWithGoogle(input: { idToken: string; ip?: string | null; userAgent?: string | null; client?: string | null; policy?: SignInPolicy | null }): Promise<SignInResult | MfaPending> {
    await this.assertMethodAllowed(input.policy?.tenantId, input.policy?.audience, "google");
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
    return this.signInGoogleIdentity({ sub: claims.sub, email, name: claims.name ?? null, picture: claims.picture ?? null }, input);
  }

  /** A verified Google account (from a Google ID token or a Firebase "google.com" sign-in): find or create the user by email. */
  private async signInGoogleIdentity(
    g: { sub: string | null; email: string; name: string | null; picture: string | null },
    input: SignInInput,
  ): Promise<SignInResult | MfaPending> {
    const { sub, email } = g;
    const [linked] = sub
      ? await this.db
          .select({ user: users })
          .from(authIdentities)
          .innerJoin(users, eq(users.id, authIdentities.userId))
          .where(and(eq(authIdentities.provider, "google"), eq(authIdentities.providerUserId, sub)))
          .limit(1)
      : [];

    let userId: string;
    let isNewUser = false;
    if (linked) {
      this.assertCanSignIn(toAuthUser(linked.user));
      userId = linked.user.id;
    } else {
      const res = await this.findOrCreateByTarget(email, { name: g.name, avatarUrl: g.picture });
      this.assertCanSignIn(res.user);
      userId = res.user.id;
      isNewUser = res.isNewUser;
      if (sub) {
        await this.db
          .insert(authIdentities)
          .values({ userId, provider: "google", providerUserId: sub, email })
          .onConflictDoNothing();
      }
      if (!isNewUser && (!res.user.name || !res.user.avatarUrl)) {
        await this.db
          .update(users)
          .set({ name: res.user.name ?? g.name ?? null, avatarUrl: res.user.avatarUrl ?? g.picture ?? null })
          .where(eq(users.id, userId));
      }
    }
    return this.completeSignIn(userId, isNewUser, input);
  }

  // ---------------------------------------------------------------- Firebase (phone, Google)

  /**
   * Signs in with a Firebase Phone Authentication ID token: the verified `phone_number` goes through the same path as a
   * verified phone OTP (find-or-create by phone, status check, session). 503 not_configured without a project id;
   * 400 with a `firebase_*` code when the token is rejected (503 `firebase_keys_unavailable` when Google's keys can't
   * be fetched).
   */
  async signInWithFirebase(input: {
    idToken: string;
    name?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    client?: string | null;
    policy?: SignInPolicy | null;
  }): Promise<SignInResult | MfaPending> {
    if (!this.verifyFirebase) throw new AppError(503, "not_configured", "Firebase phone sign-in is not configured");
    let claims: FirebasePhoneClaims;
    try {
      claims = await this.verifyFirebase(input.idToken);
    } catch (err) {
      if (err instanceof FirebaseTokenError) {
        this.deps.log?.warn({ code: err.code }, "auth: Firebase token rejected");
        throw new AppError(err.code === "firebase_keys_unavailable" ? 503 : 400, err.code, err.message);
      }
      this.deps.log?.warn({ err }, "auth: Firebase token check failed");
      throw new AppError(400, "firebase_token_invalid", "This phone sign-in could not be checked. Please try again.");
    }
    // The shop's choice applies to what the token proves (phone SMS, Google, email + password), checked server-side.
    await this.assertMethodAllowed(input.policy?.tenantId, input.policy?.audience, methodForFirebaseProvider(claims.provider));
    if (claims.provider === "password") {
      // Email + password (Firebase hashes, throttles and sends the reset mail). The verifier already insists on a
      // verified email; the user is found or created by that email, like Google.
      const email = claims.email ? normalizeEmail(claims.email) : null;
      if (!email) throw new AppError(400, "firebase_no_email", "This sign-in has no verified email address.");
      return this.signInTarget(email, { ...input, name: input.name ?? claims.name ?? null });
    }
    if (claims.provider === "google.com") {
      // Same rules as POST /auth/google: only a verified email, matched to (or creating) the user with that email.
      const email = claims.email ? normalizeEmail(claims.email) : null;
      if (!email) throw new AppError(400, "firebase_no_email", "Your Google account email is not verified.");
      return this.signInGoogleIdentity({ sub: claims.googleSub ?? null, email, name: claims.name ?? null, picture: claims.picture ?? null }, input);
    }
    const normalized = normalizePhone(claims.phone);
    if (!normalized) throw new AppError(400, "firebase_no_phone", "This phone number can't be used to sign in.");
    return this.signInTarget(normalized, input);
  }

  // ---------------------------------------------------------------- Sign-in options per shop

  /** What this platform can offer right now. */
  platformMethods(): PlatformMethods {
    return platformMethods({ firebase: !!this.verifyFirebase, googleClientIds: this.cfg.googleClientIds.length, smsOtpDisabled: this.cfg.smsOtpDisabled });
  }

  /** The shop's saved choice (defaults when it never saved one). */
  async getSignInOptions(tenantId: string): Promise<SignInOptions> {
    const [row] = await this.db.select().from(authTenantSettings).where(eq(authTenantSettings.tenantId, tenantId)).limit(1);
    return {
      staff: readAudienceOptions(row?.staff, DEFAULT_SIGN_IN_OPTIONS.staff),
      customer: readAudienceOptions(row?.customer, DEFAULT_SIGN_IN_OPTIONS.customer),
    };
  }

  /**
   * The methods people really get: the shop's choice intersected with the platform, preferred first. Without a shop
   * (the platform's own login, the landing site's shop-less sign-in) nothing is restricted: every platform method.
   */
  async effectiveSignIn(tenantId: string | null | undefined, audience: Audience): Promise<AudienceOptions> {
    const platform = this.platformMethods();
    if (!tenantId) {
      const all = SIGN_IN_METHODS.filter((m) => platform[m]);
      return effectiveAudience({ methods: all, default: DEFAULT_SIGN_IN_OPTIONS[audience].default }, platform);
    }
    return effectiveAudience((await this.getSignInOptions(tenantId))[audience], platform);
  }

  /** `GET /settings`: the saved options, the defaults and what the platform offers. */
  async signInSettings(tenantId: string) {
    return { options: await this.getSignInOptions(tenantId), defaults: DEFAULT_SIGN_IN_OPTIONS, platform: this.platformMethods() };
  }

  /**
   * `PUT /settings`: saves one or both audiences. Each needs at least one method (and at least one the platform really
   * offers, so a shop can't switch itself to a method nobody can use). Returns before/after for the audit entry.
   */
  async updateSignInOptions(tenantId: string, patch: SignInOptionsPatch, userId: string | null) {
    const parsed = signInOptionsPatchSchema.parse(patch);
    const platform = this.platformMethods();
    for (const audience of ["staff", "customer"] as const) {
      const next = parsed[audience];
      if (next && !next.methods.some((m) => platform[m])) {
        throw new AppError(400, "no_method_enabled", "Keep at least one sign-in method on that works on this platform.", { audience });
      }
    }
    const before = await this.getSignInOptions(tenantId);
    if (parsed.staff?.requireMfa && !this.mfa) throw new AppError(400, "mfa_not_available", "Two-factor sign-in is not available on this platform.");
    // `requireMfa` belongs to staff only, and an update that does not mention it keeps the shop's current choice.
    const staff: AudienceOptions = parsed.staff ? { ...parsed.staff, requireMfa: parsed.staff.requireMfa ?? before.staff.requireMfa } : { ...before.staff };
    if (staff.requireMfa !== true) delete staff.requireMfa;
    const customer: AudienceOptions = parsed.customer ? { methods: parsed.customer.methods, default: parsed.customer.default } : before.customer;
    const after: SignInOptions = { staff, customer };
    const row = { staff: after.staff as unknown as Record<string, unknown>, customer: after.customer as unknown as Record<string, unknown>, updatedBy: userId };
    await this.db
      .insert(authTenantSettings)
      .values({ tenantId, ...row })
      .onConflictDoUpdate({ target: authTenantSettings.tenantId, set: { ...row, updatedAt: new Date() } });
    return { before, after, options: after, defaults: DEFAULT_SIGN_IN_OPTIONS, platform };
  }

  /** The shop behind `slug` (for `GET /config?shop=`); 404 when unknown. */
  async shopForConfig(slug: string): Promise<{ id: string; slug: string; name: string }> {
    const clean = (slug ?? "").trim().toLowerCase();
    const storeShop = this.deps.storeOrigins;
    const lookup = this.deps.shopBySlug ?? (storeShop ? (s: string) => storeShop.shop(s) : null);
    const shop = lookup && clean ? await lookup(clean) : null;
    if (!shop) throw notFound("Shop");
    return { id: shop.id, slug: shop.slug, name: shop.name };
  }

  /**
   * Refuses a sign-in method the shop turned off for this audience: 403 `method_disabled`. No shop (the platform's own
   * login, the landing site's shop-less sign-in) means no restriction.
   */
  async assertMethodAllowed(tenantId: string | null | undefined, audience: Audience | undefined, method: SignInMethod): Promise<void> {
    if (!tenantId) return;
    const eff = await this.effectiveSignIn(tenantId, audience ?? "staff");
    if (!eff.methods.includes(method)) {
      throw new AppError(403, "method_disabled", "This way of signing in is turned off for this shop. Please use another option.", { method, audience: audience ?? "staff" });
    }
  }

  // ---------------------------------------------------------------- Cross-origin handoff

  /**
   * A one-time code that signs the same user in on another origin (the landing site hands a new shop owner over to the
   * shop's app): single use, valid for `HANDOFF_TTL_SECONDS`, only its hash is stored.
   */
  async createHandoff(userId: string, meta: SessionMeta = {}, tenantId: string | null = null): Promise<{ code: string; expiresAt: Date; expiresInSeconds: number }> {
    const now = new Date();
    const code = randomToken(24);
    const expiresAt = new Date(now.getTime() + HANDOFF_TTL_SECONDS * 1000);
    await this.db.insert(authHandoffs).values({ codeHash: sha256(code), userId, tenantId, expiresAt, ip: meta.ip ?? null });
    // Housekeeping: codes are worthless a minute later.
    await this.db.delete(authHandoffs).where(lt(authHandoffs.expiresAt, new Date(now.getTime() - 86_400_000)));
    return { code, expiresAt, expiresInSeconds: HANDOFF_TTL_SECONDS };
  }

  /** Where a handoff for one of the user's shops is redeemed (the shop's app), or 404 when not a member. */
  async handoffAppUrl(userId: string, tenantId: string): Promise<string> {
    const port = this.deps.handoffTargets;
    if (!port) throw badRequest("Handoff targets are not configured");
    const url = await port.appUrl(userId, tenantId);
    if (!url) throw notFound("Shop");
    return url;
  }

  /** The shop's public name and whether `origin` is one of its storefront origins (404 for an unknown or suspended shop). */
  async storeSignInContext(slug: string, origin?: string | null): Promise<{ shop: { slug: string; name: string }; origin: string | null }> {
    const port = this.deps.storeOrigins;
    if (!port) throw badRequest("Storefront sign-in is not configured");
    const shop = await port.shop((slug ?? "").trim().toLowerCase());
    if (!shop) throw notFound("Shop");
    return { shop: { slug: shop.slug, name: shop.name }, origin: matchStoreOrigin(origin, shop.origins) };
  }

  /**
   * A handoff for a shopper signing in to a shop's storefront. `origin` must be one of THAT shop's storefront origins
   * (its subdomain on the configured store host, or a verified custom domain) and `returnUrl`, when given, must sit on
   * it; otherwise 400 `invalid_store_origin`. The response repeats the validated origin: the only place to post the code.
   */
  async createStoreHandoff(
    userId: string,
    input: { shop: string; origin: string; returnUrl?: string | null },
    meta: SessionMeta = {},
  ): Promise<{ code: string; expiresAt: Date; expiresInSeconds: number; origin: string; returnUrl: string | null; tenantId: string }> {
    const port = this.deps.storeOrigins;
    if (!port) throw badRequest("Storefront sign-in is not configured");
    const shop = await port.shop((input.shop ?? "").trim().toLowerCase());
    if (!shop) throw notFound("Shop");
    const origin = matchStoreOrigin(input.origin, shop.origins);
    const bad = () => new AppError(400, "invalid_store_origin", "This address is not one of the shop's storefronts.");
    if (!origin) throw bad();
    let returnUrl: string | null = null;
    if (input.returnUrl) {
      returnUrl = matchStoreReturn(input.returnUrl, origin);
      if (!returnUrl) throw bad();
    }
    const h = await this.createHandoff(userId, meta, shop.id);
    return { ...h, origin, returnUrl, tenantId: shop.id };
  }

  /** Redeems a handoff code once (atomic; a code bound to a shop needs `requestTenantId` to match, and any mismatch burns it) and starts a new session for its user. 400 `invalid_handoff` otherwise. */
  async redeemHandoff(code: string, meta: SessionMeta = {}, requestTenantId: string | null = null): Promise<SignInResult> {
    const invalid = () => new AppError(400, "invalid_handoff", "This sign-in link has expired or was already used. Please sign in again.");
    if (typeof code !== "string" || code.length < 16 || code.length > 128) throw invalid();
    const now = new Date();
    const [row] = await this.db
      .update(authHandoffs)
      .set({ consumedAt: now })
      .where(and(eq(authHandoffs.codeHash, sha256(code)), isNull(authHandoffs.consumedAt), gt(authHandoffs.expiresAt, now)))
      .returning({ userId: authHandoffs.userId, tenantId: authHandoffs.tenantId });
    if (!row) throw invalid();
    // A storefront code is bound to its shop. Presented anywhere else it is refused like an unknown code, and it is
    // already burnt by the update above, so a leaked code can't be retried on the right shop either.
    if (row.tenantId && row.tenantId !== requestTenantId) throw invalid();
    const user = await this.getUser(row.userId);
    if (!user) throw invalid();
    this.assertCanSignIn(user);
    return this.finishSignIn(user.id, false, meta);
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
        expiresAt: addDays(now, meta.client ? this.cfg.mobileSessionTtlDays : this.cfg.sessionTtlDays),
        lastSeenAt: now,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ? meta.userAgent.slice(0, 512) : null,
        client: meta.client ?? null,
      })
      .returning();
    return { token, session: toSessionInfo(row!) };
  }

  /**
   * A POS PIN session (`@srirealtime/pos`): bound to one paired terminal, `client = "srikit-pos"`, a fixed lifetime
   * (default 12 h) that never slides. `authenticate` accepts it only with that terminal's id.
   */
  async createTerminalSession(
    userId: string,
    input: { terminalId: string; ttlMinutes?: number; ip?: string | null; userAgent?: string | null },
  ): Promise<{ token: string; session: SessionInfo }> {
    const token = randomToken();
    const now = new Date();
    const [row] = await this.db
      .insert(authSessions)
      .values({
        userId,
        tokenHash: sha256(token),
        expiresAt: addMinutes(now, input.ttlMinutes && input.ttlMinutes > 0 ? input.ttlMinutes : 12 * 60),
        lastSeenAt: now,
        ip: input.ip ?? null,
        userAgent: input.userAgent ? input.userAgent.slice(0, 512) : null,
        client: POS_SESSION_CLIENT,
        terminalId: input.terminalId,
      })
      .returning();
    return { token, session: toSessionInfo(row!) };
  }

  /** Revokes every active PIN session bound to a terminal (unpaired, re-paired or deleted). Returns how many. */
  async revokeTerminalSessions(terminalId: string): Promise<number> {
    const res = await this.db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.terminalId, terminalId), isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id });
    return res.length;
  }

  /** Revokes one session if it is an active PIN session of this terminal (the POS lock button). */
  async revokeTerminalSession(sessionId: string, terminalId: string): Promise<boolean> {
    const res = await this.db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.id, sessionId), eq(authSessions.terminalId, terminalId), isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id });
    return res.length > 0;
  }

  /**
   * Resolves a session token. Returns null for unknown, expired or revoked sessions and inactive users.
   * A terminal-bound (POS PIN) session needs `opts.terminalId` = its terminal (from the request's device token):
   * otherwise it throws 401 `device_required`.
   */
  async authenticate(token: string | null | undefined, opts: { terminalId?: string | null } = {}): Promise<{ user: AuthUser; session: SessionInfo } | null> {
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
    if (session.terminalId && session.terminalId !== (opts.terminalId ?? null)) {
      throw new AppError(401, "device_required", "This session works only on the paired POS terminal it was opened on");
    }
    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      // Mobile sessions slide; web sessions and POS PIN sessions keep the expiry they were given.
      const expiresAt = session.client && !session.terminalId ? addDays(now, this.cfg.mobileSessionTtlDays) : session.expiresAt;
      await this.db.update(authSessions).set({ lastSeenAt: now, expiresAt }).where(eq(authSessions.id, session.id));
      session.lastSeenAt = now;
      session.expiresAt = expiresAt;
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

  /**
   * Super-admin listing: search on email/name/phone, filters status and platform role, sort (name, email, phone,
   * created, lastActive; default newest first), facet counts per filter. See ./list.ts.
   */
  async listUsers(query: UserListQuery = {}): Promise<ListPage<AuthUser & { lastLoginAt: Date | null }> & { facets: Record<string, Record<string, number>> }> {
    const p = userListQuerySchema.parse(query);
    const where = userListConditions(p);
    const roleWhere = userListConditions(p, "role");
    const [page, byStatus, [byRole]] = await Promise.all([
      runList(p, {
        rows: () => this.db.select().from(users).where(where).orderBy(...USER_SORT.orderBy(p.sort)).limit(p.limit).offset(p.offset),
        count: () => this.db.select({ total: sql<number>`count(*)::int` }).from(users).where(where),
        // Last sign-in is a list column (and sort key) here; AuthUser elsewhere stays as it was.
        map: (u) => ({ ...toAuthUser(u), lastLoginAt: u.lastLoginAt }),
      }),
      this.db.select({ key: users.status, n: sql<number>`count(*)::int` }).from(users).where(userListConditions(p, "status")).groupBy(users.status),
      this.db
        .select({
          superadmin: sql<number>`(count(*) filter (where ${roleCondition("superadmin")}))::int`,
          none: sql<number>`(count(*) filter (where ${roleCondition("none")}))::int`,
        })
        .from(users)
        .where(roleWhere),
    ]);
    return {
      ...page,
      facets: { status: facetCounts(byStatus), role: { superadmin: Number(byRole?.superadmin ?? 0), none: Number(byRole?.none ?? 0) } },
    };
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

  /** Step 1 is done. Without two-factor (or for a test identity) this finishes the sign-in; otherwise it returns a challenge. */
  private async completeSignIn(userId: string, isNewUser: boolean, meta: SignInInput): Promise<SignInResult | MfaPending> {
    const gate = await this.mfaGate(userId, isNewUser, meta);
    if (gate) return gate;
    return this.finishSignIn(userId, isNewUser, meta);
  }

  /**
   * Does this sign-in need a second step? Yes when the user turned two-factor on (staff and business apps; shoppers on
   * a storefront are never asked), or when the shop requires it for owners/admins/managers and the user has not set it up.
   */
  private async mfaGate(userId: string, isNewUser: boolean, meta: SignInInput): Promise<MfaPending | null> {
    if (!this.mfa || !this.mfaSecret || meta.skipMfa) return null;
    if (meta.policy?.audience === "customer") return null;
    let purpose: MfaChallenge["purpose"] | null = null;
    if (await this.mfa.isEnabled(userId)) purpose = "verify";
    else if (meta.policy) {
      const required = (await this.getSignInOptions(meta.policy.tenantId)).staff.requireMfa === true;
      if (required) {
        const roles = await this.deps.memberships.rolesFor(meta.policy.tenantId, userId);
        if (roles.some((r) => (MFA_POLICY_ROLES as readonly string[]).includes(r))) purpose = "enrol";
      }
    }
    if (!purpose) return null;
    const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MS);
    const challengeToken = signMfaChallenge(this.mfaSecret, { userId, tenantId: meta.policy?.tenantId ?? null, purpose, isNewUser, expiresAt });
    return { mfaRequired: true, enrolRequired: purpose === "enrol", challengeToken, expiresAt };
  }

  /** Reads a challenge token from step 1 (400 `mfa_challenge_invalid` when expired or forged). */
  readMfaChallenge(token: string, purpose?: MfaChallenge["purpose"]): MfaChallenge {
    const c = this.mfaSecret ? verifyMfaChallenge(this.mfaSecret, token) : null;
    if (!c || (purpose && c.purpose !== purpose)) throw new AppError(400, "mfa_challenge_invalid", "This sign-in has expired. Please sign in again.");
    return c;
  }

  private requireMfa(): MfaService {
    if (!this.mfa) throw new AppError(503, "not_configured", "Two-factor sign-in is not configured");
    return this.mfa;
  }

  private mfaGone() {
    return new AppError(400, "mfa_challenge_invalid", "This sign-in has expired. Please sign in again.");
  }

  /** Step 2: checks the authenticator / recovery code against the challenge and opens the session. */
  async verifyMfaSignIn(input: { challengeToken: string; code: string } & SessionMeta): Promise<SignInResult & { method: "totp" | "recovery"; recoveryCodesLeft: number }> {
    const mfa = this.requireMfa();
    const c = this.readMfaChallenge(input.challengeToken, "verify");
    const r = await mfa.verifyCode(c.userId, input.code);
    const user = await this.getUser(c.userId);
    if (!user) throw this.mfaGone();
    this.assertCanSignIn(user);
    return { ...(await this.finishSignIn(c.userId, c.isNewUser, input)), ...r };
  }

  /** Enrolment during sign-in (the shop requires 2FA): starts with the challenge instead of a session. */
  async beginMfaEnrolFromChallenge(challengeToken: string) {
    const c = this.readMfaChallenge(challengeToken, "enrol");
    return { ...(await this.beginMfaEnrol(c.userId)), userId: c.userId, tenantId: c.tenantId };
  }
  async confirmMfaEnrolFromChallenge(input: { challengeToken: string; code: string } & SessionMeta) {
    const c = this.readMfaChallenge(input.challengeToken, "enrol");
    const { recoveryCodes } = await this.requireMfa().confirmEnrol(c.userId, input.code);
    const user = await this.getUser(c.userId);
    if (!user) throw this.mfaGone();
    this.assertCanSignIn(user);
    return { recoveryCodes, signIn: await this.finishSignIn(c.userId, c.isNewUser, input), userId: c.userId, tenantId: c.tenantId };
  }

  // ---- two-factor management for a signed-in user

  async mfaStatus(userId: string): Promise<MfaStatus & { available: boolean }> {
    if (!this.mfa) return { available: false, enabled: false, enabledAt: null, recoveryCodesLeft: 0 };
    return { available: true, ...(await this.mfa.status(userId)) };
  }
  async beginMfaEnrol(userId: string) {
    const mfa = this.requireMfa();
    const user = await this.getUser(userId);
    if (!user) throw notFound("User");
    return mfa.beginEnrol(userId, user.email ?? user.phone ?? user.name ?? "account");
  }
  confirmMfaEnrol(userId: string, code: string) {
    return this.requireMfa().confirmEnrol(userId, code);
  }
  /** Turning 2FA off needs a current code (authenticator or recovery): the re-authentication. */
  async disableMfa(userId: string, code: string) {
    const mfa = this.requireMfa();
    await mfa.verifyCode(userId, code);
    await mfa.disable(userId);
  }
  async regenerateMfaRecoveryCodes(userId: string, code: string) {
    const mfa = this.requireMfa();
    await mfa.verifyCode(userId, code);
    return mfa.regenerateRecoveryCodes(userId);
  }

  private async finishSignIn(userId: string, isNewUser: boolean, meta: SessionMeta): Promise<SignInResult> {
    const [row] = await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId)).returning();
    if (!row) throw notFound("User");
    const { token, session } = await this.createSession(userId, meta);
    return { token, expiresAt: session.expiresAt, user: toAuthUser(row), isNewUser };
  }
}
