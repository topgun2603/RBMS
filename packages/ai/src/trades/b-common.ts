import { AppError } from "@rbms/core";
import type { AiImageType } from "../types";

/**
 * Helpers shared by the Phase 3 part B vision helpers (catalogue from photos, product pack, textile tags, HUID).
 * The model is never trusted: whatever it reads off a label or a photo is cleaned here before anything else sees it.
 */

/** Text an image must not make us act on: instructions aimed at an AI. Checked on text read from labels and photos. */
const INJECTION = [
  /ignore\s+(?:(?:all|any|the|your|these|those|previous|prior|above|earlier|preceding)\s+)*(?:instructions?|rules|prompts?|directions?|previous|prior|above)/i,
  /disregard\s+(?:(?:all|any|the|your|previous|prior|above|earlier)\s+)*(?:instructions?|rules|previous|prior|above)/i,
  /forget\s+(?:everything|all|your)/i,
  /\b(?:system|developer)\s+(?:prompt|message|instruction)s?\b/i,
  /you\s+are\s+now\b/i,
  /\bnew\s+instructions?\b/i,
  /\b(?:act|behave)\s+as\s+(?:an?\s+)?(?:ai|assistant|model|admin)/i,
  /\boverride\b.{0,30}\b(?:total|amount|price|rate|instruction)/i,
  /\b(?:set|change|make|put)\s+(?:the\s+)?(?:price|mrp|rate|total|amount|quantity|qty|name)\s+(?:to|as|=|at)\b/i,
  /\bprice\s*(?:is|=|:)?\s*(?:rs\.?|inr|₹)?\s*1\s*(?:rupee|rs)\b/i,
  /\b(?:reveal|print|show|output|repeat)\b.{0,30}\b(?:prompt|instructions|api\s*key|secret)/i,
  /<\s*\/?\s*(?:system|assistant|instructions?)\s*>/i,
  /\bassistant\s*:/i,
  /\bjailbreak\b/i,
  /\bverified\s+by\s+bis\b/i,
];
export const looksLikeInjection = (s: string) => INJECTION.some((re) => re.test(s));

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g;

/** Plain single-line text, length-limited, control/bidi characters and markup removed. null when nothing is left. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v
    .replace(CONTROL, " ")
    .replace(/<[^>]{0,200}>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return s || null;
}

/** cleanText that also returns null (and says so) when the text reads like an instruction to an AI. */
export function safeText(v: unknown, max: number): { text: string | null; injected: boolean } {
  const s = cleanText(v, max);
  const injected = (typeof v === "string" && looksLikeInjection(v.slice(0, 2000))) || (s !== null && looksLikeInjection(s));
  return { text: injected ? null : s, injected };
}

/** The file's own first bytes must match what the request says it is. */
export function sniffImage(data: string): "jpeg" | "png" | "webp" | "gif" | null {
  let head: Buffer;
  try {
    head = Buffer.from(data.slice(0, 32), "base64");
  } catch {
    return null;
  }
  if (head.length < 8) return null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (head.subarray(0, 3).toString("latin1") === "GIF") return "gif";
  return null;
}

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/** Checks a photo from the browser: allowed type and matching bytes. Throws 400 `ai_bad_image`. */
export function checkImage(img: { mediaType: string; data: string }): { mediaType: AiImageType; data: string } {
  const kind = sniffImage(img.data);
  if (!kind || !(IMAGE_TYPES as readonly string[]).includes(img.mediaType) || img.mediaType.split("/")[1] !== kind)
    throw new AppError(400, "ai_bad_image", "That file is not a valid photo. Use a JPG, PNG or WebP photo.");
  return { mediaType: img.mediaType as AiImageType, data: img.data };
}

export const unreadable = (why?: string | null) =>
  new AppError(422, "ai_unreadable_image", "The photo could not be read. Retake it in good light, flat and fully in the frame.", why ? { reason: String(why).slice(0, 200) } : undefined);

/** Lowercase letters/digits only, for comparing names. Tamil letters are kept. */
export const normName = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const STOP = new Set(["the", "of", "and", "with", "for", "a", "pack", "new"]);
const SIZE_RE = /(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|mg|l|ltr|litre|liter|ml|pcs|pc|nos|m|cm|mm)\b/g;
/** Name words without the size expressions (sizes are compared on their own, in base units). */
const tokens = (s: string) => normName(s.toLowerCase().replace(SIZE_RE, " ")).split(" ").filter((t) => t && !STOP.has(t));

/** Quantities in a name ("500 g", "1 kg", "250ml", "2 l"), normalised to base units so "1 kg" equals "1000 g". */
export function sizesIn(s: string): string[] {
  const out: string[] = [];
  for (const m of s.toLowerCase().matchAll(SIZE_RE)) {
    let n = Number(m[1]);
    let u = m[2]!;
    if (u === "kg") (n *= 1000), (u = "g");
    else if (["gm", "gms"].includes(u)) u = "g";
    else if (["l", "ltr", "litre", "liter"].includes(u)) (n *= 1000), (u = "ml");
    else if (["pc", "nos"].includes(u)) u = "pcs";
    out.push(`${Math.round(n * 1000) / 1000}${u}`);
  }
  return out;
}

/** 0..1: how alike two product names are (token overlap), and 0 when both state different sizes. */
export function nameSimilarity(a: string, b: string): number {
  const sa = sizesIn(a);
  const sb = sizesIn(b);
  if (sa.length && sb.length && !sa.some((x) => sb.includes(x))) return 0;
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let both = 0;
  for (const t of ta) if (tb.has(t)) both++;
  return both / (ta.size + tb.size - both);
}

/** GS1 check digit for EAN-8 / UPC-A / EAN-13 / GTIN-14. */
export function validGs1(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const d = code.split("").map(Number);
  const check = d.pop()!;
  let sum = 0;
  d.reverse().forEach((n, i) => (sum += n * (i % 2 === 0 ? 3 : 1)));
  return (10 - (sum % 10)) % 10 === check;
}

/** A barcode as read from a pack: digits only, valid GS1 check digit; otherwise null (a misread digit is worse than none). */
export function cleanBarcode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const digits = v.replace(/[\s-]/g, "");
  return validGs1(digits) ? digits : null;
}

/** Units the catalogue forms offer. */
export const UNITS = ["pcs", "kg", "g", "l", "ml", "m", "box", "pack"] as const;
export type Unit = (typeof UNITS)[number];
export function cleanUnit(v: unknown): Unit {
  const u = String(v ?? "").trim().toLowerCase();
  if ((UNITS as readonly string[]).includes(u)) return u as Unit;
  if (["nos", "no", "piece", "pieces", "pc", "each", "unit"].includes(u)) return "pcs";
  if (["litre", "liter", "ltr"].includes(u)) return "l";
  if (["gm", "gms", "gram", "grams"].includes(u)) return "g";
  if (["packet", "packets", "pkt"].includes(u)) return "pack";
  return "pcs";
}

/** Rupees as printed to paise, 1 paise .. Rs 1 crore; anything else is null. */
export function rupeesToPaise(v: unknown, max = 10_000_000): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > max) return null;
  return Math.round(v * 100);
}
