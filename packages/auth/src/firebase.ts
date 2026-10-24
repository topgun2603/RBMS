import { createPublicKey, X509Certificate, type KeyObject } from "node:crypto";
import { errors as joseErrors, jwtVerify, type JWTPayload } from "jose";

/**
 * Firebase Phone Authentication ID tokens, verified without firebase-admin: an RS256 JWT signed by one of the
 * `securetoken@system.gserviceaccount.com` keys, issued for our project (docs/firebase-auth.md).
 */

/** Google's signing certificates for Firebase ID tokens (PEM X.509, keyed by `kid`). */
export const FIREBASE_KEYS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

/** The verified part of a Firebase sign-in that auth relies on (a phone check or a Google sign-in). */
export interface FirebasePhoneClaims {
  /** Firebase user id (`sub`). */
  uid: string;
  /** How the user signed in: the SMS check, or Google. */
  provider: "phone" | "google.com";
  /** Verified phone number, E.164 as Firebase sends it. Set for `provider: "phone"`, otherwise "". */
  phone: string;
  /** Google only: the verified email (lower-cased) and profile. */
  email?: string;
  name?: string;
  picture?: string;
  /** Google only: the Google account id (`firebase.identities["google.com"][0]`), the same value as the Google ID token's `sub`. */
  googleSub?: string;
  /** When the user completed the sign-in (seconds since epoch). */
  authTime: number;
}

/** Verifies a Firebase ID token from a phone sign-in. Throws `FirebaseTokenError` when it is not acceptable. */
export type FirebaseTokenVerifier = (idToken: string) => Promise<FirebasePhoneClaims>;

/**
 * Signing keys by `kid`: PEM X.509 certificates (what Google publishes) or PEM SPKI public keys (tests), and how long
 * the set may be cached (the response's Cache-Control max-age).
 */
export type FirebaseKeySource = () => Promise<{ keys: Record<string, string>; maxAgeSeconds: number }>;

export type FirebaseTokenErrorCode =
  | "firebase_token_invalid"
  | "firebase_token_expired"
  | "firebase_token_stale"
  | "firebase_wrong_project"
  | "firebase_not_phone"
  | "firebase_no_phone"
  | "firebase_no_email"
  | "firebase_bad_signature"
  | "firebase_unknown_key"
  | "firebase_keys_unavailable";

/** A rejected token. `code` says why; the message is safe to show and never echoes the token. */
export class FirebaseTokenError extends Error {
  constructor(
    readonly code: FirebaseTokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FirebaseTokenError";
  }
}

const MESSAGES: Record<FirebaseTokenErrorCode, string> = {
  firebase_token_invalid: "This phone sign-in could not be checked. Please try again.",
  firebase_token_expired: "This phone sign-in has expired. Please verify your number again.",
  firebase_token_stale: "This phone sign-in is too old. Please verify your number again.",
  firebase_wrong_project: "This phone sign-in was made for a different app.",
  firebase_not_phone: "Only phone number or Google sign-in is accepted here.",
  firebase_no_phone: "This sign-in has no verified phone number.",
  firebase_no_email: "Your Google account email is not verified.",
  firebase_bad_signature: "This phone sign-in could not be verified.",
  firebase_unknown_key: "This phone sign-in could not be verified.",
  firebase_keys_unavailable: "Phone sign-in is temporarily unavailable. Please try again shortly.",
};

const fail = (code: FirebaseTokenErrorCode) => new FirebaseTokenError(code, MESSAGES[code]);

/** "public, max-age=19302, must-revalidate, no-transform" → 19302 (0 when absent). */
export function maxAgeFrom(cacheControl: string | null | undefined): number {
  const m = /(?:^|[,\s])max-age=(\d+)/i.exec(cacheControl ?? "");
  return m ? Number(m[1]) : 0;
}

