"use client";

/** Razorpay Checkout (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/). */

export interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name?: string;
  description?: string;
  image?: string;
  prefill?: { name?: string; contact?: string; email?: string };
  theme?: { color?: string };
  handler: (r: RazorpaySuccess) => void;
  modal?: { ondismiss?: () => void; escape?: boolean; confirm_close?: boolean };
}

export interface RazorpayInstance {
  open(): void;
  on?(event: "payment.failed", cb: (r: { error?: { description?: string; reason?: string } }) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let loader: Promise<void> | null = null;

/** Loads checkout.js once (shared promise); a failed load can be retried. */
export function loadRazorpay(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("razorpay_unavailable"));
  if (window.Razorpay) return Promise.resolve();
  if (!loader) {
    loader = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
      const s = existing ?? document.createElement("script");
      const fail = () => {
        loader = null;
        s.remove();
        reject(new Error("razorpay_load_failed"));
      };
      s.addEventListener("load", () => (window.Razorpay ? resolve() : fail()), { once: true });
      s.addEventListener("error", fail, { once: true });
      if (!existing) {
        s.src = CHECKOUT_SRC;
        s.async = true;
        document.head.appendChild(s);
      }
    });
  }
  return loader;
}

/**
 * The tenant's primary colour as #rrggbb (Razorpay only understands hex/rgb). `--primary` may be any
 * CSS colour (often oklch), so it is resolved through a temporary element and painted on a 1×1 canvas.
 */
export function primaryColorHex(fallback = "#4f46e5"): string {
  if (typeof document === "undefined") return fallback;
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
    if (!raw) return fallback;
    const el = document.createElement("span");
    el.style.color = "var(--primary)";
    el.style.display = "none";
    document.body.appendChild(el);
    const resolved = getComputedStyle(el).color || raw;
    el.remove();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.fillStyle = "#000";
    ctx.fillStyle = resolved;
    ctx.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return fallback;
  }
}
