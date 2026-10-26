import { describe, expect, it } from "vitest";
import { anchorsProblem, defaultAnchors, guessKind, parseTryonInput, TRYON_KINDS } from "./tryon";

const url = "http://localhost:4000/v1/uploads/files/t/x/a.png";
const g = (l: number, r: number, ly = 0.5, ry = 0.5) => ({ kind: "glasses" as const, leftEye: { x: l, y: ly }, rightEye: { x: r, y: ry } });

describe("try-on metadata", () => {
  it("accepts the default anchors of every kind", () => {
    for (const k of TRYON_KINDS) expect(parseTryonInput({ imageUrl: url, anchors: defaultAnchors(k) }).ok).toBe(true);
  });
  it("rejects points outside the image and unknown kinds", () => {
    expect(parseTryonInput({ imageUrl: url, anchors: { kind: "earrings", hook: { x: 1.2, y: 0 } } }).ok).toBe(false);
    expect(parseTryonInput({ imageUrl: url, anchors: { kind: "hat", top: { x: 0.5, y: 0.5 } } }).ok).toBe(false);
    expect(parseTryonInput({ imageUrl: "not a url", anchors: defaultAnchors("glasses") }).ok).toBe(false);
  });
  it("needs the eyes apart, left to right and roughly level", () => {
    expect(anchorsProblem(g(0.3, 0.7))).toBeNull();
    expect(anchorsProblem(g(0.7, 0.3))).toMatch(/left eye/);
    expect(anchorsProblem(g(0.45, 0.55))).toMatch(/apart/);
    expect(anchorsProblem(g(0.2, 0.8, 0.1, 0.9))).toMatch(/steep/);
    expect(parseTryonInput({ imageUrl: url, anchors: g(0.7, 0.3) }).ok).toBe(false);
  });
  it("bounds the real width", () => {
    expect(parseTryonInput({ imageUrl: url, anchors: { kind: "nosepin", stud: { x: 0.5, y: 0.5 }, widthMm: 500 } }).ok).toBe(false);
    expect(parseTryonInput({ imageUrl: url, anchors: { kind: "nosepin", stud: { x: 0.5, y: 0.5 }, widthMm: 4 } }).ok).toBe(true);
  });
  it("guesses the kind from the product name", () => {
    expect(guessKind("Ray Style Aviator Sunglasses")).toBe("glasses");
    expect(guessKind("Kundan Jhumka Earrings")).toBe("earrings");
    expect(guessKind("Gold nose pin")).toBe("nosepin");
    expect(guessKind("Mookuthi 22K")).toBe("nosepin");
    expect(guessKind("Temple Haram Necklace")).toBe("necklace");
    expect(guessKind("Cotton Saree")).toBeNull();
  });
});
