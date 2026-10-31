"use client";

import { animate } from "@rbms/ui/motion";

/** Fired on window when something lands in the cart (the header badge bumps). */
export const CART_BUMP_EVENT = "sr:cart-bump";

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The visible header cart button (desktop and phone headers share one). */
function cartTarget(): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>("[data-cart-target]")];
  return all.find((el) => el.offsetParent !== null) ?? null;
}

export function bumpCart() {
  window.dispatchEvent(new Event(CART_BUMP_EVENT));
}

/**
 * A thumbnail of the product flies from `from` (the product image or the button) to the header cart icon on an arc,
 * shrinking and fading; the cart badge bumps when it lands. Transform + opacity only, on a fixed-position clone, so it
 * never causes layout work. Resolves when it lands (immediately with reduced motion).
 */
export async function flyToCart(from: Element | null | undefined, imageSrc: string | null | undefined): Promise<void> {
  const target = cartTarget();
  const visible = !!from && from.getBoundingClientRect().width > 0;
  if (!from || !visible || !target || reducedMotion()) {
    bumpCart();
    return;
  }
  const a = from.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const size = Math.max(56, Math.min(120, Math.min(a.width, a.height) * 0.6));
  const startX = a.left + a.width / 2 - size / 2;
  const startY = a.top + a.height / 2 - size / 2;
  const dx = b.left + b.width / 2 - size / 2 - startX;
  const dy = b.top + b.height / 2 - size / 2 - startY;

  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, {
    position: "fixed",
    left: `${startX}px`,
    top: `${startY}px`,
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "9999px",
    overflow: "hidden",
    zIndex: "80",
    pointerEvents: "none",
    background: "var(--primary)",
    boxShadow: "0 12px 30px -8px rgb(0 0 0 / 0.35), 0 0 0 3px var(--background)",
    willChange: "transform, opacity",
  } satisfies Partial<CSSStyleDeclaration>);
  if (imageSrc) {
    const img = document.createElement("img");
    img.src = imageSrc;
    img.alt = "";
    Object.assign(img.style, { width: "100%", height: "100%", objectFit: "cover" });
    el.appendChild(img);
  }
  document.body.appendChild(el);

  try {
    // Pop up a little, then travel: x eases out while y eases in, which bends the path into an arc.
    await animate(el, { scale: [0.6, 1.08] }, { duration: 0.18, ease: "easeOut" });
    await animate(
      el,
      { x: dx, y: dy, scale: 0.22, opacity: [1, 1, 0.75] },
      { duration: 0.75, x: { duration: 0.75, ease: [0.2, 0.7, 0.4, 1] }, y: { duration: 0.75, ease: [0.6, -0.35, 0.75, 0.9] }, scale: { duration: 0.75, ease: "easeIn" } },
    );
  } finally {
    el.remove();
    bumpCart();
  }
}
