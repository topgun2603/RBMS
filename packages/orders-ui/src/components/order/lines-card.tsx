"use client";

import { ShoppingCartIcon, TicketPercentIcon } from "lucide-react";
import { Separator } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { formatQty, money } from "../../lib/format";
import type { Order } from "../../lib/types";
import { Section, Thumb, TotalRow } from "../bits";

/** Items with image, variant, qty × price and discount, then the totals breakdown. */
export function LinesCard({ order }: { order: Order }) {
  const { t } = useI18n();
  const tt = order.totals;
  const codFee = tt.codFee ?? 0;
  const gst = tt.cgst + tt.sgst + tt.igst;
  const allInclusive = order.lines.every((l) => l.taxInclusive);
  return (
    <Section
      icon={ShoppingCartIcon}
      title={t("orders.detail.items")}
      description={t("orders.list.itemCount", { count: order.lines.reduce((n, l) => n + (Number.isInteger(l.qty) ? l.qty : 1), 0) })}
      bodyClassName="gap-0 px-0 py-0 sm:px-0"
    >
      <ul className="divide-y divide-border/60">
        {order.lines.map((l, i) => {
          const [product, variant] = splitName(l.name);
          return (
            <li key={`${l.variantId}-${i}`} className="flex items-start gap-3 px-4 py-3 sm:px-5">
              <Thumb src={l.image} alt="" className="size-12" />
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words">{product}</p>
                <p className="text-xs text-muted-foreground">
                  {[variant, l.sku && `${t("orders.detail.sku")} ${l.sku}`].filter(Boolean).join(" · ")}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {formatQty(l.qty)} {l.unit !== "pcs" ? l.unit : ""} × {money(l.price)}
                  {l.gstRate > 0 && ` · ${t("orders.detail.gstRate", { rate: l.gstRate })}`}
                </p>
                {l.discount > 0 && (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-success-ink">
                    <TicketPercentIcon className="size-3" /> {t("orders.detail.lineDiscount", { amount: money(l.discount) })}
                  </p>
                )}
              </div>
              <span className="shrink-0 font-semibold tabular-nums">{money(l.total)}</span>
            </li>
          );
        })}
      </ul>
      <div className="grid gap-1.5 border-t border-border/60 bg-muted/20 px-4 py-4 sm:px-5">
        <TotalRow label={t("orders.totals.subtotal")} value={money(tt.subtotal)} />
        {tt.discount > 0 && (
          <TotalRow
            label={
              <span className="inline-flex items-center gap-1">
                {t("orders.totals.coupon")}
                {order.couponCode && <code className="rounded bg-success/12 px-1.5 text-xs font-semibold text-success-ink">{order.couponCode}</code>}
              </span>
            }
            value={<span className="text-success-ink">−{money(tt.discount)}</span>}
          />
        )}
        <TotalRow
          label={t("orders.totals.shipping")}
          value={
            tt.shipping > 0 ? (
              money(tt.shipping)
            ) : tt.shippingWaived > 0 ? (
              <span className="text-success-ink">
                <s className="mr-1 text-muted-foreground">{money(tt.shippingWaived)}</s>
                {t("orders.totals.free")}
              </span>
            ) : (
              t("orders.totals.free")
            )
          }
        />
        {codFee > 0 && <TotalRow label={t("orders.totals.codFee")} value={money(codFee)} />}
        <Separator className="my-1" />
        <TotalRow muted label={t("orders.totals.taxable")} value={money(tt.taxable)} />
        {tt.interState ? (
          <TotalRow muted label={t("orders.totals.igst")} value={money(tt.igst)} />
        ) : (
          <>
            <TotalRow muted label={t("orders.totals.cgst")} value={money(tt.cgst)} />
            <TotalRow muted label={t("orders.totals.sgst")} value={money(tt.sgst)} />
          </>
        )}
        {gst > 0 && <p className="text-xs text-muted-foreground">{allInclusive ? t("orders.totals.gstIncluded") : t("orders.totals.gstAdded")}</p>}
        {tt.roundOff !== 0 && <TotalRow muted label={t("orders.totals.roundOff")} value={`${tt.roundOff > 0 ? "+" : "−"}${money(Math.abs(tt.roundOff))}`} />}
        <Separator className="my-1" />
        <TotalRow strong label={t("orders.totals.total")} value={money(order.total)} />
      </div>
    </Section>
  );
}

/** "Silk saree – M / Red" → ["Silk saree", "M / Red"]. */
function splitName(name: string): [string, string | null] {
  const i = name.lastIndexOf(" – ");
  return i > 0 ? [name.slice(0, i), name.slice(i + 3)] : [name, null];
}
