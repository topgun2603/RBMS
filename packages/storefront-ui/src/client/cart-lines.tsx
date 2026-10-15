"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangleIcon, XIcon } from "lucide-react";
import { toast } from "@srirealtime/ui/components/sonner";
import { cn } from "@srirealtime/ui/lib/utils";
import { AnimatedNumber, motion, useReducedMotionSafe } from "@srirealtime/ui/motion";
import { STORE_PATHS } from "@srirealtime/cms/seo";
import { money } from "../lib/format";
import type { CartLine } from "../types";
import { StoreImage } from "../components/bits";
import { errorMessage } from "./api";
import { QtyStepper } from "./qty-stepper";
import { SoldBy, useCartSellers } from "./sellers";
import { useStore } from "./store-context";

/**
 * One cart line with image, problem badge, qty stepper and remove. Render inside <AnimatePresence mode="popLayout">:
 * lines slide in, removed lines slide out and the rest glide up (layout), totals count to their new value.
 */
export const CartLineRow = React.forwardRef<HTMLLIElement, { line: CartLine; compact?: boolean; onNavigate?: () => void; index?: number }>(function CartLineRow(
  { line, compact, onNavigate, index = 0 },
  ref,
) {
  const { t, cart } = useStore();
  const reduced = useReducedMotionSafe();
  const [busy, setBusy] = React.useState(false);
  const seller = useCartSellers().get(line.productId);
  const change = async (qty: number) => {
    setBusy(true);
    try {
      await cart.setQty(line.variantId, qty);
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };
  const href = STORE_PATHS.product(line.productSlug);
  return (
    <motion.li
      ref={ref}
      layout={reduced ? false : "position"}
      initial={reduced ? false : { opacity: 0, x: 28 }}
      animate={{ opacity: busy ? 0.6 : 1, x: 0, transition: { delay: Math.min(index, 6) * 0.05, type: "spring", stiffness: 380, damping: 32 } }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: -48, transition: { duration: 0.22 } }}
      className="flex gap-3 bg-background py-4 sm:gap-4"
      data-testid="cart-line"
    >
      <Link href={href} onClick={onNavigate} className={cn("shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-black/5", compact ? "size-20" : "size-24 sm:size-28")}>
        <StoreImage src={line.image} alt={line.name} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={href} onClick={onNavigate} className="line-clamp-2 text-sm font-medium hover:underline">
              {line.name}
            </Link>
            {line.variantTitle && <p className="text-xs text-muted-foreground">{line.variantTitle}</p>}
            {seller && <SoldBy seller={seller} onNavigate={onNavigate} className="mt-0.5" />}
          </div>
          <button type="button" onClick={() => change(0)} disabled={busy} className="-me-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`${t("cart.remove")} ${line.name}`}>
            <XIcon className="size-4" />
          </button>
        </div>
        {line.problem && (
          <p className={cn("flex items-center gap-1 text-xs font-medium", line.problem === "price_changed" ? "text-warning-ink" : "text-danger-ink")}>
            <AlertTriangleIcon className="size-3.5" />
            {t(`cart.problem.${line.problem}`, { max: line.maxQty })}
          </p>
        )}
        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          {line.available ? (
            <QtyStepper value={line.qty} max={Math.max(1, line.maxQty)} onChange={change} disabled={busy} size="sm" removable />
          ) : (
            <span className="text-xs text-muted-foreground">{t("product.outOfStock")}</span>
          )}
          <div className="text-right">
            <AnimatedNumber value={line.available ? line.lineTotal : line.price * line.qty} format={(n) => money(Math.round(n))} className="sf-price block text-sm font-bold" />
            {line.mrp && line.mrp > line.price && <p className="text-xs text-muted-foreground tabular-nums line-through">{money(line.mrp * line.qty)}</p>}
          </div>
        </div>
      </div>
    </motion.li>
  );
});
