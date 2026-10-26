/**
 * "Try it on": pure maths from face landmarks to where the product image is drawn. No camera, no canvas, no network here, so it
 * is easy to test with fixture landmarks. Coordinates: landmarks are MediaPipe Face Landmarker points normalised 0..1 over the
 * video frame; results are in frame pixels. Everything is an estimate from one 2D view (a "preview"), not a measurement.
 *
 * Landmark indices used (MediaPipe face mesh, 478 points):
 *   1 nose tip, 10 forehead top, 152 chin, 234 / 454 cheek edge near the ear (image-left / image-right),
 *   129 / 358 nostril wings (image-left / image-right), 468 / 473 iris centres (image-left / image-right eye),
 *   33,133 / 362,263 eye corners (image-left eye / image-right eye) as a fallback when irises are missing.
 */

export type TryonKind = "glasses" | "earrings" | "nosepin" | "necklace";
export interface Pt {
  x: number;
  y: number;
}
export type TryonAnchors =
  | { kind: "glasses"; leftEye: Pt; rightEye: Pt; widthMm?: number }
  | { kind: "earrings"; hook: Pt; widthMm?: number }
  | { kind: "nosepin"; stud: Pt; widthMm?: number }
  | { kind: "necklace"; top: Pt; widthMm?: number };

export interface Landmark {
  x: number;
  y: number;
  z?: number;
}
export interface Frame {
  w: number;
  h: number;
}
export interface ImageSize {
  w: number;
  h: number;
}

/** One image to draw: put image pixel `pivot` at frame point `target`, scaled and rotated about it. */
export interface Overlay {
  id: string;
  target: Pt;
  pivot: Pt;
  scale: number;
  /** Radians, clockwise on screen. */
  rotation: number;
  /** 0..1, fades an ear that is turned away. */
  alpha: number;
}

export const DEFAULT_WIDTH_MM: Record<TryonKind, number> = { glasses: 140, earrings: 22, nosepin: 4, necklace: 150 };
/** Average adult interpupillary distance, the ruler that turns millimetres into pixels. */
export const IPD_MM = 63;
export const MIN_LANDMARKS = 455;

const px = (l: Landmark, f: Frame): Pt => ({ x: l.x * f.w, y: l.y * f.h });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export interface FaceMetrics {
  eyeL: Pt;
  eyeR: Pt;
  ipd: number;
  /** Head roll: angle of the eye line, radians (0 = level). */
  roll: number;
  /** Unit vectors along the eye line (to image-right) and perpendicular (towards the chin). */
  right: Pt;
  down: Pt;
  faceWidth: number;
  faceHeight: number;
  chin: Pt;
  /** 0.5 = facing the camera; above 0.5 the nose is nearer the image-right edge (turned to image-right). */
  turn: number;
  pxPerMm: number;
  cheekL: Pt;
  cheekR: Pt;
  nostrilL: Pt;
  nostrilR: Pt;
}

/** The measurements every overlay needs, or null when the landmarks are missing or the face is degenerate. */
export function faceMetrics(lms: readonly Landmark[], frame: Frame): FaceMetrics | null {
  if (!lms || lms.length < MIN_LANDMARKS) return null;
  const g = (i: number) => px(lms[i]!, frame);
  const hasIris = lms.length >= 478;
  const eyeL = hasIris ? g(468) : mid(g(33), g(133));
  const eyeR = hasIris ? g(473) : mid(g(362), g(263));
  const ipd = dist(eyeL, eyeR);
  if (!(ipd > 8)) return null;
  const roll = Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x);
  const right = { x: Math.cos(roll), y: Math.sin(roll) };
  const down = { x: -Math.sin(roll), y: Math.cos(roll) };
  const cheekL = g(234);
  const cheekR = g(454);
  const nose = g(1);
  const dl = dist(nose, cheekL);
  const dr = dist(nose, cheekR);
  return {
    eyeL,
    eyeR,
    ipd,
    roll,
    right,
    down,
    faceWidth: dist(cheekL, cheekR),
    faceHeight: dist(g(10), g(152)),
    chin: g(152),
    turn: dl + dr > 0 ? dl / (dl + dr) : 0.5,
    pxPerMm: ipd / IPD_MM,
    cheekL,
    cheekR,
    nostrilL: g(129),
    nostrilR: g(358),
  };
}

const img = (a: { x: number; y: number }, size: ImageSize): Pt => ({ x: a.x * size.w, y: a.y * size.h });

/** Fade from 1 (facing) to 0 (turned away) for one side: `away` is how far the head has turned from that side, in `turn` units. */
export const sideAlpha = (away: number, from = 0.1, to = 0.2) => clamp(1 - (away - from) / (to - from), 0, 1);

/** Estimated earlobe: the cheek-edge point nudged out and down (the lobe hangs below the tragus). `side` is the image side. */
export function earLobe(m: FaceMetrics, side: "left" | "right"): Pt {
  const base = side === "left" ? m.cheekL : m.cheekR;
  const out = side === "left" ? -1 : 1;
  const o = m.faceWidth * 0.02 * out;
  const d = m.faceHeight * 0.09;
  return { x: base.x + m.right.x * o + m.down.x * d, y: base.y + m.right.y * o + m.down.y * d };
}

