import { describe, expect, it } from "vitest";
import { assessMask, fillOfBox, maskStats, normaliseScores, stretchAlpha, type Alpha } from "./mask";

/** A w x h mask with a filled rectangle (alpha v) and the rest 0. */
function rect(w: number, h: number, x0: number, y0: number, x1: number, y1: number, v = 255): Alpha {
  const data = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[y * w + x] = v;
  return { data, width: w, height: h };
}

describe("maskStats", () => {
  it("measures size, box, confidence and border contact", () => {
    const s = maskStats(rect(100, 100, 20, 30, 70, 80));
    expect(s.fgRatio).toBeCloseTo(0.25, 5);
    expect(s.bbox).toEqual({ x: 20, y: 30, w: 50, h: 50 });
    expect(s.confidence).toBe(1);
    expect(s.edgeTouch).toBe(0);
  });
  it("sees a product that runs off the frame", () => {
    expect(maskStats(rect(100, 100, 0, 0, 100, 100)).edgeTouch).toBe(1);
  });
  it("has no box for an empty mask", () => {
    expect(maskStats(rect(10, 10, 0, 0, 0, 0)).bbox).toBeNull();
  });
});

describe("assessMask (quality guard)", () => {
  it("accepts a sensible, decisive cut-out", () => {
    const a = rect(100, 100, 20, 20, 80, 80);
    expect(assessMask(maskStats(a), fillOfBox(a, { x: 20, y: 20, w: 60, h: 60 }))).toMatchObject({ ok: true, reasons: [] });
  });
  it("flags a tiny foreground", () => {
    expect(assessMask(maskStats(rect(100, 100, 40, 40, 44, 44))).reasons).toContain("tiny");
  });
  it("flags a foreground that is nearly the whole picture", () => {
    expect(assessMask(maskStats(rect(100, 100, 1, 1, 99, 99))).reasons).toContain("huge");
  });
  it("flags a fuzzy mask (model unsure)", () => {
    const v = assessMask(maskStats(rect(100, 100, 10, 10, 90, 90, 128)));
    expect(v.reasons).toContain("low_confidence");
    expect(v.ok).toBe(false);
  });
  it("flags a product cut off by the frame on most sides", () => {
    expect(assessMask(maskStats(rect(100, 100, 0, 0, 100, 60))).reasons).toContain("cut_off");
  });
  it("flags scattered specks and an empty result", () => {
    const a = rect(100, 100, 0, 0, 0, 0);
    for (const [x, y] of [[5, 5], [92, 92], [5, 92], [92, 5], [50, 50]] as const) {
      for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) a.data[(y + dy) * 100 + x + dx] = 255;
    }
    const st = maskStats(a);
    expect(assessMask(st, fillOfBox(a, st.bbox!)).reasons).toContain("scattered");
    expect(assessMask(maskStats(rect(10, 10, 0, 0, 0, 0))).reasons).toEqual(["empty"]);
  });
});

describe("normaliseScores and stretchAlpha", () => {
  it("min-max scales model scores to 0..255", () => {
    expect(Array.from(normaliseScores([-2, 0, 2]))).toEqual([0, 128, 255]);
    expect(Array.from(normaliseScores([5, 5, 5]))).toEqual([0, 0, 0]);
  });
  it("snaps near-solid and near-empty values and keeps the middle soft", () => {
    const a = stretchAlpha({ data: Uint8Array.from([0, 10, 128, 245, 255]), width: 5, height: 1 });
    expect(a.data[0]).toBe(0);
    expect(a.data[1]).toBe(0);
    expect(a.data[3]).toBe(255);
    expect(a.data[4]).toBe(255);
    expect(a.data[2]).toBeGreaterThan(100);
    expect(a.data[2]).toBeLessThan(160);
  });
});
