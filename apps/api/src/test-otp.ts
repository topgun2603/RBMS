import type { Env } from "./env";

/**
 * The test-OTP setting auth should use: only outside production and only with both a code and targets.
 * `note` is the line to log at startup (null when test OTPs were never asked for).
 */
export function testOtpConfig(e: Pick<Env, "NODE_ENV" | "TEST_OTP_CODE" | "TEST_OTP_TARGETS">): {
  testOtp: { code: string; targets: string[] } | undefined;
  note: string | null;
} {
  if (!e.TEST_OTP_CODE) return { testOtp: undefined, note: null };
  if (e.NODE_ENV === "production") return { testOtp: undefined, note: "TEST_OTP_CODE is ignored in production" };
  const targets = (e.TEST_OTP_TARGETS ?? "").split(",").map((t) => t.trim()).filter((t) => t && t !== "*");
  if (targets.length === 0) return { testOtp: undefined, note: "TEST_OTP_CODE is set but TEST_OTP_TARGETS is empty: test OTPs are off" };
  return { testOtp: { code: e.TEST_OTP_CODE, targets }, note: `test OTPs on (${e.NODE_ENV}) for ${targets.join(", ")}` };
}

/**
 * Phone sign-in settings for auth. With FIREBASE_PROJECT_ID, clients verify phones with Firebase. In production the SMS
 * path of `/otp/request` is then switched off unless a real SMS provider (MSG91) is configured: without one the
 * console driver would accept the code and silently drop it. Development keeps every path working.
 */
export function phoneAuthConfig(
  e: Pick<Env, "NODE_ENV" | "FIREBASE_PROJECT_ID" | "MSG91_AUTH_KEY" | "MSG91_SENDER_ID">,
): { firebaseProjectId: string | undefined; smsOtpDisabled: boolean; note: string | null } {
  const firebaseProjectId = e.FIREBASE_PROJECT_ID || undefined;
  if (!firebaseProjectId) return { firebaseProjectId: undefined, smsOtpDisabled: false, note: null };
  const realSms = !!(e.MSG91_AUTH_KEY && e.MSG91_SENDER_ID);
  const smsOtpDisabled = e.NODE_ENV === "production" && !realSms;
  return {
    firebaseProjectId,
    smsOtpDisabled,
    note: `Firebase phone sign-in on (project ${firebaseProjectId})${smsOtpDisabled ? "; SMS codes from /otp/request are refused (no SMS provider)" : ""}`,
  };
}
