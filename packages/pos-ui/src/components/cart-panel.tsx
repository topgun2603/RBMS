"use client";

import * as React from "react";
import { ChevronDownIcon, MinusIcon, PauseIcon, PencilIcon, PlusIcon, ShoppingCartIcon, Trash2Icon, WalletIcon } from "lucide-react";
import { AnimatedNumber, AnimatePresence, Badge, Button, cn, motion, RollingNumber, useReducedMotionSafe } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { lineGross, type CartLine, type CartTotals } from "../lib/cart";
import { batchSpill } from "../lib/batches";
import { fmtExpiry, formatQty, money } from "../lib/format";

export interface CartPanelProps {
  lines: CartLine[];
  totals: CartTotals;
  /** Payable after loyalty points (equals totals.total without points). */
  payable: number;
  pointsDiscount: number;
  selectedKey: string | null;
  flash: { key: string; n: number } | null;
  stock?: Map<string, { available: number; tracked: boolean }>;
  /** Items that use batches, and the handler that opens the batch picker for a line. */
  batchTracked?: ReadonlySet<string>;
  onBatch?: (key: string) => void;
  onSelect: (key: string) => void;
  onStep: (key: string, delta: 1 | -1) => void;
  onEdit: (key: string) => void;
  onRemove: (key: string) => void;
  onHold: () => void;
  onPay: () => void;
  payBlocked: string | null;
  customerBar: React.ReactNode;
  /** Suggestions under the lines ("customers also buy" chips). */
  suggestions?: React.ReactNode;
}

