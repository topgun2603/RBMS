import { describe, expect, it } from "vitest";
import { backdropFor, growBox, levelsFromHistogram, lighten, normaliseHex, squarePlacement, whiteBalanceGains } from "./layout";

describe("squarePlacement", () => {
  it("centres a wide product with even side margins", () => {
    const p = squarePlacement({ x: 0, y: 0, w: 800, h: 400 }, 1000, 0.1);
    expect(p.w).toBe(800);
    expect(p.h).toBe(400);
    expect(p.left).toBe(100);
    expect(p.top).toBe(300);
  });
  it("fits a tall product by height and centres it", () => {
    const p = squarePlacement({ x: 0, y: 0, w: 200, h: 1600 }, 1000, 0.1);
    expect(p.h).toBe(800);
    expect(p.w).toBe(100);
    expect(p.left).toBe(450);
    expect(p.top).toBe(100);
  });
  it("lifts for a shadow but never off the canvas, and caps the upscale", () => {
    const p = squarePlacement({ x: 0, y: 0, w: 10, h: 10 }, 1000, 0.08, 0.5);
    expect(p.scale).toBe(3);
    expect(p.top).toBeGreaterThanOrEqual(0);
    const lifted = squarePlacement({ x: 0, y: 0, w: 400, h: 400 }, 1000, 0.1, 0.05);
    const flat = squarePlacement({ x: 0, y: 0, w: 400, h: 400 }, 1000, 0.1, 0);
    expect(flat.top - lifted.top).toBe(50);
  });
  it("rejects an empty box", () => {
    expect(() => squarePlacement({ x: 0, y: 0, w: 0, h: 10 }, 100)).toThrow();
  });
});

describe("growBox", () => {
  it("adds a margin and stays inside the picture", () => {
    expect(growBox({ x: 5, y: 5, w: 100, h: 50 }, 0.1, 200, 100)).toEqual({ x: 0, y: 0, w: 115, h: 65 });
    expect(growBox({ x: 150, y: 60, w: 50, h: 40 }, 0.2, 200, 100)).toEqual({ x: 140, y: 50, w: 60, h: 50 });
  });
});

describe("levelsFromHistogram", () => {
  const hist = (lo: number, hi: number) => Array.from({ length: 256 }, (_, i) => (i >= lo && i <= hi ? 10 : 0));
  it("lifts a dull picture, within the gain limit", () => {
    const l = levelsFromHistogram(hist(40, 180));
    expect(l.gain).toBeGreaterThan(1);
    expect(l.gain).toBeLessThanOrEqual(1.3);
    expect(l.offset).toBeLessThanOrEqual(0);
  });
  it("leaves a full-range picture alone", () => {
    const l = levelsFromHistogram(hist(0, 255));
    expect(l.gain).toBeCloseTo(1, 1);
    expect(Math.abs(l.offset)).toBeLessThan(2);
  });
  it("copes with an empty or flat histogram", () => {
    expect(levelsFromHistogram(new Array(256).fill(0))).toMatchObject({ gain: 1, offset: 0 });
    expect(levelsFromHistogram(hist(100, 102))).toMatchObject({ gain: 1, offset: 0 });
  });
});

describe("whiteBalanceGains", () => {
  it("nudges a colour cast but never more than the limit", () => {
    const [r, g, b] = whiteBalanceGains([200, 150, 100]);
    expect(r).toBeLessThan(1);
    expect(b).toBeGreaterThan(1);
    expect(r).toBeGreaterThanOrEqual(0.92);
    expect(b).toBeLessThanOrEqual(1.08);
    expect(g).toBeCloseTo(1, 1);
  });
  it("does nothing for a dark or neutral product", () => {
    expect(whiteBalanceGains([2, 3, 1])).toEqual([1, 1, 1]);
    expect(whiteBalanceGains([120, 120, 120])).toEqual([1, 1, 1]);
  });
});

describe("backdrops", () => {
  it("white has no shadow, shadow and colour do", () => {
    expect(backdropFor("white")).toMatchObject({ inner: "#FFFFFF", shadow: false });
    expect(backdropFor("shadow").shadow).toBe(true);
    const c = backdropFor("color", "#ffe7b3");
    expect(c.outer).toBe("#FFE7B3");
    expect(c.inner).not.toBe(c.outer);
    expect(c.shadow).toBe(true);
  });
  it("falls back to a festive colour for a bad hex", () => {
    expect(backdropFor("color", "nope").outer).toBe("#FFE7B3");
    expect(normaliseHex("#abc")).toBeNull();
    expect(normaliseHex("12ab34")).toBe("#12AB34");
  });
  it("lighten mixes towards white", () => {
    expect(lighten("#000000", 0.5)).toBe("#808080");
    expect(lighten("#FF0000", 1)).toBe("#FFFFFF");
  });
});
