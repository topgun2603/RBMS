import { defineModule } from "@srirealtime/core";
import { authContextHook } from "./hook";
import { authRoutes } from "./routes";
import * as schema from "./schema";
import { AuthService, type AuthDeps } from "./service";

/**
 * Phone/email OTP and Google sign-in, sessions and platform roles.
 * Register `contextHook` AFTER the tenancy hook (it reads `req.ctx.tenant` to resolve tenant roles).
 */
export function createAuth(deps: AuthDeps) {
  const service = new AuthService(deps);
  const module = defineModule({
    id: "auth",
    tables: { ...schema },
    routes: authRoutes(service),
  });
  const contextHook = authContextHook(service, deps.memberships, deps.log, deps.permissions);
  return { service, module, contextHook };
}

export { AuthService, createGoogleVerifier, toAuthUser } from "./service";
export type { AuthConfig, AuthDeps, AuthUser, DirectoryUser, GuestVerifyResult, SessionInfo, SessionMeta, SignInResult } from "./service";
export { signGuestToken, verifyGuestTokenWith } from "./guest-token";
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
