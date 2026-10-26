import { describe, expect, it } from "vitest";
import { computeOverlays, drawParams, earLobe, faceMetrics, isTryonSpec, neckPoint, smoothOverlay, type Landmark, type TryonAnchors } from "./transform";

const FRAME = { w: 1280, h: 720 };

/**
 * A synthetic face in frame pixels: eyes `ipd` apart centred at (cx, cy), rolled by `rollDeg`, cheeks ~2.1 x ipd apart,
 * chin 2.6 x ipd below the eye line, forehead top 1.0 x ipd above. `turn` moves the nose tip between the cheeks.
 */
function face(o: { cx?: number; cy?: number; ipd?: number; rollDeg?: number; turn?: number; iris?: boolean } = {}): Landmark[] {
  const cx = o.cx ?? 640;
  const cy = o.cy ?? 300;
  const ipd = o.ipd ?? 120;
  const roll = ((o.rollDeg ?? 0) * Math.PI) / 180;
  const r = { x: Math.cos(roll), y: Math.sin(roll) };
  const d = { x: -Math.sin(roll), y: Math.cos(roll) };
  const at = (u: number, v: number) => ({ x: cx + (r.x * u + d.x * v) * ipd, y: cy + (r.y * u + d.y * v) * ipd });
  const lm: Landmark[] = Array.from({ length: o.iris === false ? 468 : 478 }, () => ({ x: 0.5, y: 0.5 }));
  const set = (i: number, p: { x: number; y: number }) => {
    lm[i] = { x: p.x / FRAME.w, y: p.y / FRAME.h, z: 0 };
  };
  set(33, at(-0.8, 0));
  set(133, at(-0.2, 0));
  set(362, at(0.2, 0));
  set(263, at(0.8, 0));
  if (o.iris !== false) {
    set(468, at(-0.5, 0));
    set(473, at(0.5, 0));
  }
  set(234, at(-1.05, 0.5));
  set(454, at(1.05, 0.5));
  set(1, at((o.turn ?? 0.5) * 2.1 - 1.05, 0.9));
  set(129, at(-0.28, 1.0));
  set(358, at(0.28, 1.0));
  set(10, at(0, -1.0));
  set(152, at(0, 2.6));
  return lm;
}

const glassesImage = { w: 1000, h: 400 };
const glasses: TryonAnchors = { kind: "glasses", leftEye: { x: 0.25, y: 0.5 }, rightEye: { x: 0.75, y: 0.5 } };

describe("faceMetrics", () => {
  it("measures eye distance, roll and the mm ruler", () => {
    const m = faceMetrics(face({ ipd: 120, rollDeg: 10 }), FRAME)!;
    expect(m.ipd).toBeCloseTo(120, 3);
    expect(m.roll).toBeCloseTo((10 * Math.PI) / 180, 5);
    expect(m.pxPerMm).toBeCloseTo(120 / 63, 5);
    expect(m.turn).toBeCloseTo(0.5, 5);
  });
  it("falls back to eye corners without iris points, and refuses unusable input", () => {
    expect(faceMetrics(face({ iris: false }), FRAME)!.ipd).toBeCloseTo(120, 3);
    expect(faceMetrics([], FRAME)).toBeNull();
    expect(faceMetrics(face({ ipd: 2 }), FRAME)).toBeNull();
  });
});

describe("glasses", () => {
  it("sit on the eye line: scaled so the eye points land on the eyes, upright when the head is level", () => {
    const [o] = computeOverlays(glasses, face({ cx: 700, cy: 320, ipd: 100 }), FRAME, glassesImage);
    expect(o!.target.x).toBeCloseTo(700, 3);
    expect(o!.target.y).toBeCloseTo(320, 3);
    expect(o!.scale).toBeCloseTo(100 / 500, 5); // 500 image px between the eye points
    expect(o!.rotation).toBeCloseTo(0, 5);
    expect(o!.pivot).toEqual({ x: 500, y: 200 });
  });
  it("roll with the head and grow when the shopper comes closer", () => {
    const [far] = computeOverlays(glasses, face({ ipd: 80 }), FRAME, glassesImage);
    const [near] = computeOverlays(glasses, face({ ipd: 160, rollDeg: -12 }), FRAME, glassesImage);
    expect(near!.scale).toBeCloseTo(far!.scale * 2, 5);
    expect(near!.rotation).toBeCloseTo((-12 * Math.PI) / 180, 5);
  });
  it("cancels a tilt drawn into the photo itself", () => {
    const tilted: TryonAnchors = { kind: "glasses", leftEye: { x: 0.25, y: 0.45 }, rightEye: { x: 0.75, y: 0.55 } };
    const [o] = computeOverlays(tilted, face(), FRAME, glassesImage);
    expect(o!.rotation).toBeCloseTo(-Math.atan2(40, 500), 5);
  });
  it("draws nothing without a face or with a degenerate setup", () => {
    expect(computeOverlays(glasses, [], FRAME, glassesImage)).toEqual([]);
    expect(computeOverlays({ kind: "glasses", leftEye: { x: 0.5, y: 0.5 }, rightEye: { x: 0.5, y: 0.5 } }, face(), FRAME, glassesImage)).toEqual([]);
  });
});

