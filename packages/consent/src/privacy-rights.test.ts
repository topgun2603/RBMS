import type { Db } from "@rbms/db";
import { describe, expect, it, vi } from "vitest";
import type { NoticeService } from "./privacy-notice-service";
import type { PrivacyHostPort } from "./privacy-ports";
import { RightsService } from "./privacy-rights";

/** Captures the inserted request row; the duplicate check finds nothing open. */
function setup(contact: { name: string | null; phone: string | null; email: string | null } | null) {
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        const row = { id: "r1", status: "new", createdAt: new Date(), updatedAt: new Date(), ...v };
        return Object.assign(Promise.resolve(), { returning: async () => [row] });
      },
    }),
  } as unknown as Db;
  const host = {
    settings: async () => ({ responseDays: 30 }),
    contactOf: vi.fn(async () => contact),
  } as unknown as PrivacyHostPort;
  const service = new RightsService({ db, host, notices: {} as NoticeService });
  return { service, request: () => inserted[0]! };
}

describe("rights requests from the store", () => {
  it("ignore a phone, email and name typed into the body and use the account's verified contact", async () => {
    const { service, request } = setup({ name: "Meena", phone: "+919876500001", email: "meena@example.in" });
    await service.create("t1", { type: "access", phone: "+919800000099", email: "victim@example.in", name: "Victim" }, { source: "store", userId: "u1" });
    expect(request()).toMatchObject({ subjectUserId: "u1", subjectName: "Meena", subjectPhone: "+919876500001", subjectEmail: "meena@example.in" });
  });

  it("keep no contact at all when the account has none, rather than the typed one", async () => {
    const { service, request } = setup(null);
    await service.create("t1", { type: "erasure", phone: "+919800000099" }, { source: "store", userId: "u1" });
    expect(request()).toMatchObject({ subjectUserId: "u1", subjectPhone: null, subjectEmail: null, subjectName: null });
  });

  it("counter requests still take the details staff type in", async () => {
    const { service, request } = setup(null);
    await service.create("t1", { type: "access", phone: "9800000099", name: "Walk-in" }, { source: "counter", actorId: "staff-1" });
    expect(request()).toMatchObject({ subjectUserId: null, subjectName: "Walk-in", subjectPhone: "+919800000099" });
  });
});
