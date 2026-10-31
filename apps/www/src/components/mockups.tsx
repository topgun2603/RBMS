"use client";

import * as React from "react";
import { CheckIcon, CheckCheckIcon, ShoppingBagIcon, SearchIcon, BellRingIcon, IndianRupeeIcon, MessageCircleIcon, PackageIcon } from "lucide-react";
import { Badge } from "@rbms/ui/components/badge";
import { Card } from "@rbms/ui/components/card";
import { AnimatedNumber, AnimatePresence, RollingNumber, motion, useInView, useReducedMotionSafe } from "@rbms/ui/motion";
import { cn } from "@rbms/ui/lib/utils";
import { useSite } from "./site-context";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const inr2 = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const INVOICE = [
  { key: "mock.invoice.item1", qty: 1, amount: 420 },
  { key: "mock.invoice.item2", qty: 1, amount: 380 },
  { key: "mock.invoice.item3", qty: 1, amount: 160 },
  { key: "mock.invoice.item4", qty: 1, amount: 280 },
];

/** A GST tax invoice as the billing app prints / shares it (5% GST split into CGST + SGST). */
export function InvoiceMockup({ className }: { className?: string }) {
  const { t } = useSite();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const taxable = INVOICE.reduce((s, l) => s + l.amount, 0);
  const half = Math.round(taxable * 0.025 * 100) / 100;
  const total = taxable + half * 2;
  return (
    <Card ref={ref} className={cn("gap-0 overflow-hidden rounded-2xl py-0 shadow-www", className)} aria-hidden="true">
      <div className="flex items-start justify-between gap-3 border-b bg-tint px-5 py-4">
        <div className="min-w-0">
          <p className="truncate font-display text-base font-bold">{t("mock.invoice.shop")}</p>
          <p className="truncate text-xs text-muted-foreground">{t("mock.invoice.city")} · GSTIN 33ABCDE1234F1Z5</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">{t("mock.invoice.title")}</p>
          <p className="text-xs text-muted-foreground tabular-nums">A-0142</p>
        </div>
      </div>
      <div className="px-5 py-3">
        <div className="flex justify-between pb-1 text-xs font-medium text-muted-foreground">
          <span>{t("mock.invoice.qty")}</span>
          <span>{t("mock.invoice.amount")}</span>
        </div>
        <ul className="divide-y divide-dashed">
          {INVOICE.map((l, i) => (
            <motion.li
              key={l.key}
              initial={false}
              animate={inView ? { opacity: 1, x: 0 } : { opacity: 0.001, x: -10 }}
              transition={{ delay: 0.15 + i * 0.12, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate">
                <span className="mr-2 text-muted-foreground tabular-nums">{l.qty}×</span>
                {t(l.key)}
              </span>
              <span className="shrink-0 tabular-nums">{inr(l.amount)}</span>
            </motion.li>
          ))}
        </ul>
        <dl className="mt-2 space-y-1 border-t pt-2 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <dt>{t("mock.invoice.subtotal")}</dt>
            <dd className="tabular-nums">{inr2(taxable)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>CGST 2.5%</dt>
            <dd className="tabular-nums">{inr2(half)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>SGST 2.5%</dt>
            <dd className="tabular-nums">{inr2(half)}</dd>
          </div>
        </dl>
      </div>
      <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-5 py-3">
        <motion.span initial={false} animate={inView ? { scale: 1, opacity: 1 } : { scale: 0.6, opacity: 0 }} transition={{ delay: 0.8, type: "spring", stiffness: 420, damping: 18 }}>
          <Badge variant="success" className="gap-1">
            <CheckIcon />
            {t("mock.invoice.paid")}
          </Badge>
        </motion.span>
        <p className="text-right">
          <span className="block text-xs text-muted-foreground">{t("mock.invoice.total")}</span>
          <span className="font-display text-xl font-bold tabular-nums">
            {inView ? <AnimatedNumber value={total} from={0} duration={1.1} format={(n) => inr2(Math.round(n * 100) / 100)} /> : inr2(total)}
          </span>
        </p>
      </div>
    </Card>
  );
}

const PRODUCTS = [
  { key: "mock.store.p1", price: 8450, hue: 350 },
  { key: "mock.store.p2", price: 1290, hue: 160 },
  { key: "mock.store.p3", price: 1890, hue: 45 },
  { key: "mock.store.p4", price: 2350, hue: 275 },
];

/** Kolam-dot motif for product tiles (no stock photos). */
function TileArt({ hue }: { hue: number }) {
  return (
    <svg viewBox="0 0 80 80" className="size-full" aria-hidden="true">
      <defs>
        <linearGradient id={`tile-${hue}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`oklch(0.72 0.14 ${hue})`} />
          <stop offset="1" stopColor={`oklch(0.48 0.16 ${hue + 20})`} />
        </linearGradient>
      </defs>
      <rect width="80" height="80" fill={`url(#tile-${hue})`} />
      <path d="M0 58 Q20 48 40 58 T80 58 V80 H0Z" fill="oklch(0.9 0.12 80 / 0.55)" />
      <path d="M0 64 Q20 54 40 64 T80 64" stroke="oklch(0.95 0.1 85)" strokeWidth="1.5" fill="none" />
      {[16, 32, 48, 64].map((x) => (
        <circle key={x} cx={x} cy="24" r="2.2" fill="oklch(1 0 0 / 0.75)" />
      ))}
      {[24, 40, 56].map((x) => (
        <circle key={x} cx={x} cy="36" r="2.2" fill="oklch(1 0 0 / 0.6)" />
      ))}
    </svg>
  );
}

/** A phone showing a shop's online store; it "adds" products to the cart on a loop while on screen. */
export function PhoneStoreMockup({ className }: { className?: string }) {
  const { t } = useSite();
  const reduced = useReducedMotionSafe();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const [added, setAdded] = React.useState<number[]>([]);
  React.useEffect(() => {
    if (!inView || reduced) return;
    const id = window.setInterval(() => {
      setAdded((a) => (a.length >= PRODUCTS.length ? [] : [...a, a.length]));
    }, 1700);
    return () => window.clearInterval(id);
  }, [inView, reduced]);
  return (
    <div ref={ref} className={cn("relative mx-auto w-[260px] rounded-[2.6rem] border border-foreground/10 bg-neutral-900 p-2.5 shadow-www dark:bg-neutral-800", className)} aria-hidden="true">
      <div className="absolute top-3.5 left-1/2 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-neutral-900 dark:bg-neutral-800" />
      <div className="overflow-hidden rounded-[2.1rem] bg-background">
        <div className="flex items-center justify-between px-5 pt-3 pb-1 text-[10px] font-semibold text-muted-foreground">
          <span>9:41</span>
          <span>5G</span>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[oklch(0.5_0.17_350)] text-xs font-bold text-white">M</span>
            <span className="truncate font-display text-sm font-bold">{t("mock.store.shop")}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <SearchIcon className="size-4" />
            <span className="relative">
              <ShoppingBagIcon className="size-4.5 text-foreground" />
              <motion.span key={added.length} initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 600, damping: 15 }} className="absolute -top-1.5 -right-2 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                <RollingNumber value={added.length} />
              </motion.span>
            </span>
          </div>
        </div>
        <div className="mx-3 overflow-hidden rounded-2xl bg-[linear-gradient(120deg,oklch(0.45_0.16_350),oklch(0.62_0.17_25)_60%,oklch(0.8_0.15_75))] p-4 text-white">
          <p className="text-[10px] font-semibold tracking-wider uppercase opacity-90">{t("mock.store.bannerSub")}</p>
          <p className="mt-1 font-display text-lg leading-tight font-bold">{t("mock.store.banner")}</p>
          <div className="mt-3 flex gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className={cn("h-1 rounded-full bg-white/60", i === 0 ? "w-5 bg-white" : "w-2")} />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 p-3">
          {PRODUCTS.map((p, i) => {
            const on = added.includes(i);
            return (
              <div key={p.key} className="overflow-hidden rounded-xl border bg-card">
                <div className="aspect-square">
                  <TileArt hue={p.hue} />
                </div>
                <div className="space-y-1 p-2">
                  <p className="truncate text-xs leading-tight font-medium">{t(p.key)}</p>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold tabular-nums">{inr(p.price)}</span>
                    <motion.span layout className={cn("flex h-5 items-center gap-0.5 rounded-full px-2 text-[9px] font-semibold", on ? "bg-success/15 text-success" : "bg-primary text-primary-foreground")}>
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span key={on ? "y" : "n"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} className="flex items-center gap-0.5">
                          {on && <CheckIcon className="size-2.5" />}
                          {on ? t("mock.store.added") : t("mock.store.add")}
                        </motion.span>
                      </AnimatePresence>
                    </motion.span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const CREDIT = [
  { key: "mock.credit.c1", due: 1250, hue: 25 },
  { key: "mock.credit.c2", due: 640, hue: 200 },
  { key: "mock.credit.c3", due: 2180, hue: 300 },
];

/** Credit book card: who owes what, with a WhatsApp reminder going out. */
export function CreditBookMockup({ className }: { className?: string }) {
  const { t } = useSite();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  return (
    <Card ref={ref} className={cn("gap-3 rounded-2xl p-4 shadow-www", className)} aria-hidden="true">
      <div className="flex items-center justify-between">
        <p className="font-display text-sm font-bold">{t("mock.credit.title")}</p>
        <Badge variant="warning">{t("mock.credit.due")} {inr(CREDIT.reduce((s, c) => s + c.due, 0))}</Badge>
      </div>
      <ul className="space-y-2">
        {CREDIT.map((c, i) => (
          <li key={c.key} className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: `oklch(0.6 0.13 ${c.hue})` }}>
              {t(c.key).charAt(0)}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">{t(c.key)}</span>
            <span className="text-sm font-semibold tabular-nums">{inr(c.due)}</span>
            {i === 0 && (
              <motion.span initial={false} animate={inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.5 }} transition={{ delay: 0.9, type: "spring", stiffness: 400, damping: 16 }} className="flex size-6 items-center justify-center rounded-full bg-[#25D366] text-white">
                <CheckCheckIcon className="size-3.5" />
              </motion.span>
            )}
          </li>
        ))}
      </ul>
      <motion.p initial={false} animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }} transition={{ delay: 1.1, duration: 0.4 }} className="flex items-center gap-1.5 text-xs text-success">
        <BellRingIcon className="size-3.5" />
        {t("mock.credit.reminded")}: {t("mock.credit.c1")}
      </motion.p>
    </Card>
  );
}

type ChipKind = "upi" | "whatsapp" | "order";
const CHIP_ICON = { upi: IndianRupeeIcon, whatsapp: MessageCircleIcon, order: PackageIcon } as const;
const CHIP_TONE = {
  upi: "bg-success text-white",
  whatsapp: "bg-[#25D366] text-white",
  order: "bg-marigold text-neutral-900",
} as const;

/** Small floating notification used around the hero mockups. */
export function NotifyChip({ kind, detail, className, delay = 0 }: { kind: ChipKind; detail?: string; className?: string; delay?: number }) {
  const { t } = useSite();
  const reduced = useReducedMotionSafe();
  const Icon = CHIP_ICON[kind];
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 12, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, type: "spring", stiffness: 260, damping: 20 }}
      className={cn("pointer-events-none absolute z-20", className)}
      aria-hidden="true"
    >
      <motion.div
        animate={reduced ? undefined : { y: [0, -6, 0] }}
        transition={{ duration: 4 + delay, repeat: Infinity, ease: "easeInOut" }}
        className="flex items-center gap-2.5 rounded-2xl border bg-popover/95 py-2 pr-4 pl-2 shadow-www backdrop-blur"
      >
        <span className={cn("flex size-8 items-center justify-center rounded-xl", CHIP_TONE[kind])}>
          <Icon className="size-4" />
        </span>
        <span className="leading-tight">
          <span className="block text-xs font-semibold whitespace-nowrap">{t(`hero.chip.${kind}`)}</span>
          {detail && <span className="block text-xs text-muted-foreground tabular-nums">{detail}</span>}
        </span>
      </motion.div>
    </motion.div>
  );
}

/** A counter terminal: pairing code, cashier PIN and a weigh ticket with a barcode. */
export function PosMockup({ className }: { className?: string }) {
  const { t } = useSite();
  const bars = [2, 1, 3, 1, 1, 2, 3, 1, 2, 1, 1, 3, 2, 1, 3, 1, 2];
  return (
    <div className={cn("grid w-full max-w-[420px] gap-4 sm:grid-cols-[1.1fr_1fr]", className)} aria-hidden="true">
      <Card className="gap-3 rounded-2xl p-4 shadow-www">
        <p className="font-display text-sm font-bold">{t("mock.pos.terminal")}</p>
        <div>
          <p className="text-xs text-muted-foreground">{t("mock.pos.pair")}</p>
          <p className="mt-1 rounded-lg bg-tint px-3 py-2 text-center font-mono text-base font-bold tracking-widest tabular-nums">K7M4 9QXA</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("mock.pos.pin")}</p>
          <div className="mt-1 flex justify-center gap-2">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={cn("size-3 rounded-full border", i < 3 ? "border-primary bg-primary" : "bg-card")} />
            ))}
          </div>
        </div>
      </Card>
      <Card className="gap-2 rounded-2xl border-dashed p-4 shadow-www">
        <p className="font-display text-sm font-bold">{t("mock.pos.ticket")}</p>
        <p className="text-sm">{t("mock.pos.item")}</p>
        <p className="flex justify-between text-xs text-muted-foreground">
          <span>{t("mock.pos.weight")}</span>
          <span className="tabular-nums">2.350 kg</span>
        </p>
        <p className="flex justify-between text-sm font-semibold">
          <span>{t("mock.pos.total")}</span>
          <span className="tabular-nums">₹376.00</span>
        </p>
        <div className="mt-1 flex h-9 items-stretch gap-[2px]">
          {bars.map((w, i) => (
            <span key={i} className="bg-foreground" style={{ width: w * 2 }} />
          ))}
        </div>
      </Card>
    </div>
  );
}
