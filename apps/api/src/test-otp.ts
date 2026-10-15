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
