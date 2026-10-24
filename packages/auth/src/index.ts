import { defineModule } from "@srirealtime/core";
import { authContextHook } from "./hook";
import { authRoutes } from "./routes";
import * as schema from "./schema";
import { AuthService, type AuthDeps } from "./service";

/**
 * Phone/email OTP, Firebase phone and Google sign-in, sessions and platform roles.
 * Register `contextHook` AFTER the tenancy hook (it reads `req.ctx.tenant` to resolve tenant roles).
 */
export function createAuth(deps: AuthDeps) {
  const service = new AuthService(deps);
  const module = defineModule({
    id: "auth",
    tables: { ...schema },
    routes: authRoutes(service, deps.audit),
  });
  const contextHook = authContextHook(service, deps.memberships, deps.log, deps.permissions);
  return { service, module, contextHook };
}

export { AuthService, createGoogleVerifier, HANDOFF_TTL_SECONDS, parseClient, POS_SESSION_CLIENT, toAuthUser } from "./service";
export type { AuthClientConfig, AuthConfig, AuthDeps, SignInPolicy, AuthUser, DirectoryUser, GuestVerifyResult, SessionInfo, SessionMeta, SignInResult } from "./service";
export { signGuestToken, verifyGuestTokenWith } from "./guest-token";
export {
  cachedKeySource,
  createFirebaseVerifier,
  FIREBASE_KEYS_URL,
  FirebaseTokenError,
  googleSecureTokenKeys,
  maxAgeFrom,
} from "./firebase";
export type { FirebaseKeySource, FirebasePhoneClaims, FirebaseTokenErrorCode, FirebaseTokenVerifier, FirebaseVerifierOptions } from "./firebase";
export { FIREBASE_SIGNINS_PER_WINDOW, FIREBASE_WINDOW_MS, SlidingWindow } from "./routes";
export type { GoogleClaims, GoogleTokenVerifier, LoggerPort, MembershipLookup, OtpSender, PermissionResolverPort } from "./ports";
export {
  detectTarget,
  maskTarget,
  matchesTestTarget,
  normalizeEmail,
  normalizePhone,
  otpHash,
  otpRetryAfter,
  parseBearer,
  parseCookies,
  sessionCookie,
} from "./helpers";
export type { Target, OtpRateLimitInput } from "./helpers";
export { authContextHook, defaultPermissionsFor, tokenFromRequest } from "./hook";
export * from "./schema";
export { USER_ROLE_FILTERS, USER_SORT, USER_STATUSES, userListConditions, userListQuerySchema, type UserListParams, type UserListQuery } from "./list";
export { matchStoreOrigin, matchStoreReturn, normalizeOrigin, storeOriginsFor } from "./store-origin";
export type { StoreOriginsPort, StoreSignInShop } from "./store-origin";
export {
  AUDIENCE_HEADER,
  AUDIENCES,
  audienceFromHeader,
  audienceOptionsSchema,
  DEFAULT_SIGN_IN_OPTIONS,
  effectiveAudience,
  platformMethods,
  readAudienceOptions,
  SIGN_IN_METHODS,
  signInOptionsPatchSchema,
} from "./sign-in-options";
export type { Audience, AudienceOptions, PlatformMethods, SignInMethod, SignInOptions, SignInOptionsPatch } from "./sign-in-options";
