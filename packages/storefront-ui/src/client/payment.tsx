"use client";

import * as React from "react";
import { FlaskConicalIcon, Loader2Icon, SmartphoneIcon } from "lucide-react";
import { Button } from "@srirealtime/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@srirealtime/ui/components/dialog";
import { money } from "../lib/format";
import type { PaymentCheckout } from "../types";
import { ApiError, call } from "./api";
import { useStore } from "./store-context";

/** Razorpay Checkout (standard web integration), same approach as billing-ui's shared-bill payments. */
interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open(): void;
  on?(event: "payment.failed", cb: (r: { error?: { description?: string } }) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let loader: Promise<void> | null = null;

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (!loader) {
    loader = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = CHECKOUT_SRC;
      s.async = true;
      s.onload = () => (window.Razorpay ? resolve() : reject(new Error("razorpay_load_failed")));
      s.onerror = () => {
        loader = null;
        s.remove();
        reject(new Error("razorpay_load_failed"));
      };
      document.head.appendChild(s);
    });
  }
  return loader;
}

/** --primary (any CSS colour) → #rrggbb for Razorpay's theme. */
function primaryHex(fallback = "#7c3aed"): string {
  try {
    const el = document.createElement("span");
    el.style.color = "var(--primary)";
    document.body.appendChild(el);
    const resolved = getComputedStyle(el).color;
    el.remove();
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const ctx = c.getContext("2d");
    if (!ctx) return fallback;
    ctx.fillStyle = resolved;
    ctx.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return fallback;
  }
}

export type PayOutcome = "paid" | "dismissed" | "failed";

/**
 * Pays a store order online: POST /payments/checkout { kind: "order", ref: accessToken } → Razorpay (then /verify) or
 * the dev mock sheet (then /mock/complete). Resolves with the outcome; the order page shows the truth either way.
 */
export function useOrderPayment() {
  const { t, shell } = useStore();
  const [mock, setMock] = React.useState<PaymentCheckout | null>(null);
  const [busy, setBusy] = React.useState(false);
  const resolver = React.useRef<((o: PayOutcome) => void) | null>(null);

  const finish = (o: PayOutcome) => {
    setBusy(false);
    resolver.current?.(o);
    resolver.current = null;
  };

  const pay = React.useCallback(
    async (ref: string): Promise<PayOutcome> => {
      setBusy(true);
      const done = new Promise<PayOutcome>((resolve) => (resolver.current = resolve));
      try {
        const c = await call<PaymentCheckout>("/payments/checkout", { body: { kind: "order", ref } });
        if (c.provider === "mock") {
          setMock(c);
          return done;
        }
        if (!c.keyId) throw new ApiError(500, "checkout_incomplete", t("pay.failed"));
        await loadRazorpay();
        const rz = new window.Razorpay!({
          key: c.keyId,
          order_id: c.orderId,
          amount: c.amount,
          currency: c.currency || "INR",
          name: c.name || shell.name,
          description: c.description,
          ...(shell.logoUrl && /^https:\/\//.test(shell.logoUrl) ? { image: shell.logoUrl } : {}),
          prefill: c.prefill ?? {},
          theme: { color: primaryHex() },
          handler: (r: RazorpaySuccess) => {
            call("/payments/verify", { body: { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature } })
              .then(() => finish("paid"))
              .catch(() => finish("failed"));
          },
          modal: { ondismiss: () => finish("dismissed") },
        });
        rz.on?.("payment.failed", () => undefined);
        rz.open();
      } catch {
        finish("failed");
      }
      return done;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shell.logoUrl, shell.name, t],
  );

  const sheet = (
    <MockPaymentDialog
      checkout={mock}
      onClose={() => {
        setMock(null);
        finish("dismissed");
      }}
      onComplete={async () => {
        if (!mock) return;
        await call("/payments/mock/complete", { body: { orderId: mock.orderId, method: "upi" } });
        setMock(null);
        finish("paid");
      }}
    />
  );

  return { pay, busy, sheet };
}

function MockPaymentDialog({ checkout, onClose, onComplete }: { checkout: PaymentCheckout | null; onClose: () => void; onComplete: () => Promise<void> }) {
  const { t } = useStore();
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={!!checkout} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm" data-testid="mock-payment">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConicalIcon className="size-5 text-warning-ink" />
            {t("pay.mockTitle")}
          </DialogTitle>
          <DialogDescription>{t("pay.mockBody")}</DialogDescription>
        </DialogHeader>
        {checkout && (
          <div className="grid gap-3">
            <div className="rounded-2xl bg-muted/60 p-4 text-center">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{checkout.name}</p>
              <p className="mt-1 font-heading text-3xl font-bold tabular-nums">{money(checkout.amount)}</p>
              <p className="mt-1 text-sm text-muted-foreground">{checkout.description}</p>
            </div>
            <Button
              size="lg"
              className="h-12 text-base"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onComplete();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2Icon className="animate-spin" /> : <SmartphoneIcon />}
              {t("pay.mockPay")}
            </Button>
            <Button variant="ghost" size="lg" disabled={busy} onClick={onClose}>
              {t("common.cancel")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
