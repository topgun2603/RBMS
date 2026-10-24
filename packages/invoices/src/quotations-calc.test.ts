import { describe, expect, it } from "vitest";
import {
  conversionRate,
  defaultValidUntil,
  normalizeQuotationSettings,
  quotationAdvance,
  quotationCancelProblem,
  quotationConvertProblem,
  quotationDaysLeft,
  quotationDisplayStatus,
  quotationEditProblem,
  quotationRespondProblem,
  quotationReviseProblem,
  quotationShareProblem,
} from "./quotations-calc";
import { QUOTATION_DISPLAY_STATUSES, QUOTATION_STATUSES } from "./schema";

const q = (over: Partial<{ status: (typeof QUOTATION_STATUSES)[number]; latest: boolean; validUntil: string }> = {}) => ({
  status: "sent" as const,
  latest: true,
  validUntil: "2026-10-29",
  ...over,
});

describe("quotation settings", () => {
  it("defaults to QT, 15 days and no terms", () => {
    expect(normalizeQuotationSettings(undefined)).toEqual({ prefix: "QT", validityDays: 15, terms: null });
    expect(normalizeQuotationSettings({ prefix: " est ", validityDays: "30", terms: "  Pay in 7 days " })).toEqual({ prefix: "EST", validityDays: 30, terms: "Pay in 7 days" });
  });
  it("ignores unusable values", () => {
    expect(normalizeQuotationSettings({ prefix: "", validityDays: 0 })).toMatchObject({ prefix: "QT", validityDays: 15 });
    expect(normalizeQuotationSettings({ validityDays: 400 }).validityDays).toBe(15);
    expect(normalizeQuotationSettings({ validityDays: 1.5 }).validityDays).toBe(15);
  });
  it("adds the validity to the date", () => {
    expect(defaultValidUntil("2026-10-14")).toBe("2026-10-29");
    expect(defaultValidUntil("2026-12-20", 15)).toBe("2027-01-04");
  });
});

describe("expiry is derived from valid-until", () => {
  it("a sent quotation is valid through its last day, expired the day after", () => {
    expect(quotationDisplayStatus(q(), "2026-10-29")).toBe("sent");
    expect(quotationDisplayStatus(q(), "2026-10-30")).toBe("expired");
  });
  it("only sent quotations expire: answered, billed, draft and cancelled ones keep their status", () => {
    for (const status of ["draft", "accepted", "declined", "converted", "cancelled"] as const) {
      expect(quotationDisplayStatus(q({ status }), "2027-01-01")).toBe(status);
    }
  });
  it("display statuses are the stored ones plus expired", () => {
    expect([...QUOTATION_DISPLAY_STATUSES]).toEqual([...QUOTATION_STATUSES, "expired"]);
  });
  it("counts days left while waiting for an answer", () => {
    expect(quotationDaysLeft(q(), "2026-10-27")).toBe(2);
    expect(quotationDaysLeft(q(), "2026-10-29")).toBe(0);
    expect(quotationDaysLeft(q(), "2026-10-31")).toBe(-2);
    expect(quotationDaysLeft(q({ status: "accepted" }), "2026-10-27")).toBeNull();
  });
});

describe("advance", () => {
  it("is a percentage of the total rounded to the paisa", () => {
    expect(quotationAdvance(512_000, 50)).toBe(256_000);
    expect(quotationAdvance(100_001, 33)).toBe(33_000);
    expect(quotationAdvance(100_000, null)).toBe(0);
    expect(quotationAdvance(100_000, 100)).toBe(100_000);
    expect(quotationAdvance(0, 50)).toBe(0);
  });
});

describe("who may do what", () => {
  it("the customer can answer a latest, sent, valid quotation only", () => {
    expect(quotationRespondProblem(q(), "2026-10-20")).toBeNull();
    expect(quotationRespondProblem(q(), "2026-10-30")?.code).toBe("quotation_expired");
    expect(quotationRespondProblem(q({ latest: false }), "2026-10-20")?.code).toBe("quotation_revised");
    expect(quotationRespondProblem(q({ status: "accepted" }), "2026-10-20")?.code).toBe("quotation_answered");
    expect(quotationRespondProblem(q({ status: "declined" }), "2026-10-20")?.code).toBe("quotation_answered");
    expect(quotationRespondProblem(q({ status: "converted" }), "2026-10-20")?.code).toBe("quotation_converted");
    expect(quotationRespondProblem(q({ status: "cancelled" }), "2026-10-20")?.code).toBe("quotation_cancelled");
    expect(quotationRespondProblem(q({ status: "draft" }), "2026-10-20")?.code).toBe("quotation_not_sent");
  });
  it("drafts are edited, everything else is revised", () => {
    expect(quotationEditProblem(q({ status: "draft" }))).toBeNull();
    expect(quotationEditProblem(q())).toMatch(/revise/);
    expect(quotationReviseProblem(q({ status: "draft" }))).toMatch(/Edit the draft/);
    for (const status of ["sent", "accepted", "declined"] as const) expect(quotationReviseProblem(q({ status }))).toBeNull();
    expect(quotationReviseProblem(q({ status: "converted" }))).toBeTruthy();
    expect(quotationReviseProblem(q({ status: "cancelled" }))).toBeTruthy();
    expect(quotationReviseProblem(q({ latest: false }))).toMatch(/latest/);
  });
  it("only the latest revision converts, once, unless the bill is gone", () => {
    for (const status of ["draft", "sent", "accepted", "declined"] as const) expect(quotationConvertProblem(q({ status }))).toBeNull();
    expect(quotationConvertProblem(q({ latest: false }))).toBeTruthy();
    expect(quotationConvertProblem(q({ status: "cancelled" }))).toBeTruthy();
    expect(quotationConvertProblem(q({ status: "converted" }))).toMatch(/already/);
    expect(quotationConvertProblem(q({ status: "converted" }), true)).toBeNull();
  });
  it("cancel and share rules", () => {
    expect(quotationCancelProblem(q())).toBeNull();
    expect(quotationCancelProblem(q({ status: "converted" }))).toBeTruthy();
    expect(quotationCancelProblem(q({ status: "cancelled" }))).toBeTruthy();
    expect(quotationShareProblem(q({ status: "draft" }))).toBeNull();
    expect(quotationShareProblem(q({ status: "cancelled" }))).toBeTruthy();
    expect(quotationShareProblem(q({ latest: false }))).toBeTruthy();
  });
});

describe("conversion rate", () => {
  it("is converted over sent, in percent with one decimal", () => {
    expect(conversionRate({ wentOut: 0, converted: 0 })).toBe(0);
    expect(conversionRate({ wentOut: 5, converted: 1 })).toBe(20);
    expect(conversionRate({ wentOut: 3, converted: 1 })).toBe(33.3);
    expect(conversionRate({ wentOut: 2, converted: 5 })).toBe(100);
  });
});
