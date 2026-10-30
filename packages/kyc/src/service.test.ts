import { AppError, emptyContext, type AuditEvent, type RequestContext } from "@rbms/core";
import { describe, expect, it, vi } from "vitest";
import { MockKycDriver } from "./drivers/mock";
import { KycProviderError, type KycDriver } from "./drivers/types";
import type { KycStatusListener, LoggerPort, VendorAccessPort } from "./ports";
import { KycService, type KycConfig } from "./service";
import { MemoryKycStore } from "./store";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const VENDOR = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";
const ADMIN = "55555555-5555-4555-8555-555555555555";

const config: KycConfig = { allowMock: true, secret: "s3cret" };

function setup(over: { driver?: KycDriver; vendors?: VendorAccessPort; onStatusChange?: KycStatusListener; config?: Partial<KycConfig>; audit?: { record(e: AuditEvent): Promise<void> } } = {}) {
  let clock = new Date("2026-10-15T06:00:00Z").getTime();
  const now = () => new Date((clock += 1000));
  const store = new MemoryKycStore(now);
  const lines: unknown[] = [];
  const log: LoggerPort = { info: (o) => lines.push(o), warn: (o) => lines.push(o), error: (o) => lines.push(o) };
  const service = new KycService({ store, config: { ...config, ...over.config }, driver: over.driver, vendors: over.vendors, onStatusChange: over.onStatusChange, audit: over.audit, log, now });
  return { service, store, lines };
}

const vendorCheck = (type: string, input: Record<string, unknown>) => ({ subjectType: "vendor" as const, subjectId: VENDOR, type: type as never, input });

describe("construction", () => {
  it("refuses the mock driver when not allowed, and needs a secret", () => {
    expect(() => new KycService({ store: new MemoryKycStore(), config: { allowMock: false, secret: "x" } })).toThrow(/mock/);
    expect(() => new KycService({ store: new MemoryKycStore(), config: { allowMock: true, secret: "" } })).toThrow(/secret/);
    expect(() => new KycService({ store: new MemoryKycStore(), config: { allowMock: true, secret: "x", provider: "http" } })).toThrow(/http/);
    const s = new KycService({ store: new MemoryKycStore(), config: { allowMock: false, secret: "x", provider: "http", http: { baseUrl: "https://k", token: "t" } } });
    expect(s.driver.provider).toBe("http");
  });
});

