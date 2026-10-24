import { describe, expect, it } from "vitest";
import { clip, maskEmail, maskGstin, maskPhone, maskText, pick } from "./masking";

describe("masking", () => {
  it("keeps the last 4 digits of a phone number, in every common spelling", () => {
    for (const p of ["9876543210", "98765 43210", "+91 98765 43210", "+91-9876543210", "09876543210", "919876543210"]) {
      expect(maskText(`call ${p} now`)).toBe("call XXXXXX3210 now");
    }
    expect(maskPhone("+91 98765 43210")).toBe("XXXXXX3210");
  });

  it("leaves other numbers alone (amounts, invoice numbers, PIN codes, HSN)", () => {
    const t = "Bill INV/26-27/0042 total 1234567 PIN 600001 HSN 61091000 qty 10";
    expect(maskText(t)).toBe(t);
  });

  it("masks emails but keeps the first letter and the domain", () => {
    expect(maskText("mail ravi.kumar@gmail.com please")).toBe("mail r***@gmail.com please");
    expect(maskEmail("a@b.co")).toBe("a***@b.co");
  });

  it("masks a GSTIN only when asked, keeping the state and the check characters", () => {
    const g = "33ABCDE1234F1Z5";
    expect(maskText(`GSTIN ${g}`)).toBe(`GSTIN ${g}`);
    expect(maskText(`GSTIN ${g}`, { gstin: true })).toBe("GSTIN 33XXXXXXXXXX1Z5");
    expect(maskGstin(g)).toHaveLength(15);
  });

  it("can be switched off per kind and is idempotent", () => {
    expect(maskText("9876543210", { phones: false })).toBe("9876543210");
    const once = maskText("9876543210 a@b.in 33ABCDE1234F1Z5", { gstin: true });
    expect(maskText(once, { gstin: true })).toBe(once);
  });

  it("picks only the listed fields and clips long text", () => {
    expect(pick({ name: "Rice", rate: 50, secret: "x" }, ["name", "rate"])).toEqual({ name: "Rice", rate: 50 });
    const long = "a".repeat(500);
    const c = clip(long, 100);
    expect(c.length).toBeLessThanOrEqual(100);
    expect(c).toContain("[...]");
    expect(clip("short", 100)).toBe("short");
  });
});
