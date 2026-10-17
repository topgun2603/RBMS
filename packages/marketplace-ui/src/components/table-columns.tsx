"use client";

import * as React from "react";
import { WalletIcon } from "lucide-react";
import { motion, Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, cn, type DataTableColumn } from "@srirealtime/ui";
import { ModuleLink, useI18n } from "@srirealtime/web";
import { bpsToPercent, money, signedMoney } from "../lib/logic";
import type { LedgerEntry, Payout, VendorOrder } from "../lib/types";
import { Amount, LedgerTypeTag, OrderStatusPill, PayoutPill, SettlementPill, Thumb } from "./bits";

/*
 * Columns shared by the server-driven tables (admin and seller portal). Sort keys match the API's sort maps
 * (packages/marketplace service: PAYOUT_SORT, LEDGER_SORT).
 */

/** Payout table columns (sort keys date, amount, status, paid). */
export function usePayoutColumns({ showVendor, actions }: { showVendor?: boolean; actions?: (p: Payout) => React.ReactNode } = {}): DataTableColumn<Payout>[] {
  const { t, formatDate } = useI18n();
  return React.useMemo<DataTableColumn<Payout>[]>(() => {
    const d = (s: string | null) => (s ? formatDate(s, { day: "numeric", month: "short", year: "numeric" }) : "—");
    const cols: DataTableColumn<Payout>[] = [
      {
        id: "date",
        header: t("marketplace.payouts.col.date"),
        sortable: true,
        sortDescFirst: true,
        card: "subtitle",
        cell: (p) => <span className="whitespace-nowrap tabular-nums text-muted-foreground">{d(p.createdAt)}</span>,
        cardCell: (p) => `${d(p.createdAt)} · ${t(`marketplace.settings.provider.${p.provider}`)}`,
      },
    ];
    if (showVendor)
      cols.push({
        id: "seller",
        header: t("marketplace.payouts.col.seller"),
        hideable: false,
        card: "title",
        className: "max-w-[16rem]",
        cell: (p) => (
          <ModuleLink to={`vendors/${p.vendorId}`} className="flex min-w-0 items-center gap-2.5 font-medium outline-none hover:text-primary focus-visible:underline">
            <span className="icon-chip size-8 shrink-0 rounded-lg text-primary">
              <WalletIcon className="size-4" />
            </span>
            <span className="truncate">{p.vendorName ?? "—"}</span>
          </ModuleLink>
        ),
        cardCell: (p) => p.vendorName ?? "—",
      });
    cols.push(
      {
        id: "period",
        header: t("marketplace.payouts.col.period"),
        hideBelow: "md",
        card: "meta",
        cell: (p) => <span className="whitespace-nowrap text-muted-foreground">{t("marketplace.payouts.period", { from: d(p.periodFrom), to: d(p.periodTo) })}</span>,
      },
      {
        id: "reference",
        header: t("marketplace.payouts.col.reference"),
        hideBelow: "lg",
        className: "max-w-[16rem]",
        cell: (p) => (
          <div className="grid min-w-0">
            <span className="truncate">
              {t(`marketplace.settings.provider.${p.provider}`)}
              {p.providerRef ? <span className="font-mono text-muted-foreground"> · {p.providerRef}</span> : null}
            </span>
            {p.error && <span className="truncate text-xs text-danger-ink">{p.error}</span>}
          </div>
        ),
      },
      {
        id: "status",
        header: t("marketplace.payouts.col.status"),
        sortable: true,
        card: "right",
        cell: (p) => <PayoutPill status={p.status} />,
      },
      {
        id: "paid",
        header: t("marketplace.payout.status.paid"),
        sortable: true,
        sortDescFirst: true,
        defaultHidden: true,
        cell: (p) => <span className="tabular-nums text-muted-foreground">{p.paidAt ? d(p.paidAt) : "—"}</span>,
      },
      {
        id: "amount",
        header: t("marketplace.payouts.col.amount"),
        sortable: true,
        numeric: true,
        hideable: false,
        card: showVendor ? "right" : "title",
        cell: (p) => <span className="font-semibold">{money(p.amount)}</span>,
      },
    );
    if (actions)
      cols.push({
        id: "actions",
        header: <span className="sr-only">{t("marketplace.payouts.col.actions")}</span>,
        label: t("marketplace.payouts.col.actions"),
        hideable: false,
        align: "right",
        width: "3.5rem",
        card: "meta",
        cell: (p) => actions(p),
      });
    return cols;
  }, [t, formatDate, showVendor, actions]);
}

