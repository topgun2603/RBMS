import { describe, expect, it } from "vitest";
import { batchFieldsVisible } from "./components/inventory/purchase-form";

const base = { tracked: false, open: false, batchNo: "", expiry: "", ai: [] as string[] };

describe("batchFieldsVisible (direct purchase line)", () => {
  it("shows for a batch-tracked item without any scan", () => {
    expect(batchFieldsVisible({ ...base, tracked: true })).toBe(true);
  });
  it("stays hidden for an untracked, untouched line", () => {
    expect(batchFieldsVisible(base)).toBe(false);
  });
  it("keeps scanned-line behaviour: shows for AI-read batch or expiry, or once opened", () => {
    expect(batchFieldsVisible({ ...base, ai: ["batchNo"] })).toBe(true);
    expect(batchFieldsVisible({ ...base, ai: ["expiry"] })).toBe(true);
    expect(batchFieldsVisible({ ...base, open: true })).toBe(true);
    expect(batchFieldsVisible({ ...base, batchNo: "B1" })).toBe(true);
    expect(batchFieldsVisible({ ...base, expiry: "2027-01-31" })).toBe(true);
  });
});
