import { z } from "zod";
import type { OtpChannel } from "./schema";

/**
 * Per-shop sign-in options (docs/firebase-auth.md "Sign-in options per shop").
 *
 * Each shop picks, separately for its STAFF (business apps) and its CUSTOMERS (storefront), which methods are on and
 * which one is shown first. The platform still decides what exists at all (`PlatformMethods`): the effective list is the
 * shop's choice intersected with it. No settings row = the defaults below = how sign-in worked before this existed.
 */

export const SIGN_IN_METHODS = ["sms", "whatsapp", "email_code", "google", "password"] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];
export const signInMethodSchema = z.enum(SIGN_IN_METHODS);

export const AUDIENCES = ["staff", "customer"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const audienceSchema = z.enum(AUDIENCES);

/** The request header clients send to say which audience is signing in (the storefront proxy always sets "customer"). */
export const AUDIENCE_HEADER = "x-auth-audience";

export interface AudienceOptions {
  /** Enabled methods, in the order they are shown. */
  methods: SignInMethod[];
  /** The method shown first; always one of `methods`. */
  default: SignInMethod;
  /**
   * Staff only: owners, admins and managers of this shop must sign in with two-factor (TOTP) too; those without it
   * are taken through the setup at their next sign-in. Absent = off.
   */
  requireMfa?: boolean;
}
export interface SignInOptions {
  staff: AudienceOptions;
  customer: AudienceOptions;
}

/** Staff sign in with a phone code (SMS or WhatsApp), an email code or Google (owners often sign up with Google); shoppers too, Google first. */
export const DEFAULT_SIGN_IN_OPTIONS: SignInOptions = {
  staff: { methods: ["sms", "whatsapp", "email_code", "google"], default: "sms" },
  customer: { methods: ["google", "sms", "whatsapp", "email_code"], default: "google" },
};

export const audienceOptionsSchema = z
  .object({
    methods: z.array(signInMethodSchema).min(1, "Keep at least one sign-in method on").max(SIGN_IN_METHODS.length),
    default: signInMethodSchema,
    requireMfa: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.methods).size !== v.methods.length) ctx.addIssue({ code: "custom", path: ["methods"], message: "Each method can be listed once" });
    if (!v.methods.includes(v.default)) ctx.addIssue({ code: "custom", path: ["default"], message: "The preferred method must be one of the enabled methods" });
  });

/** `PUT /settings`: change one or both audiences. */
export const signInOptionsPatchSchema = z
  .object({ staff: audienceOptionsSchema.optional(), customer: audienceOptionsSchema.optional() })
  .refine((v) => v.staff || v.customer, { message: "Nothing to change" });
export type SignInOptionsPatch = z.infer<typeof signInOptionsPatchSchema>;

/** What exists on this platform right now (Firebase project set, Google configured, SMS available). */
export type PlatformMethods = Record<SignInMethod, boolean>;

export function platformMethods(c: { firebase: boolean; googleClientIds: number; smsOtpDisabled: boolean }): PlatformMethods {
  return {
    // Firebase sends the SMS, or our own OTP does (unless production has neither, which clientConfig never allows).
    sms: c.firebase || !c.smsOtpDisabled,
    whatsapp: true,
    email_code: true,
    // Google through Firebase, or the Google Identity token flow.
    google: c.firebase || c.googleClientIds > 0,
    // Email + password is a Firebase provider.
    password: c.firebase,
  };
}

/** Stored JSON -> options, tolerating junk (unknown methods dropped); anything unusable falls back to `fallback`. */
export function readAudienceOptions(raw: unknown, fallback: AudienceOptions): AudienceOptions {
  const r = raw && typeof raw === "object" ? (raw as { methods?: unknown; default?: unknown; requireMfa?: unknown }) : null;
  if (!r || !Array.isArray(r.methods)) return fallback;
  const methods = [...new Set(r.methods.filter((m): m is SignInMethod => SIGN_IN_METHODS.includes(m as SignInMethod)))];
  if (methods.length === 0) return fallback;
  const preferred = SIGN_IN_METHODS.includes(r.default as SignInMethod) && methods.includes(r.default as SignInMethod) ? (r.default as SignInMethod) : methods[0]!;
  return r.requireMfa === true ? { methods, default: preferred, requireMfa: true } : { methods, default: preferred };
}

/**
 * The methods a person really sees: the preferred one first, then the rest in the shop's order, minus what the platform
 * lacks. If that leaves nothing (the shop only enabled methods this platform doesn't have), every platform method is
 * offered rather than locking everyone out.
 */
export function effectiveAudience(opts: AudienceOptions, platform: PlatformMethods): AudienceOptions {
  const ordered = [opts.default, ...opts.methods.filter((m) => m !== opts.default)];
  let methods = ordered.filter((m) => platform[m]);
  if (methods.length === 0) methods = SIGN_IN_METHODS.filter((m) => platform[m]);
  return { methods, default: methods[0]! };
}

/** The sign-in method an OTP channel stands for. */
export const methodForChannel = (channel: OtpChannel): SignInMethod => (channel === "email" ? "email_code" : channel);

/** The sign-in method of a Firebase `sign_in_provider`. */
export function methodForFirebaseProvider(provider: "phone" | "google.com" | "password"): SignInMethod {
  return provider === "phone" ? "sms" : provider === "google.com" ? "google" : "password";
}

/** Parses the audience header; anything else (absent, wrong, other case) is "staff", the business apps and mobile. */
export function audienceFromHeader(value: unknown): Audience {
  const v = (Array.isArray(value) ? value[0] : value) as unknown;
  return typeof v === "string" && v.trim().toLowerCase() === "customer" ? "customer" : "staff";
}
