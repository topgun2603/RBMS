import { z } from "zod";
import { fail } from "../areas";
import type { Bi, OpDef } from "../types";

/** Defines one operation; fills nothing in, it only keeps the generic parameter honest. */
export const defineOp = <P>(op: OpDef<P>): OpDef<P> => op;

export const rupees = (paise: number) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(paise / 100)}`;
export const onOff = (v: boolean): Bi => (v ? { en: "on", ta: "இயக்கம்" } : { en: "off", ta: "நிறுத்தம்" });

/**
 * Links Studio may write: pages of the shop itself ("/..."), phone and mail links, WhatsApp chat links. Any other
 * outside address is refused, so a request can never plant a link to somebody else's site.
 */
export function isSafeLink(v: string): boolean {
  if (/^\/(?![/\\])[^\s\\]*$/.test(v)) return true;
  if (/^(mailto:[^\s]+@[^\s]+|tel:\+?[0-9 ()-]{3,20})$/i.test(v)) return true;
  return /^https:\/\/(wa\.me|api\.whatsapp\.com)\/[^\s]*$/i.test(v);
}

/**
 * Walks a value and checks every link and picture address in it: `href` / `*Href` must be a safe link; a picture
 * address (`*Url`) must already be on the page (the shop's own picture) or a path on the shop itself. Studio never
 * invents or imports a web address.
 */
export function checkUrls(value: unknown, known: Set<string>, path = ""): void {
  if (Array.isArray(value)) return value.forEach((v, i) => checkUrls(v, known, `${path}[${i}]`));
  if (!value || typeof value !== "object") return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") {
      if (/href$/i.test(k) && v && !isSafeLink(v)) fail("unsafe_link", `The link "${v.slice(0, 60)}" goes outside the shop, so Studio cannot add it. Use a page of your shop, a phone, mail or WhatsApp link.`, `"${v.slice(0, 60)}" என்ற இணைப்பு கடைக்கு வெளியே செல்கிறது, அதனால் Studio சேர்க்காது. உங்கள் கடையின் பக்கம், தொலைபேசி, மின்னஞ்சல் அல்லது WhatsApp இணைப்பை பயன்படுத்துங்கள்.`);
      if (/url$/i.test(k) && v && !v.startsWith("/") && !known.has(v)) fail("unknown_picture", "Studio cannot use a picture address that is not already in your shop. Upload the picture in the Home page editor first.", "உங்கள் கடையில் இல்லாத படத்தின் முகவரியை Studio பயன்படுத்தாது. முதலில் முகப்புப் பக்க எடிட்டரில் படத்தை ஏற்றுங்கள்.");
    } else checkUrls(v, known, `${path}.${k}`);
  }
}

export function urlsIn(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) out.add(value);
  } else if (Array.isArray(value)) value.forEach((v) => urlsIn(v, out));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach((v) => urlsIn(v, out));
  return out;
}

/** The first problem of a zod parse as a short sentence. */
export const firstIssue = (e: z.ZodError) => {
  const i = e.issues[0];
  return i ? `${i.path.join(".") || "value"}: ${i.message}` : "invalid value";
};

export function failInvalid(e: z.ZodError): never {
  const msg = firstIssue(e);
  return fail("invalid_value", `That value is not allowed (${msg}).`, `அந்த மதிப்பு ஏற்கப்படாது (${msg}).`);
}

export const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #14532d");
