import { AppError } from "@srirealtime/core";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { APPROVAL_MAX_FAILURES, discountLimitGuard } from "./discount-guard";

const bill = (discount: number) => ({ lines: [{ qty: 1, rate: 100000, discount }] });
function req(body: unknown, opts: { roles?: string[]; pin?: string; user?: boolean } = {}) {
  return {
    body,
    headers: opts.pin ? { "x-approval-pin": opts.pin } : {},
    ctx: {
      tenant: { id: "t1" },
      user: opts.user === false ? null : { id: "cashier1", tenantRoles: opts.roles ?? ["staff", "role:cashier"] },
      ip: "1.1.1.1",
      userAgent: "x",
    },
  } as unknown as FastifyRequest;
}
function setup(limit: { maxPercentBp: number | null; maxAmount: number | null } | null = { maxPercentBp: 1000, maxAmount: null }, approver: Record<string, unknown> | null = null) {
  const audit = { record: vi.fn(async () => undefined) };
  const guard = discountLimitGuard({
    limits: { limitFor: async () => limit },
    memberForPin: async () => approver as never,
    audit: audit as never,
  });
  return { guard, audit };
}
const manager = { userId: "m1", name: "Meena", roles: ["staff", "role:manager"], permissions: ["invoices.*"] };

describe("discountLimitGuard", () => {
  it("lets through bills without discounts, within the limit, or for users without a limit", async () => {
    const { guard } = setup();
    await guard(req({ lines: [{ qty: 1, rate: 100 }] }));
    await guard(req(bill(10000))); // exactly 10%
    await guard(req({}));
    await setup(null).guard(req(bill(90000)));
    await guard(req(bill(90000), { roles: ["owner"] }));
    await guard(req(bill(90000), { user: false }));
  });

  it("refuses an over-limit discount with the numbers the UI needs", async () => {
    const { guard, audit } = setup();
    const err = await guard(req(bill(25000))).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 403, code: "discount_approval_required" });
    expect(err.details).toMatchObject({ breached: ["percent"], requestedPercent: 25, maxPercent: 10, requestedAmount: 25000 });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("checks the per-bill amount cap too", async () => {
    const { guard } = setup({ maxPercentBp: null, maxAmount: 5000 });
    await guard(req(bill(5000)));
    await expect(guard(req(bill(5001)))).rejects.toMatchObject({ code: "discount_approval_required" });
  });

  it("a manager PIN approves it and the approval is audited", async () => {
    const { guard, audit } = setup(undefined, manager);
    await guard(req(bill(25000), { pin: "4321" }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "invoices.discount.approved", actorUserId: "cashier1", after: expect.objectContaining({ approvedBy: "m1" }) }));
  });

  it("owners and admins can approve; members without the permission or the cashier themselves cannot", async () => {
    await setup(undefined, { ...manager, roles: ["owner"], permissions: [] }).guard(req(bill(25000), { pin: "1" }));
    const cashier = { userId: "c2", name: "Ravi", roles: ["staff", "role:cashier"], permissions: ["invoices.create", "invoices.discount"] };
    const a = setup(undefined, cashier);
    await expect(a.guard(req(bill(25000), { pin: "1" }))).rejects.toMatchObject({ code: "discount_approval_invalid" });
    expect(a.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "invoices.discount.approval_failed" }));
    await expect(setup(undefined, { ...manager, userId: "cashier1" }).guard(req(bill(25000), { pin: "1" }))).rejects.toMatchObject({ code: "discount_approval_invalid" });
    await expect(setup(undefined, null).guard(req(bill(25000), { pin: "1" }))).rejects.toMatchObject({ code: "discount_approval_invalid" });
  });

  it("locks the cashier out of guessing PINs", async () => {
    const { guard } = setup(undefined, null);
    for (let i = 0; i < APPROVAL_MAX_FAILURES; i++) await expect(guard(req(bill(25000), { pin: "0000" }))).rejects.toMatchObject({ code: "discount_approval_invalid" });
    await expect(guard(req(bill(25000), { pin: "0000" }))).rejects.toMatchObject({ status: 429 });
  });
});
