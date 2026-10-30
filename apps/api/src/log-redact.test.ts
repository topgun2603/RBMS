import { Writable } from "node:stream";
import { LOG_REDACT_PATHS } from "@rbms/monitoring";
import { pino } from "pino";
import { describe, expect, it } from "vitest";

/** The same redact config as main.ts, writing JSON lines into an array. */
function logger() {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { log: pino({ redact: { paths: LOG_REDACT_PATHS, censor: "[Filtered]" } }, sink), lines };
}

describe("API log redaction", () => {
  it("filters auth headers, OTPs, tokens and secrets but keeps error codes", () => {
    const { log, lines } = logger();
    log.info({
      req: { headers: { authorization: "Bearer abc", cookie: "sid=1", "x-api-key": "sk_live_x", host: "api" } },
      body: { phone: "+919999000001", otp: "123456", token: "t" },
      payment: { provider: { keySecret: "rzp_secret" } },
      err: { code: "ECONNREFUSED", message: "connect failed" },
    });
    const out = JSON.parse(lines[0]!);
    expect(out.req.headers).toEqual({ authorization: "[Filtered]", cookie: "[Filtered]", "x-api-key": "[Filtered]", host: "api" });
    expect(out.body).toEqual({ phone: "+919999000001", otp: "[Filtered]", token: "[Filtered]" });
    expect(out.payment.provider.keySecret).toBe("[Filtered]");
    expect(out.err.code).toBe("ECONNREFUSED");
  });
});