/** Ledger table columns (sort keys date, amount, type). The balance column shows `balanceAfter` when the API sends it. */
export function useLedgerColumns({ showVendor, showBalance = true }: { showVendor?: boolean; showBalance?: boolean } = {}): DataTableColumn<LedgerEntry>[] {
  const { t, formatDate } = useI18n();
  return React.useMemo<DataTableColumn<LedgerEntry>[]>(() => {
    const when = (s: string) => formatDate(s, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
    const cols: DataTableColumn<LedgerEntry>[] = [
      {
        id: "date",
        header: t("marketplace.ledger.col.date"),
        sortable: true,
        sortDescFirst: true,
        hideable: false,
        card: "subtitle",
        cell: (e) => <span className="whitespace-nowrap tabular-nums text-muted-foreground">{when(e.createdAt)}</span>,
      },
    ];
    if (showVendor) cols.push({ id: "seller", header: t("marketplace.ledger.col.seller"), card: "meta", cell: (e) => <span className="font-medium">{e.vendorName ?? "—"}</span> });
    cols.push(
      { id: "type", header: t("marketplace.ledger.col.type"), sortable: true, card: "meta", cell: (e) => <LedgerTypeTag type={e.type} /> },
      {
        id: "note",
        header: t("marketplace.ledger.col.note"),
        card: "title",
        className: "max-w-[24rem]",
        cell: (e) => <span className="block truncate text-muted-foreground">{e.note ?? "—"}</span>,
        cardCell: (e) => e.note ?? t(`marketplace.ledger.type.${e.type}`),
      },
      {
        id: "amount",
        header: t("marketplace.ledger.col.amount"),
        sortable: true,
        numeric: true,
        hideable: false,
        card: "right",
        cell: (e) => (
          <Amount value={e.amount} signed>
            {signedMoney(e.amount)}
          </Amount>
        ),
      },
    );
    if (showBalance)
      cols.push({
        id: "balance",
        header: t("marketplace.ledger.col.balance"),
        numeric: true,
        card: "right",
        cell: (e) => <span className="font-semibold">{e.balanceAfter === undefined ? "—" : money(e.balanceAfter)}</span>,
        cardCell: (e) => (e.balanceAfter === undefined ? null : <span className="text-meta font-normal text-muted-foreground tabular-nums">{money(e.balanceAfter)}</span>),
      });
    return cols;
  }, [t, formatDate, showVendor, showBalance]);
}

/** One seller order in a side sheet: lines, money and tracking (table rows open it). */
export function VendorOrderSheet({ order, onClose, actions }: { order: VendorOrder | null; onClose: () => void; actions?: (o: VendorOrder) => React.ReactNode }) {
  const { t, formatDate } = useI18n();
  // Keep the last order on screen while the sheet slides out.
  const [last, setLast] = React.useState<VendorOrder | null>(order);
  React.useEffect(() => {
    if (order) setLast(order);
  }, [order]);
  const o = order ?? last;
  const footer = o && actions ? actions(o) : null;
  return (
    <Sheet open={!!order} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg" closeLabel={t("marketplace.common.close")}>
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>{o ? t("marketplace.orders.detailTitle", { number: o.orderNumber }) : " "}</SheetTitle>
          <SheetDescription>{o ? formatDate(o.placedAt, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : " "}</SheetDescription>
        </SheetHeader>
        {o && (
          <motion.div key={o.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex-1 overflow-y-auto">
            <div className="flex flex-wrap items-center gap-1.5 px-5 pt-4">
              <OrderStatusPill status={o.status} />
              <SettlementPill status={o.settlementStatus} />
            </div>
            <ul className="divide-y px-5 pt-2">
              {o.lines.map((l) => (
                <li key={l.variantId} className="flex items-center gap-3 py-2.5">
                  <Thumb src={l.image} className="size-10" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.name}</p>
                    <p className="text-meta text-muted-foreground">
                      {l.qty} {l.unit} × {money(l.price)}
                      {l.sku ? ` · ${l.sku}` : ""}
                    </p>
                  </div>
                  <span className="text-sm tabular-nums">{money(l.gross)}</span>
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t px-5 py-4 text-sm">
              <Figure label={t("marketplace.orders.subtotal")} value={money(o.subtotal)} />
              {o.discount > 0 && <Figure label={t("marketplace.orders.discount")} value={`−${money(o.discount)}`} />}
              {o.shippingShare > 0 && <Figure label={t("marketplace.orders.shipping")} value={money(o.shippingShare)} />}
              <Figure label={t("marketplace.orders.commission", { rate: bpsToPercent(o.commissionBps) })} value={`−${money(o.commission)}`} />
              <Figure label={t("marketplace.orders.net")} value={money(o.net)} strong />
              {o.eligibleAt && <Figure label={t("marketplace.orders.payableFrom")} value={formatDate(o.eligibleAt, { day: "numeric", month: "short" })} />}
              {o.trackingNumber && <Figure label={t("marketplace.orders.tracking")} value={[o.carrier, o.trackingNumber].filter(Boolean).join(" ")} />}
            </dl>
          </motion.div>
        )}
        {footer && <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t px-5 py-3">{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("tabular-nums", strong && "font-semibold")}>{value}</dd>
    </div>
  );
}
