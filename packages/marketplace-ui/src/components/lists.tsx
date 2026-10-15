"use client";

import * as React from "react";
import { ChevronDownIcon, ReceiptTextIcon, WalletIcon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  Card,
  cn,
  EmptyState,
  motion,
  Skeleton,
  Stagger,
  StaggerItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { bpsToPercent, money, saleAmountOf, signedMoney, type LedgerRow } from "../lib/logic";
import type { Payout, VendorOrder } from "../lib/types";
import { Amount, LedgerTypeTag, OrderStatusPill, PayoutPill, SettlementPill, Thumb } from "./bits";

/** Table skeleton: `rows` grey bars. */
export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b px-4 py-3.5 last:border-0">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/5" />
          </div>
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </Card>
  );
}

/** Prev / next pager for offset lists. */
export function Pager({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (offset: number) => void }) {
  const { t } = useI18n();
  if (total <= limit) return null;
  return (
    <div className="mt-3 flex items-center justify-between gap-2 text-sm text-muted-foreground">
      <span className="tabular-nums">{t("marketplace.common.range", { from: offset + 1, to: Math.min(offset + limit, total), total })}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(offset - limit, 0))}>
          {t("marketplace.common.prev")}
        </Button>
        <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
          {t("marketplace.common.next")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ledger

/** Ledger entries newest first; `balanceAfter` shown when known (unfiltered lists). */
export function LedgerList({ rows, showVendor, showBalance = true }: { rows: (Omit<LedgerRow, "balanceAfter"> & { balanceAfter: number | null })[]; showVendor?: boolean; showBalance?: boolean }) {
  const { t, formatDate } = useI18n();
  if (rows.length === 0) {
    return <EmptyState icon={ReceiptTextIcon} title={t("marketplace.ledger.emptyTitle")} description={t("marketplace.ledger.emptyBody")} />;
  }
  const when = (d: string) => formatDate(d, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <>
      <Card className="hidden gap-0 overflow-hidden py-0 md:flex">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="pl-4">{t("marketplace.ledger.col.date")}</TableHead>
              {showVendor && <TableHead>{t("marketplace.ledger.col.seller")}</TableHead>}
              <TableHead>{t("marketplace.ledger.col.type")}</TableHead>
              <TableHead>{t("marketplace.ledger.col.note")}</TableHead>
              <TableHead className="text-right">{t("marketplace.ledger.col.amount")}</TableHead>
              {showBalance && <TableHead className="pr-4 text-right">{t("marketplace.ledger.col.balance")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="pl-4 whitespace-nowrap text-muted-foreground">{when(e.createdAt)}</TableCell>
                {showVendor && <TableCell className="font-medium">{e.vendorName ?? "—"}</TableCell>}
                <TableCell>
                  <LedgerTypeTag type={e.type} />
                </TableCell>
                <TableCell className="max-w-[22rem] truncate text-muted-foreground">{e.note ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <Amount value={e.amount} signed>
                    {signedMoney(e.amount)}
                  </Amount>
                </TableCell>
                {showBalance && (
                  <TableCell className="pr-4 text-right font-semibold tabular-nums">{e.balanceAfter === null ? "—" : money(e.balanceAfter)}</TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Stagger className="grid gap-2 md:hidden">
        {rows.map((e) => (
          <StaggerItem key={e.id}>
            <Card className="flex-row items-center gap-3 p-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <LedgerTypeTag type={e.type} />
                  <span className="truncate text-xs text-muted-foreground">{when(e.createdAt)}</span>
                </div>
                <p className="truncate text-sm">{showVendor && e.vendorName ? `${e.vendorName} · ` : ""}{e.note ?? "—"}</p>
              </div>
              <div className="text-right">
                <Amount value={e.amount} signed>
                  {signedMoney(e.amount)}
                </Amount>
                {showBalance && e.balanceAfter !== null && <p className="text-xs text-muted-foreground tabular-nums">{money(e.balanceAfter)}</p>}
              </div>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>
    </>
  );
}

// ---------------------------------------------------------------- vendor orders

/** Seller orders with expandable lines. `shipBy` is the ship-by hint for open orders (days after placing). */
export function VendorOrdersList({ items, showVendor, shipByDays }: { items: VendorOrder[]; showVendor?: boolean; shipByDays?: number }) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState<string | null>(null);
  if (items.length === 0) {
    return <EmptyState icon={ReceiptTextIcon} title={t("marketplace.orders.emptyTitle")} description={t("marketplace.orders.emptyBody")} />;
  }
  return (
    <Stagger className="grid gap-2">
      {items.map((o) => (
        <StaggerItem key={o.id}>
          <OrderCard order={o} showVendor={showVendor} shipByDays={shipByDays} open={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} />
        </StaggerItem>
      ))}
    </Stagger>
  );
}

const OPEN_STATUSES = new Set(["placed", "confirmed", "packed"]);

function OrderCard({ order: o, showVendor, shipByDays, open, onToggle }: { order: VendorOrder; showVendor?: boolean; shipByDays?: number; open: boolean; onToggle: () => void }) {
  const { t, formatDate } = useI18n();
  const shipBy =
    shipByDays !== undefined && OPEN_STATUSES.has(o.status) ? new Date(new Date(o.placedAt).getTime() + shipByDays * 86_400_000) : null;
  const late = shipBy ? shipBy.getTime() < Date.now() : false;
  const items = o.lines.reduce((n, l) => n + l.qty, 0);
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 p-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring sm:p-4"
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {o.orderNumber}
            {showVendor && o.vendorName ? <span className="font-normal text-muted-foreground"> · {o.vendorName}</span> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDate(o.placedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {t("marketplace.orders.items", { count: items })}
            {shipBy && (
              <span className={cn("ml-1", late ? "font-medium text-danger-ink" : "")}>
                · {t(late ? "marketplace.orders.shipLate" : "marketplace.orders.shipBy", { date: formatDate(shipBy, { day: "numeric", month: "short" }) })}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <OrderStatusPill status={o.status} />
          <SettlementPill status={o.settlementStatus} />
        </div>
        <div className="text-right">
          <p className="font-semibold tabular-nums">{money(o.net)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">{t("marketplace.orders.ofSale", { sale: money(saleAmountOf(o)) })}</p>
        </div>
        <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t bg-muted/20"
          >
            <ul className="divide-y px-3 sm:px-4">
              {o.lines.map((l) => (
                <li key={l.variantId} className="flex items-center gap-3 py-2.5">
                  <Thumb src={l.image} className="size-10" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.qty} {l.unit} × {money(l.price)}
                      {l.sku ? ` · ${l.sku}` : ""}
                    </p>
                  </div>
                  <span className="text-sm tabular-nums">{money(l.gross)}</span>
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t px-3 py-3 text-sm sm:grid-cols-4 sm:px-4">
              <Figure label={t("marketplace.orders.subtotal")} value={money(o.subtotal)} />
              {o.discount > 0 && <Figure label={t("marketplace.orders.discount")} value={`−${money(o.discount)}`} />}
              {o.shippingShare > 0 && <Figure label={t("marketplace.orders.shipping")} value={money(o.shippingShare)} />}
              <Figure label={t("marketplace.orders.commission", { rate: bpsToPercent(o.commissionBps) })} value={`−${money(o.commission)}`} />
              <Figure label={t("marketplace.orders.net")} value={money(o.net)} strong />
              {o.eligibleAt && <Figure label={t("marketplace.orders.payableFrom")} value={formatDate(o.eligibleAt, { day: "numeric", month: "short" })} />}
            </dl>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
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

// ---------------------------------------------------------------- payouts

export function PayoutsList({ items, showVendor, actions }: { items: Payout[]; showVendor?: boolean; actions?: (p: Payout) => React.ReactNode }) {
  const { t, formatDate } = useI18n();
  if (items.length === 0) {
    return <EmptyState icon={WalletIcon} title={t("marketplace.payouts.emptyTitle")} description={t("marketplace.payouts.emptyBody")} />;
  }
  const d = (s: string | null) => (s ? formatDate(s, { day: "numeric", month: "short", year: "numeric" }) : "—");
  return (
    <Stagger className="grid gap-2">
      {items.map((p) => (
        <StaggerItem key={p.id}>
          <Card className="flex-row flex-wrap items-center gap-x-4 gap-y-2 p-3 sm:p-4">
            <span className="icon-chip size-10 rounded-xl text-primary">
              <WalletIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {showVendor && p.vendorName ? `${p.vendorName} · ` : ""}
                <span className="tabular-nums">{money(p.amount)}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {t("marketplace.payouts.period", { from: d(p.periodFrom), to: d(p.periodTo) })} · {t(`marketplace.settings.provider.${p.provider}`)}
                {p.providerRef ? ` · ${p.providerRef}` : ""}
              </p>
              {p.error && <p className="text-xs text-danger-ink">{p.error}</p>}
            </div>
            <div className="flex flex-col items-end gap-1">
              <PayoutPill status={p.status} />
              <span className="text-xs text-muted-foreground">{p.paidAt ? t("marketplace.payouts.paidOn", { date: d(p.paidAt) }) : d(p.createdAt)}</span>
            </div>
            {actions && <div className="flex w-full justify-end gap-2 sm:w-auto">{actions(p)}</div>}
          </Card>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