/** The default key source: Google's published certificates. */
export function googleSecureTokenKeys(fetchImpl: typeof fetch = fetch, url = FIREBASE_KEYS_URL): FirebaseKeySource {
  return async () => {
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Firebase keys: HTTP ${res.status}`);
    const body = (await res.json()) as unknown;
    if (!body || typeof body !== "object") throw new Error("Firebase keys: unexpected response");
    const keys: Record<string, string> = {};
    for (const [kid, pem] of Object.entries(body as Record<string, unknown>)) if (typeof pem === "string") keys[kid] = pem;
    return { keys, maxAgeSeconds: maxAgeFrom(res.headers.get("cache-control")) };
  };
}

function toKeyObject(pem: string): KeyObject {
  return pem.includes("BEGIN CERTIFICATE") ? new X509Certificate(pem).publicKey : createPublicKey(pem);
}

/**
 * Caches a key source until its max-age runs out (at least `minSeconds`, so a missing header doesn't refetch on every
 * sign-in). An unknown `kid` refetches early, at most once per `minSeconds`, so a key rotation is picked up.
 */
export function cachedKeySource(source: FirebaseKeySource, now: () => number = Date.now, minSeconds = 60) {
  let keys: Map<string, KeyObject> | null = null;
  let expiresAt = 0;
  let fetchedAt = 0;
  let inflight: Promise<Map<string, KeyObject>> | null = null;

  const refresh = () => {
    inflight ??= source()
      .then((r) => {
        const next = new Map<string, KeyObject>();
        for (const [kid, pem] of Object.entries(r.keys)) {
          try {
            next.set(kid, toKeyObject(pem));
          } catch {
            // skip a malformed entry; the others still work
          }
        }
        keys = next;
        fetchedAt = now();
        expiresAt = fetchedAt + Math.max(r.maxAgeSeconds, minSeconds) * 1000;
        return next;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  return async (kid: string): Promise<KeyObject | null> => {
    let set = keys && now() < expiresAt ? keys : await refresh();
    let key = set.get(kid) ?? null;
    if (!key && now() - fetchedAt >= minSeconds * 1000) {
      set = await refresh();
      key = set.get(kid) ?? null;
    }
    return key;
  };
}

export interface FirebaseVerifierOptions {
  projectId: string;
  /** Default: Google's certificates over HTTPS. */
  keySource?: FirebaseKeySource;
  now?: () => number;
  /** Allowed clock difference for exp / iat / auth_time. Default 60 s. */
  clockSkewSeconds?: number;
  /** How long after the SMS check the token may be exchanged for a session. Default 10 minutes. */
  maxAuthAgeSeconds?: number;
}

/**
 * Checks: RS256 with a known `kid`; signature; `aud` = project id; `iss` = https://securetoken.google.com/<projectId>;
 * `exp` / `iat` within the clock skew; `auth_time` not in the future (and recent); `sub` non-empty;
 * `firebase.sign_in_provider` = "phone" (with `phone_number`) or "google.com" (with a verified `email`).
 */
export function createFirebaseVerifier(opts: FirebaseVerifierOptions): FirebaseTokenVerifier {
  const projectId = opts.projectId.trim();
  if (!projectId) throw new Error("createFirebaseVerifier: projectId is required");
  const issuer = `https://securetoken.google.com/${projectId}`;
  const now = opts.now ?? Date.now;
  const skew = opts.clockSkewSeconds ?? 60;
  const maxAuthAge = opts.maxAuthAgeSeconds ?? 600;
  const keyFor = cachedKeySource(opts.keySource ?? googleSecureTokenKeys(), now);

  return async (idToken) => {
    if (typeof idToken !== "string" || idToken.split(".").length !== 3) throw fail("firebase_token_invalid");
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(
        idToken,
        async (header) => {
          if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) throw fail("firebase_token_invalid");
          let key: KeyObject | null;
          try {
            key = await keyFor(header.kid);
          } catch {
            throw fail("firebase_keys_unavailable");
          }
          if (!key) throw fail("firebase_unknown_key");
          return key;
        },
        {
          algorithms: ["RS256"],
          audience: projectId,
          issuer,
          clockTolerance: skew,
          currentDate: new Date(now()),
          requiredClaims: ["exp", "iat", "sub"],
        },
      ));
    } catch (err) {
      throw mapJoseError(err);
    }

    const nowSec = Math.floor(now() / 1000);
    if (typeof payload.iat !== "number" || payload.iat > nowSec + skew) throw fail("firebase_token_invalid");
    const authTime = (payload as { auth_time?: unknown }).auth_time;
    if (typeof authTime !== "number" || authTime > nowSec + skew) throw fail("firebase_token_invalid");
    if (nowSec - authTime > maxAuthAge + skew) throw fail("firebase_token_stale");
    if (typeof payload.sub !== "string" || !payload.sub.trim()) throw fail("firebase_token_invalid");
    const firebase = (payload as { firebase?: { sign_in_provider?: unknown; identities?: Record<string, unknown> } }).firebase;
    const provider = firebase?.sign_in_provider;
    if (provider === "google.com") {
      const p = payload as { email?: unknown; email_verified?: unknown; name?: unknown; picture?: unknown };
      if (typeof p.email !== "string" || !p.email.includes("@") || p.email_verified !== true) throw fail("firebase_no_email");
      const ids = firebase?.identities?.["google.com"];
      const googleSub = Array.isArray(ids) && typeof ids[0] === "string" && ids[0] ? ids[0] : undefined;
      return {
        uid: payload.sub,
        provider: "google.com",
        phone: "",
        email: p.email.trim().toLowerCase(),
        ...(typeof p.name === "string" && p.name.trim() ? { name: p.name.trim() } : {}),
        ...(typeof p.picture === "string" && p.picture ? { picture: p.picture } : {}),
        ...(googleSub ? { googleSub } : {}),
        authTime,
      };
    }
    if (provider !== "phone") throw fail("firebase_not_phone");
    const phone = (payload as { phone_number?: unknown }).phone_number;
    if (typeof phone !== "string" || !/^\+\d{6,15}$/.test(phone)) throw fail("firebase_no_phone");
    return { uid: payload.sub, provider: "phone", phone, authTime };
  };
}

function mapJoseError(err: unknown): FirebaseTokenError {
  if (err instanceof FirebaseTokenError) return err;
  if (err instanceof joseErrors.JWTExpired) return fail("firebase_token_expired");
  if (err instanceof joseErrors.JWTClaimValidationFailed) {
    return err.claim === "aud" || err.claim === "iss" ? fail("firebase_wrong_project") : fail("firebase_token_invalid");
  }
  if (err instanceof joseErrors.JWSSignatureVerificationFailed) return fail("firebase_bad_signature");
  return fail("firebase_token_invalid");
}
