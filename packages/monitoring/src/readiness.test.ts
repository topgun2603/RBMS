import { describe, expect, it } from "vitest";
import { checkReadiness, safeReason } from "./readiness";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("checkReadiness", () => {
  it("is ok when every probe passes and keeps probe details", async () => {
    const r = await checkReadiness({
      postgres: async () => {},
      redis: async () => ({ status: "ready" }),
    });
    expect(r.status).toBe("ok");
    expect(r.checks.postgres).toMatchObject({ ok: true });
    expect(r.checks.redis).toMatchObject({ ok: true, details: { status: "ready" } });
    expect(typeof r.checks.postgres!.latencyMs).toBe("number");
  });

  it("fails when one probe throws, and reports which", async () => {
    const r = await checkReadiness({
      postgres: async () => {},
      redis: async () => {
        throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:6379"), { code: "ECONNREFUSED" });
      },
    });
    expect(r.status).toBe("fail");
    expect(r.checks.postgres!.ok).toBe(true);
    expect(r.checks.redis).toMatchObject({ ok: false, error: "connect ECONNREFUSED <host>" });
  });

  it("times out a hanging probe without waiting for it", async () => {
    const started = Date.now();
    const r = await checkReadiness({ queue: () => new Promise(() => {}), fast: async () => {} }, { timeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r.status).toBe("fail");
    expect(r.checks.queue).toMatchObject({ ok: false, error: "timed out after 50 ms" });
    expect(r.checks.fast!.ok).toBe(true);
  });

  it("runs probes in parallel", async () => {
    const started = Date.now();
    await checkReadiness({ a: () => sleep(60), b: () => sleep(60), c: () => sleep(60) }, { timeoutMs: 1000 });
    expect(Date.now() - started).toBeLessThan(170);
  });

  it("handles a synchronous throw", async () => {
    const r = await checkReadiness({
      x: () => {
        throw new Error("sync");
      },
    });
    expect(r.checks.x).toMatchObject({ ok: false, error: "sync" });
  });

  it("measures latency with the injected clock", async () => {
    let t = 0;
    const r = await checkReadiness({ a: async () => void (t += 12.34) }, { now: () => t });
    expect(r.checks.a!.latencyMs).toBe(12.3);
  });
});

describe("safeReason", () => {
  it("never leaks connection strings or credentials", () => {
    const reason = safeReason(new Error("password authentication failed for postgres://srikit:hunter2@db.internal:5432/srikit"));
    expect(reason).not.toContain("hunter2");
    expect(reason).not.toContain("db.internal");
    expect(reason).toContain("<url>");
  });

  it("prefixes an error code that isn't in the message, keeps only the first line, clips", () => {
    expect(safeReason(Object.assign(new Error("socket hang up\nat x"), { code: "ECONNRESET" }))).toBe("ECONNRESET: socket hang up");
    expect(safeReason(new Error("x".repeat(500))).length).toBe(120);
    expect(safeReason("plain")).toBe("plain");
  });
});
