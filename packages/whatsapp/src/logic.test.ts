import { describe, expect, it } from "vitest";
import {
  campaignCounts,
  canSendFreeForm,
  dedupeAudience,
  detectKeyword,
  estimateMinutes,
  formatPhone,
  nextStatus,
  normaliseKeyword,
  normalisePhone,
  outboundAllowed,
  planBatches,
  sessionWindow,
  spacingMs,
  toIndianE164,
} from "./logic";
import { createSecretBox } from "./crypto";
import { resolveWhatsAppSettings, WHATSAPP_SETTINGS_DEFAULTS } from "./settings";

const H = 3_600_000;
const now = new Date("2026-10-15T06:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("phones", () => {
  it("normalises Indian numbers to +91", () => {
    for (const p of ["98765 43210", "+91 98765-43210", "919876543210", "09876543210", "00919876543210"]) expect(toIndianE164(p)).toBe("+919876543210");
    expect(toIndianE164("12345")).toBeNull();
    expect(toIndianE164("+1 415 555 0100")).toBeNull();
    expect(toIndianE164("5876543210")).toBeNull();
  });
  it("keeps other countries only with + or as wa_id", () => {
    expect(normalisePhone("+1 415 555 0100")).toBe("+14155550100");
    expect(normalisePhone("14155550100")).toBeNull();
    expect(normalisePhone("14155550100", { assumeInternational: true })).toBe("+14155550100");
    expect(normalisePhone("919876543210", { assumeInternational: true })).toBe("+919876543210");
    expect(normalisePhone("abc")).toBeNull();
  });
  it("formats for display", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
    expect(formatPhone("+14155550100")).toBe("+14155550100");
  });
});

describe("24-hour window", () => {
  it("is open for 24 h after the last inbound message", () => {
    expect(canSendFreeForm(ago(23 * H), now)).toBe(true);
    expect(canSendFreeForm(ago(24 * H), now)).toBe(false);
    expect(canSendFreeForm(ago(25 * H), now)).toBe(false);
    expect(canSendFreeForm(null, now)).toBe(false);
    const w = sessionWindow(ago(20 * H), now);
    expect(w.remainingMs).toBe(4 * H);
    expect(w.expiresAt?.toISOString()).toBe("2026-10-15T10:00:00.000Z");
    expect(sessionWindow(ago(30 * H), now)).toMatchObject({ open: false, remainingMs: 0 });
  });

  it("free-form needs the window, templates don't", () => {
    expect(outboundAllowed({ kind: "text", lastInboundAt: ago(2 * H), optedOutAt: null, now })).toEqual({ ok: true });
    expect(outboundAllowed({ kind: "image", lastInboundAt: ago(30 * H), optedOutAt: null, now })).toEqual({ ok: false, reason: "window_closed" });
    expect(outboundAllowed({ kind: "text", lastInboundAt: null, optedOutAt: null, now })).toEqual({ ok: false, reason: "window_closed" });
    expect(outboundAllowed({ kind: "template", lastInboundAt: null, optedOutAt: null, now })).toEqual({ ok: true });
  });

  it("opted-out contacts get no templates; free-form only if they wrote after opting out", () => {
    expect(outboundAllowed({ kind: "template", lastInboundAt: ago(H), optedOutAt: ago(5 * H), now })).toEqual({ ok: false, reason: "opted_out" });
    expect(outboundAllowed({ kind: "text", lastInboundAt: ago(H), optedOutAt: ago(5 * H), now })).toEqual({ ok: true });
    expect(outboundAllowed({ kind: "text", lastInboundAt: ago(5 * H), optedOutAt: ago(H), now })).toEqual({ ok: false, reason: "opted_out" });
  });
});

describe("opt-out keywords", () => {
  it("detects English and Tamil keywords as whole messages", () => {
    for (const t of ["STOP", " stop! ", "Unsubscribe", "STOP ALL", "நிறுத்து", "நிறுத்து.", "நிறுத்துங்கள்", "Niruthu"]) expect(detectKeyword(t)).toBe("opt_out");
    for (const t of ["START", "start.", "Subscribe", "தொடங்கு", "unstop"]) expect(detectKeyword(t)).toBe("opt_in");
  });
  it("ignores ordinary chat", () => {
    for (const t of ["please don't stop my order", "stop by tomorrow?", "when will you start delivery", "", "ok", null]) expect(detectKeyword(t)).toBeNull();
  });
  it("keeps Tamil vowel signs when normalising", () => {
    expect(normaliseKeyword("  நிறுத்து!! ")).toBe("நிறுத்து");
    expect(normaliseKeyword("STOP 🛑")).toBe("stop");
  });
  it("accepts extra keywords from settings", () => {
    expect(detectKeyword("Venda", { optOut: ["venda"] })).toBe("opt_out");
    expect(detectKeyword("veṇum", { optIn: ["VEṆUM"] })).toBe("opt_in");
  });
});

