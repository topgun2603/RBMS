import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  hexToOklch,
  hexToOklchString,
  isHex,
  mix,
  NEAR_BLACK,
  normalizeHex,
  parseHex,
  readableForeground,
  relativeLuminance,
  shade,
  tint,
  WHITE,
} from "./color";

describe("hex parsing", () => {
  it("parses 6 and 3 digit hex", () => {
    expect(parseHex("#ff8000")).toEqual({ r: 255, g: 128, b: 0 });
    expect(parseHex("#F80")).toEqual({ r: 255, g: 136, b: 0 });
    expect(parseHex(" #000000 ")).toEqual({ r: 0, g: 0, b: 0 });
  });
  it("rejects invalid values", () => {
    for (const v of ["", "ff0000", "#ff00", "#gg0000", "#ff00000", "red", "rgb(0,0,0)"]) expect(parseHex(v)).toBeNull();
  });
  it("isHex only accepts #rrggbb", () => {
    expect(isHex("#AbCdEf")).toBe(true);
    expect(isHex("#abc")).toBe(false);
  });
  it("normalizes", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("nope")).toBeNull();
  });
});

describe("OKLCH", () => {
  it("matches reference values for primaries", () => {
    expect(hexToOklchString("#ff0000")).toBe("oklch(0.628 0.258 29.234)");
    const g = hexToOklch("#00ff00");
    expect(g.l).toBeCloseTo(0.8664, 3);
    expect(g.c).toBeCloseTo(0.2948, 3);
    expect(g.h).toBeCloseTo(142.495, 1);
    const b = hexToOklch("#0000ff");
    expect(b.l).toBeCloseTo(0.452, 3);
    expect(b.c).toBeCloseTo(0.3132, 3);
    expect(b.h).toBeCloseTo(264.052, 1);
  });
  it("prints greys with zero chroma and hue", () => {
    expect(hexToOklchString("#ffffff")).toBe("oklch(1 0 0)");
    expect(hexToOklchString("#000000")).toBe("oklch(0 0 0)");
    expect(hexToOklchString("#171717")).toMatch(/^oklch\(0\.20\d 0 0\)$/);
  });
  it("keeps hue in 0–360", () => {
    for (const hex of ["#ff00ff", "#00ffff", "#123456", "#fedcba", "#2563eb"]) {
      const { h } = hexToOklch(hex);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
  it("throws on invalid hex", () => {
    expect(() => hexToOklch("blue")).toThrow();
  });
});

describe("WCAG", () => {
  it("relative luminance of black and white", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 6);
  });
  it("contrast ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 6);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 6);
    expect(contrastRatio("#123456", "#123456")).toBe(1);
    // Classic AA threshold greys on white.
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
  });
  it("readableForeground picks the higher-contrast option", () => {
    expect(readableForeground("#ffffff")).toBe(NEAR_BLACK);
    expect(readableForeground("#000000")).toBe(WHITE);
    expect(readableForeground("#2563eb")).toBe(WHITE);
    expect(readableForeground("#facc15")).toBe(NEAR_BLACK);
    for (const bg of ["#ff0000", "#00ff00", "#0000ff", "#808080", "#f97316"]) {
      const fg = readableForeground(bg);
      const other = fg === WHITE ? NEAR_BLACK : WHITE;
      expect(contrastRatio(bg, fg)).toBeGreaterThanOrEqual(contrastRatio(bg, other));
    }
  });
});

describe("mix / tint / shade", () => {
  it("mixes in sRGB", () => {
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#000000", "#ffffff", 2)).toBe("#ffffff");
  });
  it("tint lightens and shade darkens", () => {
    expect(tint("#2563eb", 1)).toBe("#ffffff");
    expect(shade("#2563eb", 1)).toBe("#000000");
    expect(tint("#2563eb", 0)).toBe("#2563eb");
    expect(relativeLuminance(tint("#2563eb", 0.3))).toBeGreaterThan(relativeLuminance("#2563eb"));
    expect(relativeLuminance(shade("#2563eb", 0.3))).toBeLessThan(relativeLuminance("#2563eb"));
  });
});
