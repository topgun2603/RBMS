import type { Db } from "@srirealtime/db";
import { describe, expect, it, vi } from "vitest";
import { createConsent } from "./index";
import { latestByPurpose, runErasers, runExporters } from "./logic";
import type { DataExporter } from "./ports";

const at = (iso: string) => new Date(iso);

describe("latestByPurpose", () => {
  it("keeps the latest decision per purpose regardless of input order", () => {
    const rows = [
      { purpose: "marketing_sms", granted: true, version: "1", source: "web", createdAt: at("2026-01-02T00:00:00Z") },
      { purpose: "terms", granted: true, version: "1", source: "android", createdAt: at("2026-01-01T00:00:00Z") },
      { purpose: "marketing_sms", granted: false, version: "2", source: "web", createdAt: at("2026-01-03T00:00:00Z") },
      { purpose: "marketing_sms", granted: true, version: "0", source: "web", createdAt: at("2025-12-01T00:00:00Z") },
    ];
    const out = latestByPurpose(rows);
    expect(out).toEqual({
      marketing_sms: { granted: false, version: "2", source: "web", at: at("2026-01-03T00:00:00Z") },
      terms: { granted: true, version: "1", source: "android", at: at("2026-01-01T00:00:00Z") },
    });
  });

  it("lets a later row win a timestamp tie", () => {
    const t = at("2026-01-01T00:00:00Z");
    const out = latestByPurpose([
      { purpose: "analytics", granted: true, version: "1", source: "web", createdAt: t },
      { purpose: "analytics", granted: false, version: "1", source: "web", createdAt: t },
    ]);
    expect(out.analytics?.granted).toBe(false);
  });

  it("returns {} for no rows", () => {
    expect(latestByPurpose([])).toEqual({});
  });
});

describe("runExporters", () => {
  it("collects every module and isolates failures", async () => {
    const onError = vi.fn();
    const now = at("2026-02-01T10:00:00Z");
    const payload = await runExporters(
      new Map<string, DataExporter>([
        ["auth", async (id: string) => ({ profile: { id } })],
        [
          "billing",
          async () => {
            throw new Error("db down");
          },
        ],
        ["notes", async () => undefined],
      ]),
      "u1",
      now,
      onError,
    );
    expect(payload).toEqual({
      generatedAt: "2026-02-01T10:00:00.000Z",
      userId: "u1",
      modules: { auth: { profile: { id: "u1" } }, billing: { error: "db down" }, notes: null },
    });
    expect(onError).toHaveBeenCalledWith("billing", expect.any(Error));
  });
});

describe("runErasers", () => {
  it("runs in reverse registration order so auth runs last", async () => {
    const calls: string[] = [];
    const mk = (id: string) => [id, async () => void calls.push(id)] as [string, () => Promise<void>];
    await runErasers([mk("auth"), mk("tenancy"), mk("uploads")], "u1");
    expect(calls).toEqual(["uploads", "tenancy", "auth"]);
  });

  it("stops at the first failure and names the module", async () => {
    const auth = vi.fn(async () => {});
    await expect(
      runErasers(
        [
          ["auth", auth],
          [
            "uploads",
            async () => {
              throw new Error("s3 error");
            },
          ],
        ],
        "u1",
      ),
    ).rejects.toThrow("uploads: s3 error");
    expect(auth).not.toHaveBeenCalled();
  });
});

describe("createConsent", () => {
  it("builds the module and defines queue handlers when a queue is given", () => {
    const define = vi.fn();
    const queue = { define, enqueue: vi.fn(async () => {}) };
    const { module, service } = createConsent({ db: {} as Db, queue });
    expect(module.id).toBe("consent");
    expect(module.tables).toHaveProperty("consentRecords");
    expect(define.mock.calls.map((c) => c[0])).toEqual(["consent.process", "consent.sweep"]);
    expect(service.scheduleSweep().name).toBe("consent.sweep");
  });

  it("rejects consent without a user or anonymous id", async () => {
    const { service } = createConsent({ db: {} as Db });
    await expect(service.record({ purposes: { terms: true }, version: "1", source: "web" })).rejects.toMatchObject({
      status: 400,
    });
  });
});
