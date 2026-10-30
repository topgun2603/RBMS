"use client";

import * as React from "react";
import { FlaskConicalIcon, Loader2Icon, SmartphoneIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  toast,
} from "@rbms/ui";
import { ApiError, describeError, useI18n } from "@rbms/web";
import { money } from "../../lib/format";
import { checkoutInvoice, completeMockPayment, verifyPayment } from "../../lib/queries-v2";
import type { CheckoutResponse } from "../../lib/types";
import { loadRazorpay, primaryColorHex } from "./razorpay";
import { useMediaQuery } from "./use-media-query";

export type CheckoutPhase = "idle" | "starting" | "open" | "verifying";

/**
 * Drives an online payment for a shared bill: POST /payments/checkout, then either Razorpay Checkout
 * (verify on success) or the dev mock sheet. `onPaid` gets the amount actually paid (paise);
 * `onStale` runs when the bill can no longer be paid (already paid / cancelled) so the page refetches.
 */
export function useOnlineCheckout({
  token,
  logoUrl,
  onPaid,
  onStale,
}: {
  token: string;
  logoUrl?: string | null;
  onPaid: (amount: number) => void;
  onStale: () => void;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = React.useState<CheckoutPhase>("idle");
  const [mock, setMock] = React.useState<CheckoutResponse | null>(null);

  const fail = React.useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.code === "not_payable") {
        toast.info(t("billing.checkout.notPayable"));
        onStale();
      } else if (err instanceof Error && err.message === "razorpay_load_failed") {
        toast.error(t("billing.checkout.loadFailed"));
      } else {
        toast.error(describeError(err, t));
      }
    },
    [onStale, t],
  );

  const start = React.useCallback(async () => {
    if (phase !== "idle") return;
    setPhase("starting");
    try {
      const c = await checkoutInvoice(token);
      if (c.provider === "mock") {
        setMock(c);
        setPhase("open");
        return;
      }
      if (!c.keyId) throw new ApiError(500, "checkout_incomplete", t("billing.errors.generic"));
      await loadRazorpay();
      const Razorpay = window.Razorpay!;
      const rz = new Razorpay({
        key: c.keyId,
        order_id: c.orderId,
        amount: c.amount,
        currency: c.currency || "INR",
        name: c.name,
        description: c.description,
        ...(logoUrl && /^https:\/\//.test(logoUrl) ? { image: logoUrl } : {}),
        prefill: c.prefill ?? {},
        theme: { color: primaryColorHex() },
        handler: (r) => {
          setPhase("verifying");
          verifyPayment({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature })
            .then((res) => onPaid(res.amount ?? c.amount))
            .catch((err) => {
              // The webhook may still mark it paid: refresh either way.
              fail(err);
              onStale();
            })
            .finally(() => setPhase("idle"));
        },
        modal: { ondismiss: () => setPhase((p) => (p === "open" ? "idle" : p)) },
      });
      rz.on?.("payment.failed", (r) => toast.error(r.error?.description || t("billing.checkout.failed")));
      setPhase("open");
      rz.open();
    } catch (err) {
      setPhase("idle");
      fail(err);
    }
  }, [fail, logoUrl, onPaid, onStale, phase, t, token]);

  const closeMock = React.useCallback(() => {
    setMock(null);
    setPhase("idle");
  }, []);

  const completeMock = React.useCallback(async () => {
    if (!mock) return;
    try {
      const res = await completeMockPayment(mock.orderId);
      setMock(null);
      setPhase("idle");
      onPaid(res.amount ?? mock.amount);
    } catch (err) {
      fail(err);
    }
  }, [fail, mock, onPaid]);

  return { phase, start, mock, closeMock, completeMock, busy: phase !== "idle" };
}

/** Dev/test provider: bottom sheet on phones, dialog on desktop. No money moves. */
export function MockPaymentSheet({
  checkout,
  onClose,
  onComplete,
}: {
  checkout: CheckoutResponse | null;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const { t } = useI18n();
  const desktop = useMediaQuery("(min-width: 640px)");
  const [busy, setBusy] = React.useState(false);
  const open = !!checkout;

  const body = checkout && (
    <div className="grid gap-4">
      <div className="rounded-2xl bg-muted/60 p-4 text-center ring-1 ring-border ring-inset">
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
        {t("billing.checkout.mockPay")}
      </Button>
      <Button variant="ghost" size="lg" className="h-11" disabled={busy} onClick={onClose}>
        {t("billing.common.cancel")}
      </Button>
    </div>
  );

  const title = (
    <span className="flex items-center gap-2">
      <span className="icon-chip size-8 text-warning-ink">
        <FlaskConicalIcon className="size-4" />
      </span>
      {t("billing.checkout.mockTitle")}
    </span>
  );

  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t("billing.checkout.mockBody")}</DialogDescription>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]" closeLabel={t("billing.common.close")}>
        <SheetHeader className="pb-0">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{t("billing.checkout.mockBody")}</SheetDescription>
        </SheetHeader>
        <div className="px-4">{body}</div>
      </SheetContent>
    </Sheet>
  );
}
