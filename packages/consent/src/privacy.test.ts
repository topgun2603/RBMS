import { describe, expect, it } from "vitest";
import { boardDeadline, breachCountdown, breachDrafts, breachInputSchema } from "./privacy-breach";
import { buildNotice, durationText, noticeHash, noticeVersionLabel, type NoticeInput } from "./privacy-notice";
import { effectiveRetention, retentionCutoff } from "./privacy-retention";
import { isOverdue, normalisePhone } from "./privacy-rights";
import { normalisePrivacySettings, PRIVACY_SETTINGS_DEFAULTS } from "./privacy-settings";
import type { RetentionCategory } from "./privacy-ports";

const base: NoticeInput = {
  audience: "shop",
  shopName: "Meena Stores",
  legalName: "Meena Stores",
  address: "Madurai",
  modules: { storefront: true, loyalty: false, memberships: false, pharmacy: false, payroll: false, ai: false, messaging: false, delivery: false, services: false },
  contact: { name: "Meena", role: "Owner", phone: "+919876543210", email: "m@example.com", address: "" },
  responseDays: 30,
  retentionDays: { abandoned_carts: 30, inactive_store_customers: 1095 },
  taxYears: 8,
  extra: "",
};

const text = (n: ReturnType<typeof buildNotice>["en"]) => JSON.stringify(n);

describe("notice", () => {
  it("builds English and Tamil with the same sections and the review warning", () => {
    const n = buildNotice(base);
    expect(n.en.sections.map((s) => s.id)).toEqual(n.ta.sections.map((s) => s.id));
    expect(n.en.reviewNote).toMatch(/lawyer/);
    expect(n.ta.reviewNote.length).toBeGreaterThan(20);
    expect(n.ta.title).toContain("Meena Stores");
    expect(/[஀-௿]/.test(text(n.ta))).toBe(true);
  });

  it("mentions the contact, the deadline, 8-year tax keeping and withdrawal", () => {
    const n = buildNotice(base);
    const en = text(n.en);
    expect(en).toContain("+919876543210");
    expect(en).toContain("within 30 days");
    expect(en).toContain("8 years");
    expect(en).toContain("CGST");
    expect(n.en.sections.some((s) => s.id === "withdraw")).toBe(true);
  });

  it("adds module-specific data and leaves it out when the module is off", () => {
    const off = text(buildNotice(base).en);
    expect(off).not.toContain("Prescription");
    expect(off).not.toContain("AI provider");
    const on = buildNotice({
      ...base,
      modules: { ...base.modules, pharmacy: true, memberships: true, payroll: true, ai: true, messaging: true, loyalty: true },
      retentionDays: { ...base.retentionDays, prescriptions: 1095, staff_after_exit: 2920 },
    });
    const en = text(on.en);
    expect(en).toContain("Prescription");
    expect(en).toContain("AI provider");
    expect(en).toContain("Membership");
    expect(en).toContain("3 years");
    expect(text(on.ta)).toContain("மருந்துச் சீட்டு");
  });

  it("says so when no grievance contact is filled in", () => {
    const n = buildNotice({ ...base, contact: { name: "", role: "", phone: "", email: "", address: "" } });
    expect(text(n.en)).toContain("has not been filled in");
  });

  it("names RBMS and never the internal project names", () => {
    const all = text(buildNotice({ ...base, audience: "platform", shopName: "RBMS" }).en) + text(buildNotice(base).ta);
    expect(all).toContain("Retail & Business Management Suite");
    expect(all.toLowerCase()).not.toContain("srikit");
    expect(all.toLowerCase()).not.toContain("srirealtime");
  });

  it("is deterministic: the hash only changes when the text changes", () => {
    const a = noticeHash(buildNotice(base));
    expect(noticeHash(buildNotice(base))).toBe(a);
    expect(noticeHash(buildNotice({ ...base, responseDays: 15 }))).not.toBe(a);
    expect(noticeVersionLabel(3)).toBe("notice-v3");
  });

  it("formats durations", () => {
    expect(durationText(1095, "en")).toBe("3 years");
    expect(durationText(365, "en")).toBe("1 year");
    expect(durationText(180, "en")).toBe("6 months");
    expect(durationText(30, "en")).toBe("30 days");
    expect(durationText(1095, "ta")).toBe("3 ஆண்டுகள்");
  });
});

