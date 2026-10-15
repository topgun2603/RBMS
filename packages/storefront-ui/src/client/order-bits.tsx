"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CreditCardIcon, Loader2Icon } from "lucide-react";
import { Button } from "@srirealtime/ui/components/button";
import { toast } from "@srirealtime/ui/components/sonner";
import { motion, SuccessCheck, useReducedMotionSafe } from "@srirealtime/ui/motion";
import { useOrderPayment } from "./payment";
import { useStore } from "./store-context";

const CONFETTI_COLORS = ["var(--primary)", "var(--sf-gold)", "var(--success)", "var(--sf-sale)", "color-mix(in oklch, var(--primary) 50%, white)"];

/** Confetti-lite: ~36 small pieces burst out and fall (transform + opacity only, once; nothing with reduced motion). */
function Confetti() {
  const reduced = useReducedMotionSafe();
  const pieces = React.useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => {
        // Deterministic spread (no Math.random → identical server / client markup).
        const a = (i / 36) * Math.PI * 2 + (i % 3) * 0.2;
        const r = 120 + ((i * 37) % 90);
        return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.7 - 60, rot: (i * 47) % 360, w: i % 3 === 0 ? 10 : 6, h: i % 2 ? 6 : 12, c: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!, d: (i % 6) * 0.03 };
      }),
    [],
  );
  if (reduced) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2">
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className="absolute block rounded-[2px]"
          style={{ width: p.w, height: p.h, background: p.c, marginLeft: -p.w / 2, marginTop: -p.h / 2 }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 0, scale: 0.4 }}
          animate={{ x: [0, p.x, p.x * 1.1], y: [0, p.y, p.y + 160], rotate: [0, p.rot, p.rot + 180], opacity: [0, 1, 1, 0], scale: [0.4, 1, 1] }}
          transition={{ duration: 1.6, delay: 0.25 + p.d, ease: [0.2, 0.7, 0.4, 1], times: [0, 0.35, 1] }}
        />
      ))}
    </span>
  );
}

export function SuccessBurst({ label }: { label: string }) {
  return (
    <div className="relative mx-auto flex size-28 items-center justify-center">
      <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-success/15 [animation-duration:2s] [animation-iteration-count:2] motion-reduce:hidden" />
      <Confetti />
      <SuccessCheck size={96} label={label} />
    </div>
  );
}

/** Retry an online payment for an order that's still unpaid (ref = order access token). */
export function PayNowButton({ accessToken, amountLabel }: { accessToken: string; amountLabel: string }) {
  const { t } = useStore();
  const router = useRouter();
  const payment = useOrderPayment();
  return (
    <>
      <Button
        size="lg"
        className="h-12 rounded-full px-8 text-base"
        disabled={payment.busy}
        onClick={async () => {
          const o = await payment.pay(accessToken);
          if (o === "paid") router.refresh();
          else if (o === "failed") toast.error(t("pay.failed"));
        }}
        data-testid="pay-now"
      >
        {payment.busy ? <Loader2Icon className="animate-spin" /> : <CreditCardIcon />}
        {t("order.payNow")} · {amountLabel}
      </Button>
      {payment.sheet}
    </>
  );
}

/** Track lookup: accepts a full tracking link or the bare token. */
export function TrackLookup() {
  const { t } = useStore();
  const router = useRouter();
  const [v, setV] = React.useState("");
  const id = React.useId();
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        const raw = v.trim();
        const token = raw.match(/\/(?:track|order)\/([A-Za-z0-9_-]{8,64})/)?.[1] ?? (/^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : null);
        if (token) router.push(`/track/${token}`);
        else toast.error(t("order.notFound"));
      }}
    >
      <label htmlFor={id} className="sr-only">
        {t("order.lookupField")}
      </label>
      <input id={id} value={v} onChange={(e) => setV(e.target.value)} placeholder={t("order.lookupField")} className="h-12 flex-1 rounded-full border border-input bg-card px-5 text-sm outline-none focus:ring-[3px] focus:ring-ring/30" />
      <Button type="submit" size="lg" className="h-12 rounded-full px-8">
        {t("order.lookupSubmit")}
      </Button>
    </form>
  );
}
