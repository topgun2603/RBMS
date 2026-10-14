/** Delivers a one-time code. Implemented by the notify module and passed in by apps/api. */
export interface OtpSender {
  sendOtp(input: {
    channel: "sms" | "whatsapp" | "email";
    to: string;
    code: string;
    locale: string;
    ttlMinutes: number;
    tenantId?: string | null;
  }): Promise<void>;
}

/** Resolves a user's roles inside a tenant. Implemented by the tenancy module. */
export interface MembershipLookup {
  rolesFor(tenantId: string, userId: string): Promise<string[]>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

/** Verified claims of a Google ID token that auth relies on. */
export interface GoogleClaims {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
}

/**
 * Verifies a Google ID token (signature, issuer, audience, expiry) and returns its claims.
 * Injectable so tests can avoid the network; the default uses Google's JWKS via jose.
 */
export type GoogleTokenVerifier = (idToken: string, audience: string[]) => Promise<GoogleClaims>;