describe("status ordering", () => {
  it("only moves forward", () => {
    expect(nextStatus("queued", "sent")).toBe("sent");
    expect(nextStatus("delivered", "sent")).toBe("delivered");
    expect(nextStatus("sent", "read")).toBe("read");
    expect(nextStatus("read", "delivered")).toBe("read");
    expect(nextStatus("sent", "failed")).toBe("failed");
    expect(nextStatus("delivered", "failed")).toBe("delivered");
    expect(nextStatus("failed", "sent")).toBe("failed");
    expect(nextStatus("failed", "delivered")).toBe("delivered");
  });
});

describe("audience dedupe", () => {
  it("normalises +91, drops invalid and duplicate numbers, merges names and variables", () => {
    const r = dedupeAudience([
      { phone: "98765 43210", variables: { amount: "₹100" } },
      { phone: "+919876543210", name: "Ravi", variables: { amount: "₹999", due: "20 Oct" } },
      { phone: "09876543210" },
      { phone: "12345", name: "Bad" },
      { phone: "8765432109", name: " Meena ", variables: { amount: 250, empty: "", nil: null } },
    ]);
    expect(r.invalid).toBe(1);
    expect(r.duplicates).toBe(2);
    expect(r.recipients).toEqual([
      { phone: "+919876543210", name: "Ravi", variables: { amount: "₹100", due: "20 Oct" } },
      { phone: "+918765432109", name: "Meena", variables: { amount: "250" } },
    ]);
  });
});

describe("throttle plan", () => {
  const start = new Date("2026-10-15T04:30:00Z");
  it("one batch per minute of at most ratePerMinute", () => {
    const plan = planBatches(150, 60, start);
    expect(plan.map((b) => [b.batch, b.offset, b.size, b.delayMs])).toEqual([
      [0, 0, 60, 0],
      [1, 60, 60, 60_000],
      [2, 120, 30, 120_000],
    ]);
    expect(plan[2]!.at.toISOString()).toBe("2026-10-15T04:32:00.000Z");
  });
  it("handles edges", () => {
    expect(planBatches(0, 60, start)).toEqual([]);
    expect(planBatches(60, 60, start)).toHaveLength(1);
    expect(planBatches(3, 0, start).map((b) => b.size)).toEqual([1, 1, 1]);
    expect(estimateMinutes(121, 60)).toBe(3);
    expect(estimateMinutes(0, 60)).toBe(0);
    expect(spacingMs(60)).toBe(950);
    expect(spacingMs(10)).toBe(1000);
    expect(spacingMs(1000)).toBe(10);
    expect(spacingMs(5000)).toBe(0);
  });
});

describe("campaign counts", () => {
  it("builds a cumulative funnel", () => {
    expect(campaignCounts({ pending: 5, sent: 10, delivered: 20, read: 30, failed: 2, skipped: 3 })).toEqual({
      total: 70,
      pending: 5,
      sent: 60,
      delivered: 50,
      read: 30,
      failed: 2,
      skipped: 3,
      cancelled: 0,
    });
  });
});

describe("settings and secrets", () => {
  it("fills defaults and ignores invalid stored values", () => {
    expect(resolveWhatsAppSettings(null)).toEqual(WHATSAPP_SETTINGS_DEFAULTS);
    expect(resolveWhatsAppSettings({ ratePerMinute: 120, sendReadReceipts: "yes" }).ratePerMinute).toBe(120);
    expect(resolveWhatsAppSettings({ ratePerMinute: 0 }).ratePerMinute).toBe(60);
    expect(resolveWhatsAppSettings({ sendReadReceipts: "yes" }).sendReadReceipts).toBe(true);
  });
  it("round-trips the secret box and rejects another key", () => {
    const a = createSecretBox("key-a");
    const enc = a.encrypt("EAAG-token");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(a.decrypt(enc)).toBe("EAAG-token");
    expect(() => createSecretBox("key-b").decrypt(enc)).toThrow();
  });
});
