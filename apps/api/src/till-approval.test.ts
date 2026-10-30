import { AppError } from "@rbms/core";
import { describe, expect, it, vi } from "vitest";
import { APPROVAL_MAX_FAILURES } from "./discount-guard";
import { tillApprovals } from "./till-approval";

const manager = { userId: "m1", name: "Meena", roles: ["staff", "role:manager"], permissions: ["invoices.*"] };
const cashierPeer = { userId: "c2", name: "Kavin", roles: ["staff", "role:cashier"], permissions: ["invoices.create"] };

function setup(pins: Record<string, typeof manager | null>, limit = 5_000) {
  const audit = { record: vi.fn(async () => undefined) };
  let t = 1_000_000;
  const port = tillApprovals({ limit: async () => limit, memberForPin: async (_t, pin) => pins[pin] ?? null, audit: audit as never, now: () => t });
  return { port, audit, advance: (ms: number) => (t += ms) };
}

describe("tillApprovals", () => {
  it("hands the shop's limit to the till", async () => {
    expect(await setup({}, 12_300).port.varianceLimit("t1")).toBe(12_300);
  });

  it("a manager's PIN approves, and the approval is audited", async () => {
    const { port, audit } = setup({ "4321": manager });
    await expect(port.approve("t1", "4321", "cashier1")).resolves.toEqual({ userId: "m1", name: "Meena" });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "invoices.till.approved", actorUserId: "cashier1", entityType: "till_session", after: { approvedBy: "m1" } }));
  });

  it("refuses an unknown PIN, a member without the approval permission, and the cashier's own PIN", async () => {
    const own = { ...manager, userId: "cashier1" };
    const { port, audit } = setup({ "1111": cashierPeer as never, "2222": own });
    expect(await port.approve("t1", "9999", "cashier1")).toBeNull();
    expect(await port.approve("t1", "1111", "cashier1")).toBeNull();
    expect(await port.approve("t1", "2222", "cashier1")).toBeNull();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "invoices.till.approval_failed" }));
  });

  it("owners and admins who hold a PIN can approve without the permission key", async () => {
    const owner = { userId: "o1", name: "Raja", roles: ["owner"], permissions: [] };
    const { port } = setup({ "5555": owner });
    expect(await port.approve("t1", "5555", "cashier1")).toEqual({ userId: "o1", name: "Raja" });
  });

  it("locks the cashier out after five wrong PINs, for five minutes", async () => {
    const { port, advance } = setup({ "4321": manager });
    for (let i = 0; i < APPROVAL_MAX_FAILURES; i++) expect(await port.approve("t1", "0000", "cashier1")).toBeNull();
    const err = await port.approve("t1", "4321", "cashier1").catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 429, code: "rate_limited" });
    // Another cashier is not locked, and the lock lifts.
    expect(await port.approve("t1", "4321", "cashier2")).toMatchObject({ userId: "m1" });
    advance(5 * 60_000 + 1);
    expect(await port.approve("t1", "4321", "cashier1")).toMatchObject({ userId: "m1" });
  });
});