describe("vendor flow", () => {
  it("PAN, then bank with a matching name → vendor verified; listener told", async () => {
    const onStatusChange = vi.fn();
    const { service } = setup({ onStatusChange });
    const p = await service.submitCheck(TENANT, ADMIN, vendorCheck("pan", { pan: "aaapl 1234c", name: "S. Gowtham Kumar" }));
    expect(p.check).toMatchObject({ type: "pan", status: "verified", provider: "mock", nameOnRecord: "S. GOWTHAM KUMAR", nameMatchScore: 100 });
    expect(p.check.input).toEqual({ pan: "XXXXXX234C", entityType: "Individual", name: "S. Gowtham Kumar" });
    expect(p.subject).toMatchObject({ status: "pending", verified: false, missing: ["Bank account or UPI ID"] });

    const b = await service.submitCheck(TENANT, ADMIN, vendorCheck("bank_account", { accountNumber: "1234 5678 1234", ifsc: "sbin0001234", name: "GOWTHAM KUMAR S" }));
    expect(b.check).toMatchObject({ status: "verified", nameMatchScore: 100 });
    expect(b.check.input).toEqual({ accountNumber: "XXXXXXXX1234", accountLast4: "1234", ifsc: "SBIN0001234", name: "GOWTHAM KUMAR S" });
    expect(b.subject).toMatchObject({ status: "verified", verified: true, verifiedName: "S. GOWTHAM KUMAR", badges: ["pan", "bank", "verified"] });

    expect(onStatusChange).toHaveBeenCalledTimes(2);
    expect(onStatusChange.mock.calls[1]![1]).toMatchObject({ status: "verified" });
    expect(onStatusChange.mock.calls[1]![2]).toBe("pending");

    expect(await service.status(TENANT, "vendor", VENDOR)).toMatchObject({ verified: true });
    expect(await service.status(OTHER_TENANT, "vendor", VENDOR)).toMatchObject({ status: "none", verified: false });
  });

  it("never stores or logs the raw account number", async () => {
    const { service, store, lines } = setup();
    await service.submitCheck(TENANT, ADMIN, vendorCheck("bank_account", { accountNumber: "987654321012", ifsc: "SBIN0001234" }));
    const dump = JSON.stringify([store.checks, store.subjects, lines]);
    expect(dump).not.toContain("987654321012");
    expect(store.checks[0]!.inputFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("bank holder name not matching the PAN → manual review → super-admin approves → verified", async () => {
    const { service } = setup();
    await service.submitCheck(TENANT, ADMIN, vendorCheck("pan", { pan: "ABCDE1234F" })); // TEST NAME
    const b = await service.submitCheck(TENANT, ADMIN, vendorCheck("bank_account", { accountNumber: "123456789999", ifsc: "SBIN0001234" }));
    expect(b.check).toMatchObject({ status: "manual_review", error: "name_mismatch", nameOnRecord: "SOMEONE ELSE", nameMatchScore: 0 });
    expect(b.subject.status).toBe("manual_review");

    const queue = await service.reviewQueue();
    expect(queue.total).toBe(1);
    expect(queue.items[0]).toMatchObject({ comparedWith: "TEST NAME", subject: { tenantId: TENANT, subjectType: "vendor", subjectId: VENDOR } });

    const approved = await service.approve(b.check.id, "sa-1", "Joint account, checked the cheque");
    expect(approved.check).toMatchObject({ status: "verified", error: null, review: { decision: "approved", by: "sa-1", reason: "Joint account, checked the cheque" } });
    expect(approved.subject).toMatchObject({ status: "verified", verified: true });
    expect((await service.reviewQueue()).total).toBe(0);
    await expect(service.approve(b.check.id, "sa-1")).rejects.toMatchObject({ status: 409 });
  });

  it("review decisions are audited under the check's shop, without the reason", async () => {
    const events: AuditEvent[] = [];
    const { service } = setup({ audit: { record: async (e) => void events.push(e) } });
    await service.submitCheck(TENANT, ADMIN, vendorCheck("pan", { pan: "ABCDE1234F" }));
    const b = await service.submitCheck(TENANT, ADMIN, vendorCheck("bank_account", { accountNumber: "123456789999", ifsc: "SBIN0001234" }));
    await service.approve(b.check.id, ADMIN, "Cheque 123456789999 matches", { ip: "1.2.3.4", userAgent: "UA" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tenantId: TENANT,
      actorUserId: ADMIN,
      action: "kyc.review.approve",
      entityType: "kyc_check",
      entityId: b.check.id,
      before: { status: "manual_review" },
      after: { status: "verified", decision: "approved" },
      ip: "1.2.3.4",
      userAgent: "UA",
    });
    expect(JSON.stringify(events)).not.toContain("123456789999");
    // A refused decision (not in review any more) records nothing.
    await expect(service.reject(b.check.id, ADMIN, "x")).rejects.toMatchObject({ status: 409 });
    expect(events).toHaveLength(1);
  });

  it("reject needs a reason and marks the check failed", async () => {
    const { service } = setup();
    const u = await service.submitCheck(TENANT, ADMIN, vendorCheck("upi", { vpa: "other@ybl", name: "Gowtham" }));
    expect(u.check.status).toBe("manual_review");
    await expect(service.reject(u.check.id, "sa", " ")).rejects.toMatchObject({ status: 400 });
    const r = await service.reject(u.check.id, "sa", "Name belongs to someone else");
    expect(r.check).toMatchObject({ status: "failed", error: "rejected", review: { decision: "rejected" } });
    expect(r.subject.status).toBe("failed");
  });
});

describe("local validation and limits", () => {
  it("bad formats are 400 and never reach the provider", async () => {
    const driver = new MockKycDriver();
    const spy = vi.spyOn(driver, "verifyGstin");
    const { service, store } = setup({ driver });
    await expect(service.submitCheck(TENANT, ADMIN, { subjectType: "shop", subjectId: TENANT, type: "gstin", input: { gstin: "33ABCDE1234F1Z8" } })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/check character/),
    });
    await expect(service.submitCheck(TENANT, ADMIN, vendorCheck("pan", { pan: "ABCD1234F" }))).rejects.toMatchObject({ status: 400 });
    await expect(service.submitCheck(TENANT, ADMIN, vendorCheck("bank_account", { accountNumber: "1234", ifsc: "SBIN0001234" }))).rejects.toMatchObject({ status: 400 });
    await expect(service.submitCheck(TENANT, ADMIN, vendorCheck("upi", { vpa: "nope" }))).rejects.toMatchObject({ status: 400 });
    expect(spy).not.toHaveBeenCalled();
    expect(store.checks).toHaveLength(0);
  });

  it("unknown input keys are refused (no Aadhaar numbers smuggled in)", async () => {
    const { service } = setup();
    await expect(
      service.submitCheck(TENANT, USER, { subjectType: "user", subjectId: USER, type: "digilocker_aadhaar", input: { aadhaarNumber: "234123412346" } }),
    ).rejects.toMatchObject({ status: 400, details: { fields: [expect.stringContaining("aadhaarNumber")] } });
  });

  it("shop subjects must use the shop's own id", async () => {
    const { service } = setup();
    await expect(service.submitCheck(TENANT, ADMIN, { subjectType: "shop", subjectId: OTHER_TENANT, type: "pan", input: { pan: "AAAPL1234C" } })).rejects.toMatchObject({ status: 400 });
  });

  it("rate-limits checks per subject and type per day", async () => {
    const { service } = setup({ config: { maxChecksPerDay: 2 } });
    await service.submitCheck(TENANT, ADMIN, vendorCheck("pan", { pan: "AAAPL1234C" }));
    await service.submitCheck(TENANT, ADMIN, vendorCheck("pan", { pan: "AAAPL1234C" }));
    await expect(service.submitCheck(TENANT, ADMIN, vendorCheck("pan", { pan: "AAAPL1234C" }))).rejects.toMatchObject({ status: 429 });
    await service.submitCheck(TENANT, ADMIN, vendorCheck("upi", { vpa: "a1@ybl" })); // other type still fine
  });

  it("selfie and document URLs must be uploads", async () => {
    const { service } = setup({ config: { fileUrlPrefixes: ["https://cdn.srikit.test/"] } });
    await expect(service.submitCheck(TENANT, USER, { subjectType: "user", subjectId: USER, type: "selfie", input: { selfieUrl: "https://evil.test/a.jpg" } })).rejects.toMatchObject({ status: 400 });
    await expect(service.addDocument(TENANT, USER, { subjectType: "user", subjectId: USER, kind: "pan_card", fileUrl: "javascript:alert(1)" })).rejects.toMatchObject({ status: 400 });
    const ok = await service.submitCheck(TENANT, USER, { subjectType: "user", subjectId: USER, type: "selfie", input: { selfieUrl: "https://cdn.srikit.test/s.jpg" } });
    expect(ok.check).toMatchObject({ status: "verified", result: { score: 95 } });
  });
});

describe("provider errors, selfie and DigiLocker", () => {
  it("a provider outage records a failed check with a code and logs no identifiers", async () => {
    const { service, lines } = setup();
    const r = await service.submitCheck(TENANT, ADMIN, vendorCheck("pan", { pan: "AAAPL1234Y" }));
    expect(r.check).toMatchObject({ status: "failed", error: "provider_server_error" });
    expect(JSON.stringify(lines)).not.toContain("AAAPL1234Y");
  });

  it("non-provider errors propagate", async () => {
    const driver = new MockKycDriver();
    vi.spyOn(driver, "verifyPan").mockRejectedValue(new Error("bug"));
    const { service } = setup({ driver });
    await expect(service.submitCheck(TENANT, ADMIN, vendorCheck("pan", { pan: "AAAPL1234C" }))).rejects.toThrow("bug");
  });

  it("low-confidence selfie → manual review", async () => {
    const { service } = setup();
    const r = await service.submitCheck(TENANT, USER, { subjectType: "user", subjectId: USER, type: "selfie", input: { selfieUrl: "https://cdn/review.jpg" } });
    expect(r.check).toMatchObject({ status: "manual_review", error: "low_confidence", result: { score: 65 } });
  });

  it("DigiLocker: pending with a consent URL, refresh completes, user verified", async () => {
    const { service } = setup({ config: { digilockerRedirectUrl: "https://shop.test/kyc/back" } });
    const start = await service.submitCheck(TENANT, USER, { subjectType: "user", subjectId: USER, type: "digilocker_aadhaar", input: { name: "Priya" } });
    expect(start.check).toMatchObject({ status: "pending", result: { actionUrl: expect.stringContaining("redirect=https%3A%2F%2Fshop.test") } });
    expect(start.subject.status).toBe("pending");
    const done = await service.refreshCheck(TENANT, start.check.id);
    expect(done.check).toMatchObject({ status: "verified", nameOnRecord: "PRIYA", nameMatchScore: 100, result: { aadhaarLast4: "1234" } });
    expect(done.subject).toMatchObject({ verified: true, badges: ["aadhaar", "verified"] });
    // refreshing a finished check is a no-op
    expect((await service.refreshCheck(TENANT, start.check.id)).check.status).toBe("verified");
    await expect(service.refreshCheck(OTHER_TENANT, start.check.id)).rejects.toMatchObject({ status: 404 });
  });

  it("DigiLocker refresh survives a provider error (stays pending)", async () => {
    const driver = new MockKycDriver();
    vi.spyOn(driver, "fetchDigilocker").mockRejectedValue(new KycProviderError("mock", 0, "t", "timeout"));
    const { service } = setup({ driver });
    const start = await service.submitCheck(TENANT, USER, { subjectType: "user", subjectId: USER, type: "digilocker_aadhaar", input: {} });
    expect((await service.refreshCheck(TENANT, start.check.id)).check.status).toBe("pending");
  });

  it("listener errors are logged, not thrown", async () => {
    const { service, lines } = setup({ onStatusChange: () => Promise.reject(new Error("down")) });
    await service.submitCheck(TENANT, ADMIN, { subjectType: "shop", subjectId: TENANT, type: "gstin", input: { gstin: "33ABCDE1234F1Z7" } });
    expect(JSON.stringify(lines)).toContain("down");
    expect((await service.status(TENANT, "shop", TENANT)).verified).toBe(true);
  });
});

describe("subjects and documents", () => {
  it("getSubject returns checks newest first and documents", async () => {
    const { service } = setup();
    expect(await service.getSubject(TENANT, "shop", TENANT)).toMatchObject({ status: "none", checks: [], documents: [] });
    await service.submitCheck(TENANT, ADMIN, { subjectType: "shop", subjectId: TENANT, type: "pan", input: { pan: "AAAPL1234Z" } });
    await service.submitCheck(TENANT, ADMIN, { subjectType: "shop", subjectId: TENANT, type: "gstin", input: { gstin: "33ABCDE1234F1Z7" } });
    const doc = await service.addDocument(TENANT, ADMIN, { subjectType: "shop", subjectId: TENANT, kind: "gst_certificate", fileUrl: "https://cdn/gst.pdf" });
    const s = await service.getSubject(TENANT, "shop", TENANT);
    expect(s.checks.map((c) => c.type)).toEqual(["gstin", "pan"]);
    expect(s.documents).toEqual([{ id: doc.id, kind: "gst_certificate", fileUrl: "https://cdn/gst.pdf", createdAt: expect.any(Date) }]);
    expect(s).toMatchObject({ status: "verified", verifiedName: "TEST NAME", badges: ["gstin", "verified"] });
    expect(await service.documentSubject(TENANT, doc.id)).toEqual({ subjectType: "shop", subjectId: TENANT });
    await service.removeDocument(TENANT, doc.id);
    await expect(service.removeDocument(TENANT, doc.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("assertAccess", () => {
  const tenant = { id: TENANT, slug: "s", planId: null, appId: null };
  const ctx = (tenantRoles: string[], over: Partial<RequestContext["user"] & object> = {}, permissions: string[] = []): RequestContext => ({
    ...emptyContext(),
    tenant,
    user: { id: USER, sessionId: "x", platformRoles: [], tenantRoles, permissions, ...over },
  });
  const vendors: VendorAccessPort = { isVendorOwner: async (_t, v, u) => v === VENDOR && u === USER };

  it("owner/admin and kyc.manage holders reach every subject", async () => {
    const { service } = setup({ vendors });
    await expect(service.assertAccess(ctx(["owner"]), "shop", TENANT)).resolves.toBe(TENANT);
    await expect(service.assertAccess(ctx(["staff"], {}, ["kyc.manage"]), "vendor", ADMIN)).resolves.toBe(TENANT);
    await expect(service.assertAccess(ctx(["member"], { id: ADMIN, platformRoles: ["superadmin"] }), "user", USER)).resolves.toBe(TENANT);
  });

  it("vendor owners for their vendor, users for themselves, nobody else", async () => {
    const { service } = setup({ vendors });
    await expect(service.assertAccess(ctx(["member"]), "vendor", VENDOR)).resolves.toBe(TENANT);
    await expect(service.assertAccess(ctx(["member"]), "user", USER)).resolves.toBe(TENANT);
    await expect(service.assertAccess(ctx(["member"]), "user", ADMIN)).rejects.toBeInstanceOf(AppError);
    await expect(service.assertAccess(ctx(["staff"]), "shop", TENANT)).rejects.toMatchObject({ status: 403 });
    await expect(service.assertAccess(ctx(["member"], { id: ADMIN }), "vendor", VENDOR)).rejects.toMatchObject({ status: 403 });
    await expect(service.assertAccess(ctx(["owner"]), "shop", OTHER_TENANT)).rejects.toMatchObject({ status: 400 });
    await expect(service.assertAccess({ ...emptyContext(), tenant }, "shop", TENANT)).rejects.toMatchObject({ status: 401 });
  });

  it("unknown vendors are 404 when the port can tell", async () => {
    const { service } = setup({ vendors: { ...vendors, vendorExists: async () => false } });
    await expect(service.assertAccess(ctx(["owner"]), "vendor", VENDOR)).rejects.toMatchObject({ status: 404 });
  });
});
