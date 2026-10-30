import type { Db } from "@rbms/db";
import { describe, expect, it, vi } from "vitest";
import {
  addSkip,
  assembleStatus,
  removeSkip,
  runChecks,
  StepRegistry,
  visibleSteps,
  withTimeout,
  type OnboardingStep,
} from "./logic";
import { OnboardingService } from "./service";

const step = (key: string, order: number, extra: Partial<OnboardingStep> = {}): OnboardingStep => ({
  key,
  module: "test",
  label: key,
  description: `${key} step`,
  href: `settings/${key}`,
  order,
  check: async () => false,
  ...extra,
});

describe("registry", () => {
  it("orders by order, then key", () => {
    const r = new StepRegistry();
    r.register(step("logo", 20));
    r.register(step("profile", 10));
    r.register(step("b-product", 30));
    r.register(step("a-product", 30));
    expect(r.list().map((s) => s.key)).toEqual(["profile", "logo", "a-product", "b-product"]);
  });

  it("rejects duplicate and invalid keys", () => {
    const r = new StepRegistry();
    r.register(step("profile", 10));
    expect(() => r.register(step("profile", 5))).toThrow(/already/);
    expect(() => r.register(step("Bad Key", 5))).toThrow(/Invalid/);
  });
});

describe("feature filtering", () => {
  it("hides steps whose feature is off and keeps featureless steps", async () => {
    const steps = [step("profile", 1), step("payments", 2, { feature: "payments" }), step("zone", 3, { feature: "delivery" })];
    const on = new Set(["payments"]);
    const visible = await visibleSteps(steps, async (k) => on.has(k));
    expect(visible.map((s) => s.key)).toEqual(["profile", "payments"]);
  });

  it("treats a failing feature check as off; no gate shows everything", async () => {
    const steps = [step("payments", 2, { feature: "payments" })];
    expect(await visibleSteps(steps, async () => Promise.reject(new Error("down")))).toEqual([]);
    expect((await visibleSteps(steps, null)).length).toBe(1);
  });

  it("asks the gate once per feature", async () => {
    const gate = vi.fn(async () => true);
    await visibleSteps([step("a", 1, { feature: "x" }), step("b", 2, { feature: "x" })], gate);
    expect(gate).toHaveBeenCalledTimes(1);
  });
});

describe("checks", () => {
  it("runs in parallel; throw, reject and timeout are not done", async () => {
    vi.useFakeTimers();
    try {
      const steps = [
        step("ok", 1, { check: async () => true }),
        step("no", 2, { check: async () => false }),
        step("throws", 3, {
          check: () => {
            throw new Error("sync");
          },
        }),
        step("rejects", 4, { check: async () => Promise.reject(new Error("async")) }),
        step("slow", 5, { check: () => new Promise((r) => setTimeout(() => r(true), 10_000)) }),
      ];
      const errors: string[] = [];
      const p = runChecks(steps, "t1", 3000, (k) => errors.push(k));
      await vi.advanceTimersByTimeAsync(3001);
      const done = await p;
      expect(Object.fromEntries(done)).toEqual({ ok: true, no: false, throws: false, rejects: false, slow: false });
      expect(errors.sort()).toEqual(["rejects", "throws"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("withTimeout passes fast results through", async () => {
    expect(await withTimeout(Promise.resolve(true), 50)).toBe(true);
  });
});

describe("status", () => {
  const steps = [step("logo", 20), step("profile", 10), step("product", 30)];

  it("assembles ordered steps with done, skipped and counts", () => {
    const done = new Map([
      ["profile", true],
      ["logo", false],
      ["product", false],
    ]);
    const s = assembleStatus(steps, done, { skipped: ["logo", "gone-step"], dismissedAt: null });
    expect(s.steps.map((v) => [v.key, v.done, v.skipped])).toEqual([
      ["profile", true, false],
      ["logo", false, true],
      ["product", false, false],
    ]);
    expect(s).toMatchObject({ completed: 2, total: 3, dismissed: false });
    expect(s.steps[0]).toMatchObject({ label: "profile", description: "profile step", href: "settings/profile" });
  });

  it("a done step is not reported as skipped; dismissed comes from state", () => {
    const s = assembleStatus(steps, new Map([["logo", true]]), { skipped: ["logo"], dismissedAt: new Date() });
    expect(s.steps.find((v) => v.key === "logo")).toMatchObject({ done: true, skipped: false });
    expect(s.dismissed).toBe(true);
    expect(assembleStatus(steps, new Map(), null)).toMatchObject({ completed: 0, total: 3, dismissed: false });
  });

  it("skip / unskip helpers", () => {
    expect(addSkip([], "a")).toEqual(["a"]);
    expect(addSkip(["a"], "a")).toEqual(["a"]);
    expect(removeSkip(["a", "b"], "a")).toEqual(["b"]);
    expect(removeSkip(["b"], "a")).toEqual(["b"]);
  });
});

/** Single-tenant in-memory stand-in for the two queries the service makes. */
function fakeDb() {
  let row: Record<string, unknown> | null = null;
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
          row = row ? { ...row, ...set } : { skipped: [], dismissedAt: null, completedAt: null, ...v };
        },
      }),
    }),
  };
  return { db: db as unknown as Db, row: () => row };
}

describe("OnboardingService", () => {
  it("skip, unskip, dismiss and feature gate", async () => {
    const { db, row } = fakeDb();
    const service = new OnboardingService({
      db,
      featureGate: { isEnabled: async (_t, key) => key !== "delivery" },
    });
    service.registerStep(step("profile", 10, { check: async () => true }));
    service.registerStep(step("zone", 20, { feature: "delivery" }));
    service.registerStep(step("logo", 30));

    let s = await service.status("t1");
    expect(s.steps.map((v) => v.key)).toEqual(["profile", "logo"]);
    expect(s).toMatchObject({ completed: 1, total: 2, dismissed: false });

    s = await service.skip("t1", "logo");
    expect(s.steps[1]).toMatchObject({ key: "logo", skipped: true });
    expect(s.completed).toBe(2);
    expect(row()?.completedAt).toBeInstanceOf(Date);

    s = await service.unskip("t1", "logo");
    expect(s.steps[1]).toMatchObject({ skipped: false });
    expect(s.completed).toBe(1);

    s = await service.dismiss("t1");
    expect(s.dismissed).toBe(true);

    await expect(service.skip("t1", "nope")).rejects.toMatchObject({ status: 404 });
  });

  it("caches check results per tenant for the TTL", async () => {
    const { db } = fakeDb();
    let t = 0;
    const check = vi.fn(async () => true);
    const service = new OnboardingService({ db, now: () => new Date(t), cacheTtlMs: 30_000 });
    service.registerStep(step("profile", 10, { check }));
    await service.status("t1");
    t = 29_000;
    await service.status("t1");
    expect(check).toHaveBeenCalledTimes(1);
    t = 31_000;
    await service.status("t1");
    expect(check).toHaveBeenCalledTimes(2);
    service.invalidate("t1");
    await service.status("t1");
    expect(check).toHaveBeenCalledTimes(3);
  });
});
