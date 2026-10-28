import { PROTECTED_TABLES } from "@srirealtime/consent";
import type { Db } from "@srirealtime/db";
import { describe, expect, it } from "vitest";
import { createRetentionCategories, createSubjectHandlers } from "./kit-privacy";

const cats = createRetentionCategories({ db: {} as Db, uploads: () => ({}) as never });

describe("retention categories", () => {
  it("never touch a tax, GST or accounting table", () => {
    for (const c of cats) for (const t of c.touches) expect(PROTECTED_TABLES, `${c.key} touches ${t}`).not.toContain(t);
  });

  it("have unique keys, sane floors and a purge unless another job manages them", () => {
    expect(new Set(cats.map((c) => c.key)).size).toBe(cats.length);
    for (const c of cats) {
      expect(c.minDays).toBeGreaterThan(0);
      expect(c.defaultDays).toBeGreaterThanOrEqual(c.minDays);
      if (c.managedBy) expect(c.purge).toBeUndefined();
      else expect(typeof c.purge).toBe("function");
    }
  });

  it("keeps the pharmacy register 3 years and the staff data 8 years by default", () => {
    expect(cats.find((c) => c.key === "prescriptions")).toMatchObject({ minDays: 1095, defaultDays: 1095 });
    expect(cats.find((c) => c.key === "staff_after_exit")?.defaultDays).toBe(2920);
  });

  it("covers the categories the notice describes", () => {
    const keys = cats.map((c) => c.key);
    for (const k of ["abandoned_carts", "inactive_store_customers", "support_transcripts", "chat_messages", "whatsapp_chats", "prescriptions", "lapsed_members", "staff_after_exit", "kyc_documents", "otp_logs"]) {
      expect(keys).toContain(k);
    }
  });
});

describe("subject handlers", () => {
  it("cover the shop's customer records", () => {
    const ids = createSubjectHandlers({ db: {} as Db, uploads: () => ({}) as never }).map((h) => h.id);
    expect(ids).toEqual(["store_customers", "billing_customers", "loyalty_members", "membership_members", "wa_contacts", "support_tickets", "enquiries"]);
  });
});