/** Where a necklace rests: below the chin, along the face's own "down". */
export function neckPoint(m: FaceMetrics): Pt {
  const d = m.faceHeight * 0.3;
  return { x: m.chin.x + m.down.x * d, y: m.chin.y + m.down.y * d };
}

/** Real width in mm to a scale for an image `iw` px wide. */
const scaleForWidth = (widthMm: number, m: FaceMetrics, iw: number) => (widthMm * m.pxPerMm) / Math.max(iw, 1);

/**
 * The images to draw for one product on one face. Empty when the face cannot be measured. Glasses are aligned to the eye
 * line (scale and roll from the two eye points); earrings hang from estimated lobes (an ear turned away fades out); a nose pin
 * sits on a nostril wing; a necklace rests below the chin. Sizes come from the real width (`widthMm`, or a default) against
 * the shopper's eye distance.
 */
export function computeOverlays(anchors: TryonAnchors, lms: readonly Landmark[], frame: Frame, image: ImageSize, opts: { noseSide?: "left" | "right" } = {}): Overlay[] {
  const m = faceMetrics(lms, frame);
  if (!m || image.w <= 0 || image.h <= 0) return [];
  const mm = anchors.widthMm ?? DEFAULT_WIDTH_MM[anchors.kind];
  switch (anchors.kind) {
    case "glasses": {
      const a = img(anchors.leftEye, image);
      const b = img(anchors.rightEye, image);
      const span = dist(a, b);
      if (span < 1) return [];
      const imgAngle = Math.atan2(b.y - a.y, b.x - a.x);
      return [{ id: "glasses", target: mid(m.eyeL, m.eyeR), pivot: mid(a, b), scale: m.ipd / span, rotation: m.roll - imgAngle, alpha: 1 }];
    }
    case "earrings": {
      const pivot = img(anchors.hook, image);
      const scale = scaleForWidth(mm, m, image.w);
      const out: Overlay[] = [];
      // Turned to image-right (turn > 0.5) exposes the image-left ear and hides the image-right one.
      const aL = sideAlpha(0.5 - m.turn);
      const aR = sideAlpha(m.turn - 0.5);
      if (aL > 0.02) out.push({ id: "earring-left", target: earLobe(m, "left"), pivot, scale, rotation: m.roll, alpha: aL });
      if (aR > 0.02) out.push({ id: "earring-right", target: earLobe(m, "right"), pivot, scale, rotation: m.roll, alpha: aR });
      return out;
    }
    case "nosepin": {
      const side = opts.noseSide ?? "right";
      const alpha = side === "right" ? sideAlpha(m.turn - 0.5, 0.18, 0.3) : sideAlpha(0.5 - m.turn, 0.18, 0.3);
      if (alpha < 0.02) return [];
      const scale = Math.max(scaleForWidth(mm, m, image.w), 10 / image.w);
      return [{ id: "nosepin", target: side === "right" ? m.nostrilR : m.nostrilL, pivot: img(anchors.stud, image), scale, rotation: m.roll, alpha }];
    }
    case "necklace": {
      return [{ id: "necklace", target: neckPoint(m), pivot: img(anchors.top, image), scale: scaleForWidth(mm, m, image.w), rotation: m.roll, alpha: 1 }];
    }
  }
}

/** Exponential smoothing between frames so the overlay does not jitter. `k` is the weight of the new frame (1 = no smoothing). */
export function smoothOverlay(prev: Overlay | undefined, next: Overlay, k = 0.5): Overlay {
  if (!prev) return next;
  const lerp = (a: number, b: number) => a + (b - a) * k;
  // Take the short way round for the angle.
  let dr = next.rotation - prev.rotation;
  while (dr > Math.PI) dr -= 2 * Math.PI;
  while (dr < -Math.PI) dr += 2 * Math.PI;
  return {
    ...next,
    target: { x: lerp(prev.target.x, next.target.x), y: lerp(prev.target.y, next.target.y) },
    scale: lerp(prev.scale, next.scale),
    rotation: prev.rotation + dr * k,
    alpha: lerp(prev.alpha, next.alpha),
  };
}

/** The canvas 2D transform for an overlay: translate to the target, rotate, scale, and draw the image offset by the pivot. */
export function drawParams(o: Overlay, image: ImageSize) {
  return { tx: o.target.x, ty: o.target.y, rotation: o.rotation, scale: o.scale, dx: -o.pivot.x, dy: -o.pivot.y, w: image.w, h: image.h };
}

/** Does this product have what a try-on needs: a known kind and a usable image url? Guards the store's button. */
export function isTryonSpec(v: unknown): v is { kind: TryonKind; imageUrl: string; anchors: TryonAnchors } {
  if (!v || typeof v !== "object") return false;
  const o = v as { kind?: unknown; imageUrl?: unknown; anchors?: { kind?: unknown } };
  return typeof o.imageUrl === "string" && o.imageUrl.length > 0 && !!o.anchors && o.anchors.kind === o.kind && ["glasses", "earrings", "nosepin", "necklace"].includes(String(o.kind));
}