describe("earrings", () => {
  const ear: TryonAnchors = { kind: "earrings", hook: { x: 0.5, y: 0.05 }, widthMm: 20 };
  const image = { w: 200, h: 400 };
  it("hang from an estimate below each cheek edge, sized from millimetres", () => {
    const lms = face();
    const os = computeOverlays(ear, lms, FRAME, image);
    expect(os.map((o) => o.id)).toEqual(["earring-left", "earring-right"]);
    const m = faceMetrics(lms, FRAME)!;
    expect(os[0]!.target.y).toBeGreaterThan(m.cheekL.y);
    expect(os[0]!.target.x).toBeLessThan(m.cheekL.x);
    expect(os[1]!.target.x).toBeGreaterThan(m.cheekR.x);
    expect(os[0]!.scale).toBeCloseTo((20 * (120 / 63)) / 200, 5);
    expect(os[0]!.pivot).toEqual({ x: 100, y: 20 });
  });
  it("hide the ear that is turned away", () => {
    const toRight = computeOverlays(ear, face({ turn: 0.97 }), FRAME, image).map((o) => o.id);
    const toLeft = computeOverlays(ear, face({ turn: 0.03 }), FRAME, image).map((o) => o.id);
    expect(toRight).toEqual(["earring-left"]);
    expect(toLeft).toEqual(["earring-right"]);
  });
  it("follow the head roll", () => {
    const lms = face({ rollDeg: 20 });
    const m = faceMetrics(lms, FRAME)!;
    const lobe = earLobe(m, "left");
    // the lobe is below the cheek point along the tilted "down", not straight down
    expect(lobe.x - m.cheekL.x).toBeLessThan(0);
    expect(computeOverlays(ear, lms, FRAME, image)[0]!.rotation).toBeCloseTo((20 * Math.PI) / 180, 5);
  });
});

describe("nose pin and necklace", () => {
  it("nose pin sits on the nostril wing, at least a few pixels wide", () => {
    const pin: TryonAnchors = { kind: "nosepin", stud: { x: 0.5, y: 0.5 }, widthMm: 4 };
    const lms = face();
    const [o] = computeOverlays(pin, lms, FRAME, { w: 80, h: 80 });
    const m = faceMetrics(lms, FRAME)!;
    expect(o!.target).toEqual(m.nostrilR);
    expect(o!.scale * 80).toBeGreaterThanOrEqual(10);
    const [l] = computeOverlays(pin, lms, FRAME, { w: 80, h: 80 }, { noseSide: "left" });
    expect(l!.target).toEqual(m.nostrilL);
  });
  it("nose pin fades when that side turns away", () => {
    const pin: TryonAnchors = { kind: "nosepin", stud: { x: 0.5, y: 0.5 } };
    expect(computeOverlays(pin, face({ turn: 0.97 }), FRAME, { w: 80, h: 80 })).toEqual([]);
    expect(computeOverlays(pin, face({ turn: 0.03 }), FRAME, { w: 80, h: 80 })).toHaveLength(1);
  });
  it("necklace rests below the chin and is wide in proportion to the face", () => {
    const lace: TryonAnchors = { kind: "necklace", top: { x: 0.5, y: 0.02 } };
    const lms = face();
    const m = faceMetrics(lms, FRAME)!;
    const [o] = computeOverlays(lace, lms, FRAME, { w: 600, h: 500 });
    expect(o!.target.y).toBeGreaterThan(m.chin.y);
    expect(o!.target).toEqual(neckPoint(m));
    expect(o!.scale * 600).toBeCloseTo(150 * m.pxPerMm, 5);
  });
});

describe("smoothing and helpers", () => {
  const base = { id: "g", target: { x: 100, y: 100 }, pivot: { x: 0, y: 0 }, scale: 1, rotation: 0, alpha: 1 };
  it("moves part of the way and takes the short way round the angle", () => {
    const o = smoothOverlay(base, { ...base, target: { x: 200, y: 100 }, scale: 2, rotation: Math.PI * 0.9 }, 0.5);
    expect(o.target.x).toBe(150);
    expect(o.scale).toBe(1.5);
    const wrap = smoothOverlay({ ...base, rotation: Math.PI * 0.9 }, { ...base, rotation: -Math.PI * 0.9 }, 0.5);
    expect(Math.abs(Math.cos(wrap.rotation))).toBeGreaterThan(0.99); // near +-pi, not near 0
    expect(smoothOverlay(undefined, base)).toBe(base);
  });
  it("draw parameters offset the image by the pivot", () => {
    expect(drawParams({ ...base, pivot: { x: 30, y: 10 }, scale: 0.5 }, { w: 60, h: 20 })).toMatchObject({ tx: 100, ty: 100, dx: -30, dy: -10, scale: 0.5, w: 60, h: 20 });
  });
  it("accepts only a complete try-on setup", () => {
    expect(isTryonSpec({ kind: "glasses", imageUrl: "x.png", anchors: glasses })).toBe(true);
    expect(isTryonSpec({ kind: "earrings", imageUrl: "x.png", anchors: glasses })).toBe(false);
    expect(isTryonSpec({ kind: "glasses", imageUrl: "", anchors: glasses })).toBe(false);
    expect(isTryonSpec(null)).toBe(false);
  });
});
