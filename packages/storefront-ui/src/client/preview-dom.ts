import type { PreviewTheme } from "../lib/preview-theme";

/*
 * DOM side of the live preview (client only, no React): swaps the branding stylesheet, the theme attributes on the
 * store root and the Google Fonts link for unsaved tokens, and finds / outlines home sections. Kept to a small DOM
 * surface (getElementById, createElement, querySelector, attributes) so it is testable without a browser.
 */

export const BRANDING_STYLE_ID = "sr-branding";
export const PREVIEW_STYLE_ID = "sr-preview-branding";
export const PREVIEW_FONTS_ID = "sr-preview-fonts";
/** Attribute each home section's wrapper carries (pages/home.tsx; see the integration notes). */
export const SECTION_ATTR = "data-section-id";
const BRAND_FONTS_ATTR = "data-sf-brand-fonts";

/** Original attribute values of the store root, captured before the first override (for reset). */
const originals = new WeakMap<Element, Map<string, string | null>>();

const storeRoot = (doc: Document) => doc.querySelector(".sf-root");

function remember(el: Element, name: string) {
  let m = originals.get(el);
  if (!m) originals.set(el, (m = new Map()));
  if (!m.has(name)) m.set(name, el.getAttribute(name));
}

/** Restyles the page for unsaved tokens. Idempotent; the server-rendered `#sr-branding` is disabled, not removed. */
export function applyPreviewTheme(doc: Document, theme: PreviewTheme): void {
  const base = doc.getElementById(BRANDING_STYLE_ID);
  let style = doc.getElementById(PREVIEW_STYLE_ID);
  if (!style) {
    style = doc.createElement("style");
    style.setAttribute("id", PREVIEW_STYLE_ID);
    if (base?.parentNode) base.parentNode.insertBefore(style, base.nextSibling);
    else doc.head.appendChild(style);
  }
  style.textContent = theme.css;
  // React never sets `media` on that element, so re-renders (router.refresh) leave it disabled.
  base?.setAttribute("media", "not all");

  const root = storeRoot(doc);
  if (root) {
    for (const [k, v] of Object.entries(theme.attributes)) {
      remember(root, k);
      root.setAttribute(k, v);
    }
    remember(root, BRAND_FONTS_ATTR);
    if (theme.fonts.length > 1) root.setAttribute(BRAND_FONTS_ATTR, "");
    else root.removeAttribute(BRAND_FONTS_ATTR);
  }

  let link = doc.getElementById(PREVIEW_FONTS_ID);
  if (!theme.fontsHref) link?.remove();
  else {
    if (!link) {
      link = doc.createElement("link");
      link.setAttribute("id", PREVIEW_FONTS_ID);
      link.setAttribute("rel", "stylesheet");
      doc.head.appendChild(link);
    }
    if (link.getAttribute("href") !== theme.fontsHref) link.setAttribute("href", theme.fontsHref);
  }
}

/** Back to the server-rendered look. */
export function resetPreviewTheme(doc: Document): void {
  doc.getElementById(PREVIEW_STYLE_ID)?.remove();
  doc.getElementById(PREVIEW_FONTS_ID)?.remove();
  doc.getElementById(BRANDING_STYLE_ID)?.removeAttribute("media");
  const root = storeRoot(doc);
  const m = root ? originals.get(root) : undefined;
  if (root && m) {
    for (const [k, v] of m) {
      if (v === null) root.removeAttribute(k);
      else root.setAttribute(k, v);
    }
    originals.delete(root);
  }
}

// ------------------------------------------------------------------ sections

/** The section id for a click/hover target (its closest marked wrapper), or null. */
export function sectionIdOf(target: EventTarget | null): string | null {
  const el = target && typeof (target as Element).closest === "function" ? (target as Element).closest(`[${SECTION_ATTR}]`) : null;
  return el?.getAttribute(SECTION_ATTR) ?? null;
}

/** The wrapper of section `id` (compared by value: ids are never put into a selector). */
export function findSection(doc: Document, id: string): Element | null {
  for (const el of Array.from(doc.querySelectorAll(`[${SECTION_ATTR}]`))) if (el.getAttribute(SECTION_ATTR) === id) return el;
  return null;
}

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** The section's box in the viewport; wrappers with `display: contents` have none, so their children's union counts. */
export function sectionBox(el: Element): Box | null {
  const r = el.getBoundingClientRect();
  if (r.width > 0 || r.height > 0) return { top: r.top, left: r.left, width: r.width, height: r.height };
  const rects = Array.from(el.children)
    .map((c) => c.getBoundingClientRect())
    .filter((c) => c.width > 0 || c.height > 0);
  if (!rects.length) return null;
  const top = Math.min(...rects.map((c) => c.top));
  const left = Math.min(...rects.map((c) => c.left));
  const bottom = Math.max(...rects.map((c) => c.bottom));
  const right = Math.max(...rects.map((c) => c.right));
  return { top, left, width: right - left, height: bottom - top };
}

/** Positions (or hides, for null) a fixed, click-through outline box. */
export function placeOutline(doc: Document, id: string, box: Box | null, variant: "hover" | "selected"): void {
  let el = doc.getElementById(id) as HTMLElement | null;
  if (!box) {
    if (el) el.style.display = "none";
    return;
  }
  if (!el) {
    el = doc.createElement("div");
    el.setAttribute("id", id);
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("data-sr-preview-ui", "");
    Object.assign(el.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "2147483646",
      borderRadius: "6px",
      boxSizing: "border-box",
      transition: "top .12s ease, left .12s ease, width .12s ease, height .12s ease",
      border: variant === "selected" ? "2px solid #2563eb" : "2px dashed rgba(37, 99, 235, 0.7)",
      boxShadow: variant === "selected" ? "0 0 0 4px rgba(37, 99, 235, 0.18)" : "none",
    });
    doc.body.appendChild(el);
  }
  Object.assign(el.style, { display: "block", top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px` });
}