export function CartPanel(p: CartPanelProps) {
  const { t } = useI18n();
  const listRef = React.useRef<HTMLDivElement>(null);

  // Keep the selected / just-scanned line in view.
  React.useEffect(() => {
    const key = p.flash?.key ?? p.selectedKey;
    if (!key) return;
    listRef.current?.querySelector(`[data-line="${key}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [p.flash, p.selectedKey]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-3 pb-2">{p.customerBar}</div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3" role="list" aria-label={t("pos.cart.title")}>
        {p.lines.length === 0 ? (
          <div className="grid h-full min-h-40 place-items-center text-center">
            <div className="grid justify-items-center gap-2 text-muted-foreground">
              <ShoppingCartIcon className="size-10 opacity-40" />
              <p className="text-sm font-medium">{t("pos.cart.empty")}</p>
              <p className="max-w-56 text-xs">{t("pos.cart.emptyHint")}</p>
            </div>
          </div>
        ) : (
          <ul className="grid gap-1.5 pb-2">
            <AnimatePresence initial={false}>
              {p.lines.map((l, i) => (
                <LineRow
                  key={l.key}
                  line={l}
                  total={p.totals.lines[i]?.total ?? 0}
                  selected={p.selectedKey === l.key}
                  flashN={p.flash?.key === l.key ? p.flash.n : 0}
                  stock={p.stock?.get(l.itemId)}
                  onBatch={p.batchTracked?.has(l.itemId) && p.onBatch ? () => p.onBatch!(l.key) : undefined}
                  onSelect={() => p.onSelect(l.key)}
                  onStep={(d) => p.onStep(l.key, d)}
                  onEdit={() => p.onEdit(l.key)}
                  onRemove={() => p.onRemove(l.key)}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
      {p.suggestions}
      <Totals lines={p.lines} totals={p.totals} payable={p.payable} pointsDiscount={p.pointsDiscount} />
      <div className="grid grid-cols-[auto_1fr] gap-2 border-t bg-card p-3">
        <Button type="button" variant="outline" size="lg" className="h-14 px-4" onClick={p.onHold} disabled={p.lines.length === 0}>
          <PauseIcon /> <span className="hidden sm:inline">{t("pos.cart.hold")}</span>
          <kbd className="hidden font-mono text-[0.6875rem] opacity-60 lg:inline">F8</kbd>
        </Button>
        <Button
          type="button"
          size="lg"
          className="h-14 justify-between px-5 text-lg"
          onClick={p.onPay}
          disabled={p.lines.length === 0}
          title={p.payBlocked ?? undefined}
        >
          <span className="flex items-center gap-2">
            <WalletIcon className="size-5" /> {t("pos.cart.pay")}
            <kbd className="hidden font-mono text-xs opacity-70 lg:inline">F9</kbd>
          </span>
          <AnimatedNumber value={p.payable} format={money} className="font-semibold tabular-nums" />
        </Button>
      </div>
    </div>
  );
}

function LineRow({
  line,
  total,
  selected,
  flashN,
  stock,
  onBatch,
  onSelect,
  onStep,
  onEdit,
  onRemove,
}: {
  line: CartLine;
  total: number;
  selected: boolean;
  flashN: number;
  stock?: { available: number; tracked: boolean };
  onBatch?: () => void;
  onSelect: () => void;
  onStep: (d: 1 | -1) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const priceChanged = line.price !== line.listPrice;
  const short = stock?.tracked && stock.available < line.qty;
  return (
    <motion.li
      layout={!reduced}
      data-line={line.key}
      initial={{ opacity: 0, x: reduced ? 0 : 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: reduced ? 0 : -24, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 500, damping: 38 }}
      role="listitem"
      onClick={onSelect}
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card p-2.5 transition-colors",
        selected ? "border-primary/60 ring-2 ring-primary/20" : "hover:border-foreground/20",
      )}
    >
      {flashN > 0 && (
        <motion.span
          key={flashN}
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-primary/15"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
      )}
      <div className="relative flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm leading-snug font-medium">{line.name}</p>
          {line.serials?.length ? <p className="truncate font-mono text-[11px] text-muted-foreground">{t("pos.cart.serials", { list: line.serials.join(", ") })}</p> : null}
          {onBatch ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBatch();
              }}
              className="max-w-full truncate rounded font-mono text-[11px] text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("pos.batch.change")}
            >
              {line.batch ? (line.batch.expiry ? t("pos.batch.line", { no: line.batch.no, exp: fmtExpiry(line.batch.expiry) }) : t("pos.batch.lineNoExp", { no: line.batch.no })) : t("pos.batch.choose")}
            </button>
          ) : null}
          {onBatch && line.batch && batchSpill(line) > 0 ? (
            <p className="text-[11px] text-warning-ink" data-batch-spill>
              {t("pos.batch.spill", { left: formatQty(Math.max(0, line.batch.qty ?? 0)), extra: formatQty(batchSpill(line)) })}
            </p>
          ) : null}
          {line.ticket ? (
            <Badge variant="muted" className="mt-0.5 font-mono" data-ticket={line.ticket.code}>
              {t("pos.cart.ticket", { code: line.ticket.code })}
            </Badge>
          ) : null}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
            <span>
              {money(line.price)} / {line.unit}
            </span>
            {priceChanged && <span className="line-through opacity-70">{money(line.listPrice)}</span>}
            {line.discount > 0 && (
              <Badge variant="success" className="tabular-nums">
                −{money(Math.min(line.discount, lineGross(line)))}
              </Badge>
            )}
            {short && (
              <Badge variant="warning">{stock!.available > 0 ? t("pos.cart.lowStock", { qty: formatQty(stock!.available) }) : t("pos.cart.noStock")}</Badge>
            )}
          </p>
        </div>
        <p className="shrink-0 text-right text-base font-semibold tabular-nums">{money(total)}</p>
      </div>
      <div className="relative mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center rounded-lg border bg-background" onClick={(e) => e.stopPropagation()}>
          <Button type="button" variant="ghost" size="icon" aria-label={t("pos.cart.less", { name: line.name })} onClick={() => onStep(-1)} disabled={line.qty <= 1 || !!line.ticket}>
            <MinusIcon />
          </Button>
          <button
            type="button"
            onClick={onEdit}
            disabled={!!line.ticket}
            className="min-w-12 px-1 text-center text-base font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label={t("pos.cart.qtyOf", { name: line.name, qty: formatQty(line.qty) })}
          >
            <RollingNumber value={formatQty(line.qty)} />
          </button>
          <Button type="button" variant="ghost" size="icon" aria-label={t("pos.cart.more", { name: line.name })} onClick={() => onStep(1)} disabled={!!line.ticket}>
            <PlusIcon />
          </Button>
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button type="button" variant="ghost" size="icon" aria-label={t("pos.cart.edit", { name: line.name })} onClick={onEdit} disabled={!!line.ticket}>
            <PencilIcon />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive" aria-label={t("pos.cart.remove", { name: line.name })} onClick={onRemove}>
            <Trash2Icon />
          </Button>
        </div>
      </div>
    </motion.li>
  );
}

function Totals({
  lines,
  totals,
  payable,
  pointsDiscount,
}: {
  lines: CartLine[];
  totals: CartTotals;
  payable: number;
  pointsDiscount: number;
}) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  // Items as priced − discount + GST added on exclusive prices = the lines' totals. GST inside MRP prices is info only.
  const gross = lines.reduce((s, l) => s + lineGross(l), 0);
  let added = 0;
  let included = 0;
  totals.lines.forEach((c, i) => {
    const tax = c.cgst + c.sgst + c.igst;
    if (lines[i]?.taxInclusive) included += tax;
    else added += tax;
  });
  const row = "flex items-center justify-between gap-3 text-sm tabular-nums";
  return (
    <div className="grid gap-1 border-t bg-muted/30 px-3 py-2.5">
      <div className={row}>
        <span className="text-muted-foreground">{t("pos.totals.items", { count: totals.count, units: formatQty(totals.units) })}</span>
        <span>{money(gross)}</span>
      </div>
      {totals.savings > 0 && (
        <div className={cn(row, "text-success-ink")}>
          <span>{t("pos.totals.discount")}</span>
          <span>−{money(totals.savings)}</span>
        </div>
      )}
      <button type="button" className={cn(row, "rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50")} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="flex items-center gap-1 text-muted-foreground">
          {added > 0 ? t("pos.totals.gst") : t("pos.totals.gstIncluded")}
          <ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </span>
        <span className={cn(added === 0 && "text-muted-foreground")}>{added > 0 ? `+${money(added)}` : money(included)}</span>
      </button>
      {added > 0 && included > 0 && (
        <div className={cn(row, "text-xs text-muted-foreground")}>
          <span>{t("pos.totals.gstIncluded")}</span>
          <span>{money(included)}</span>
        </div>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="grid gap-0.5 rounded-lg border bg-card px-2.5 py-2 text-xs text-muted-foreground tabular-nums">
              <div className="flex justify-between">
                <span>{t("pos.totals.taxable")}</span>
                <span>{money(totals.taxable)}</span>
              </div>
              {totals.taxBreakup.map((r) => (
                <React.Fragment key={r.gstRate}>
                  {r.igst > 0 ? (
                    <div className="flex justify-between">
                      <span>{t("pos.totals.igstAt", { rate: r.gstRate })}</span>
                      <span>{money(r.igst)}</span>
                    </div>
                  ) : r.cgst + r.sgst > 0 ? (
                    <>
                      <div className="flex justify-between">
                        <span>{t("pos.totals.cgstAt", { rate: r.gstRate / 2 })}</span>
                        <span>{money(r.cgst)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t("pos.totals.sgstAt", { rate: r.gstRate / 2 })}</span>
                        <span>{money(r.sgst)}</span>
                      </div>
                    </>
                  ) : null}
                </React.Fragment>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {totals.roundOff !== 0 && (
        <div className={row}>
          <span className="text-muted-foreground">{t("pos.totals.roundOff")}</span>
          <span>
            {totals.roundOff > 0 ? "+" : "−"}
            {money(Math.abs(totals.roundOff))}
          </span>
        </div>
      )}
      {pointsDiscount > 0 && (
        <div className={cn(row, "text-success-ink")}>
          <span>{t("pos.totals.points")}</span>
          <span>−{money(totals.total - payable)}</span>
        </div>
      )}
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span className="text-base font-semibold">{t("pos.totals.total")}</span>
        <AnimatedNumber value={payable} format={money} className="text-2xl font-bold tracking-tight tabular-nums" />
      </div>
    </div>
  );
}
