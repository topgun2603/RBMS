import { z } from "zod";

/**
 * Try-on metadata of a product (docs/ai.md "Phase 4 part C"). Points are fractions (0..1) of the try-on image, measured from
 * its top-left corner. The shopper's phone reads this and draws the image over the face; nothing here touches a camera.
 */
export const TRYON_KINDS = ["glasses", "earrings", "nosepin", "necklace"] as const;
export type TryonKind = (typeof TRYON_KINDS)[number];

const frac = z.number().min(0).max(1);
const point = z.object({ x: frac, y: frac });
export type TryonPoint = z.infer<typeof point>;

/** Real width of the piece in mm (frame front, earring, stud, necklace). Defaults come from `DEFAULT_WIDTH_MM`. */
const widthMm = z.number().min(3).max(220).optional();

export const DEFAULT_WIDTH_MM: Record<TryonKind, number> = { glasses: 140, earrings: 22, nosepin: 4, necklace: 150 };

const glasses = z.object({
  kind: z.literal("glasses"),
  /** Where the pupils would sit behind the frame: the eye line. */
  leftEye: point,
  rightEye: point,
  widthMm,
});
const earrings = z.object({
  kind: z.literal("earrings"),
  /** The point that hangs from the ear lobe (the hook / post). */
  hook: point,
  widthMm,
});
const nosepin = z.object({
  kind: z.literal("nosepin"),
  /** The centre of the stud. */
  stud: point,
  widthMm,
});
const necklace = z.object({
  kind: z.literal("necklace"),
  /** The middle of the top edge, where the necklace rests on the neck. */
  top: point,
  widthMm,
});

export const tryonAnchorsSchema = z.discriminatedUnion("kind", [glasses, earrings, nosepin, necklace]);
export type TryonAnchors = z.infer<typeof tryonAnchorsSchema>;

/** Checks the alignment points make sense (eyes apart and level-ish, the right one on the right). Returns a message or null. */
export function anchorsProblem(a: TryonAnchors): string | null {
  if (a.kind === "glasses") {
    const dx = a.rightEye.x - a.leftEye.x;
    const dy = a.rightEye.y - a.leftEye.y;
    if (dx < 0.2) return "Place the left eye point on the left and the right eye point on the right of the frame, well apart.";
    if (Math.abs(dy) > dx * 0.5) return "The eye line is too steep. Put both eye points at about the same height.";
  }
  return null;
}

export const tryonInput = z.object({
  /** The stored image: only a PNG / WebP from this shop's uploads (a transparent cut-out). */
  imageUrl: z.string().trim().url().max(2000),
  anchors: tryonAnchorsSchema,
});
export type TryonInput = z.infer<typeof tryonInput>;

export function parseTryonInput(body: unknown): { ok: true; value: TryonInput } | { ok: false; message: string } {
  const r = tryonInput.safeParse(body);
  if (!r.success) {
    const i = r.error.issues[0];
    return { ok: false, message: i ? `${i.path.join(".") || "try-on"}: ${i.message}` : "Invalid try-on setup" };
  }
  const problem = anchorsProblem(r.data.anchors);
  return problem ? { ok: false, message: problem } : { ok: true, value: r.data };
}

/** Starting anchors for a freshly cut-out image of a kind (the owner then drags the handles). */
export function defaultAnchors(kind: TryonKind): TryonAnchors {
  switch (kind) {
    case "glasses":
      return { kind, leftEye: { x: 0.28, y: 0.5 }, rightEye: { x: 0.72, y: 0.5 } };
    case "earrings":
      return { kind, hook: { x: 0.5, y: 0.05 } };
    case "nosepin":
      return { kind, stud: { x: 0.5, y: 0.5 } };
    case "necklace":
      return { kind, top: { x: 0.5, y: 0.02 } };
  }
}

/** Which kind a product looks like from its name, category and tags (a suggestion only; the owner picks). */
export function guessKind(text: string): TryonKind | null {
  const t = text.toLowerCase();
  if (/\b(nose\s?(pin|stud|ring)|mookuthi|mukkuthi|mookutthi)\b|மூக்குத்தி/.test(t)) return "nosepin";
  if (/\b(sun\s?glass|sunglasses|spectacle|spectacles|eye\s?glass|eyeglasses|glasses|frame|eyewear|goggle|goggles)\b|கண்ணாடி/.test(t)) return "glasses";
  if (/\b(ear\s?ring|earrings|jhumka|jhumki|studs?|stud|kammal|chandbali|danglers?|ear\s?cuff)\b|காதணி|கம்மல்/.test(t)) return "earrings";
  if (/\b(necklace|choker|haram|chain|pendant|mangalsutra|thali|mala)\b|கழுத்தணி|நெக்லஸ்|ஹாரம்/.test(t)) return "necklace";
  return null;
}