describe("retention", () => {
  const cat: RetentionCategory = { key: "prescriptions", scope: "shop", defaultDays: 1095, minDays: 1095, action: "anonymise", touches: ["medicine_prescriptions"] };
  it("never goes below the legal floor", () => {
    expect(effectiveRetention(cat, { retention: { prescriptions: { enabled: true, days: 30 } } }).days).toBe(1095);
    expect(effectiveRetention(cat, { retention: { prescriptions: { enabled: true, days: 2000 } } }).days).toBe(2000);
  });
  it("uses defaults and can be switched off", () => {
    expect(effectiveRetention(cat, { retention: {} })).toMatchObject({ days: 1095, enabled: true });
    expect(effectiveRetention(cat, { retention: { prescriptions: { enabled: false, days: 1095 } } }).enabled).toBe(false);
  });
  it("a managed category keeps its fixed period", () => {
    const m: RetentionCategory = { ...cat, key: "ai", managedBy: { job: "ai.purge-debug", days: 7 }, minDays: 1 };
    expect(effectiveRetention(m, { retention: { ai: { enabled: false, days: 99 } } })).toMatchObject({ days: 7, enabled: true });
  });
  it("cutoff is days before now", () => {
    const now = new Date("2026-10-27T00:00:00Z");
    expect(retentionCutoff(now, 30).toISOString()).toBe("2026-09-27T00:00:00.000Z");
  });
});

describe("breach", () => {
  const discovered = new Date("2026-10-27T10:00:00Z");
  const row = { boardDeadlineAt: boardDeadline(discovered), boardReportedAt: null };
  it("deadline is 72 hours after discovery", () => {
    expect(row.boardDeadlineAt.toISOString()).toBe("2026-10-30T10:00:00.000Z");
  });
  it("counts down: ok, due soon, overdue, done", () => {
    expect(breachCountdown(row, new Date("2026-10-27T12:00:00Z"))).toMatchObject({ state: "ok", hoursLeft: 70 });
    expect(breachCountdown(row, new Date("2026-10-30T00:00:00Z"))).toMatchObject({ state: "due_soon", hoursLeft: 10 });
    expect(breachCountdown(row, new Date("2026-10-30T11:00:00Z"))).toMatchObject({ state: "overdue", hoursLeft: -1 });
    expect(breachCountdown({ ...row, boardReportedAt: new Date() }, new Date("2026-11-30T00:00:00Z"))).toMatchObject({ state: "done", hoursLeft: null });
  });
  it("drafts in English and Tamil name the data, the steps and the contact", () => {
    const d = breachDrafts({ shopName: "Meena Stores", title: "A staff laptop was stolen", description: "", dataTypes: ["phone", "address"], containment: "Passwords changed.", contact: "Meena, +91 98765 43210", occurredAt: null, discoveredAt: discovered });
    expect(d.people.en).toContain("phone number, address");
    expect(d.people.en).toContain("Passwords changed.");
    expect(d.people.en).toContain("Meena, +91 98765 43210");
    expect(d.people.ta).toContain("தொலைபேசி எண், முகவரி");
    expect(d.board.en).toContain("72 hours");
    expect(d.board.ta).toContain("72");
  });
  it("validates input", () => {
    expect(() => breachInputSchema.parse({ title: "x" })).toThrow();
    expect(breachInputSchema.parse({ title: "Lost laptop" }).severity).toBe("medium");
    expect(() => breachInputSchema.parse({ title: "Lost laptop", dataTypes: ["bogus"] })).toThrow();
  });
});

describe("rights helpers", () => {
  it("normalises Indian phones", () => {
    expect(normalisePhone("98765 43210")).toBe("+919876543210");
    expect(normalisePhone("+91 9876543210")).toBe("+919876543210");
    expect(normalisePhone("919876543210")).toBe("+919876543210");
    expect(normalisePhone("")).toBeNull();
  });
  it("overdue only for open requests past their date", () => {
    const now = new Date("2026-10-27T00:00:00Z");
    const past = new Date("2026-10-01T00:00:00Z");
    expect(isOverdue({ status: "open", dueAt: past }, now)).toBe(true);
    expect(isOverdue({ status: "in_progress", dueAt: past }, now)).toBe(true);
    expect(isOverdue({ status: "completed", dueAt: past }, now)).toBe(false);
    expect(isOverdue({ status: "open", dueAt: new Date("2026-11-01T00:00:00Z") }, now)).toBe(false);
  });
});

describe("settings", () => {
  it("defaults to a 30 day response and tolerates junk", () => {
    expect(PRIVACY_SETTINGS_DEFAULTS.responseDays).toBe(30);
    expect(normalisePrivacySettings(null).responseDays).toBe(30);
    expect(normalisePrivacySettings({ responseDays: 15, grievanceName: "A" })).toMatchObject({ responseDays: 15, grievanceName: "A" });
    expect(normalisePrivacySettings({ responseDays: "x" }).responseDays).toBe(30);
  });
});
