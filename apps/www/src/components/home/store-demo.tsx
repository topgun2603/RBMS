"use client";

import * as React from "react";
import { BellRingIcon, CheckCircle2Icon, ShoppingBagIcon, SmartphoneIcon, TruckIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotionSafe } from "@rbms/ui/motion";
import { useSite } from "../site-context";
import { billMoney, itemOf, SALE_ITEMS, totalsOf, useSale, type SaleLine } from "./sale";

type PayWay = "upi" | "cod";

/** A shopper's phone: browse, add, pay. The order lands in the shop against the same stock the counter sells from. */
export function StoreDemo({ active, onTouch, stopped }: { active: boolean; onTouch: () => void; stopped: boolean }) {
  const { t, locale } = useSite();
  const sale = useSale();
  const reduced = useReducedMotionSafe();
  const lang = locale === "ta" ? "ta" : "en";
  const [cart, setCart] = React.useState<SaleLine[]>([]);
  const [paid, setPaid] = React.useState<PayWay | null>(null);
  const [orderNo, setOrderNo] = React.useState(214);

  const add = React.useCallback((id: string) => setCart((c) => (c.some((l) => l.id === id) ? c.map((l) => (l.id === id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { id, qty: 1 }])), []);
  const touch = (fn: () => void) => {
    onTouch();
    fn();
  };

  // When the page first turns to this tab: one shopper fills a cart and pays. Stops the moment the visitor touches anything.
  const played = React.useRef(false);
  React.useEffect(() => {
    if (!active || reduced || stopped || played.current) return;
    played.current = true;
    const timers = [window.setTimeout(() => add("oil"), 700), window.setTimeout(() => add("cola"), 1500), window.setTimeout(() => setPaid("upi"), 2800)];
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [active, reduced, stopped, add]);

  const totals = totalsOf(cart);
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const counterQty = (id: string) => sale.lines.find((l) => l.id === id)?.qty ?? 0;

  return (
    <div className="mx-auto w-full max-w-[30rem]" data-testid="store-demo">
      <div className="mx-auto w-full max-w-[21rem] rounded-[2.25rem] bg-ink p-2.5 shadow-[0_30px_60px_-24px_oklch(0.2_0.03_50/0.65)]">
        <div className="overflow-hidden rounded-[1.75rem] bg-white text-[oklch(0.2_0.02_60)]">
          <div className="flex items-center justify-between gap-2 bg-kungumam px-4 py-3 text-white">
            <span className="text-sm font-bold" lang={lang}>{t("home.counter.waFrom")}</span>
            <span className="relative flex items-center [&_svg]:size-5" aria-label={t("home.store.cart", { n: count })}>
              <ShoppingBagIcon aria-hidden="true" />
              {count > 0 && <span className="absolute -top-1.5 -right-2 flex size-4 items-center justify-center rounded-full bg-turmeric text-[10px] font-bold text-ink" data-testid="store-cart-count">{count}</span>}
            </span>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {paid ? (
              <motion.div key="done" initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex min-h-[21.5rem] flex-col items-center justify-center gap-2 p-5 text-center" data-testid="store-order">
                <CheckCircle2Icon className="size-12 text-[#16a34a]" aria-hidden="true" />
                <p className="text-lg font-bold">{t("home.store.placed")}</p>
                <p className="font-mono text-xs">ORD-{orderNo} · {billMoney(totals.total)}</p>
                <p className="text-xs opacity-70">{t(paid === "upi" ? "home.store.paidUpi" : "home.store.paidCod")}</p>
                <button
                  type="button"
                  className="mt-3 min-h-9 rounded-full border-[1.5px] border-current px-4 text-xs font-bold focus-ring"
                  onClick={() =>
                    touch(() => {
                      setPaid(null);
                      setCart([]);
                      setOrderNo((n) => n + 1);
                    })
                  }
                  data-testid="store-again"
                >
                  {t("home.store.again")}
                </button>
              </motion.div>
            ) : (
              <motion.div key="shop" initial={false} exit={{ opacity: 0 }} className="p-3">
                <div className="grid grid-cols-2 gap-2">
                  {SALE_ITEMS.map((item) => (
                    <button key={item.id} type="button" onClick={() => touch(() => add(item.id))} className="flex min-h-[4.75rem] flex-col justify-between rounded-xl border border-black/10 p-2.5 text-left transition-colors hover:border-kungumam focus-ring" data-testid={`store-item-${item.id}`}>
                      <span className="text-xs leading-snug font-semibold" lang={lang}>{item[lang]}</span>
                      <span className="mt-1 flex items-center justify-between font-mono text-[11px]">
                        {billMoney(item.price).replace(".00", "")}
                        <span className="rounded-full bg-kungumam px-1.5 font-sans text-[10px] font-bold text-white">{t("home.store.add")}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <p className="mt-3 flex items-baseline justify-between text-sm font-bold">
                  <span>{t("home.store.total")}</span>
                  <span className="font-mono" data-testid="store-total">{billMoney(totals.total)}</span>
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" disabled={!count} onClick={() => touch(() => setPaid("upi"))} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-kungumam text-xs font-bold text-white focus-ring disabled:opacity-40 [&_svg]:size-4" data-testid="store-pay-upi">
                    <SmartphoneIcon aria-hidden="true" />
                    {t("home.store.upi")}
                  </button>
                  <button type="button" disabled={!count} onClick={() => touch(() => setPaid("cod"))} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-ink text-xs font-bold text-white focus-ring disabled:opacity-40 [&_svg]:size-4" data-testid="store-pay-cod">
                    <TruckIcon aria-hidden="true" />
                    {t("home.store.cod")}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {paid && (
          <motion.div initial={reduced ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: reduced ? 0 : 0.4 }} className="mt-4 rounded-2xl bg-ink p-4 text-sm text-paper" data-testid="store-shop-side" aria-live="polite">
            <p className="flex items-center gap-2 font-bold [&_svg]:size-4 [&_svg]:text-turmeric">
              <BellRingIcon aria-hidden="true" />
              {t("home.store.inShop", { no: orderNo })}
            </p>
            <ul className="mt-2 grid gap-1 font-mono text-xs">
              {cart.map((l) => {
                const before = itemOf(l.id).stock - counterQty(l.id);
                return (
                  <li key={l.id} className="flex justify-between gap-3" data-testid={`store-stock-${l.id}`}>
                    <span className="font-sans" lang={lang}>{itemOf(l.id)[lang]}</span>
                    <span>
                      <span className="line-through opacity-60">{before}</span> → <b>{before - l.qty}</b>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-paper/75">{t("home.store.same")}</p>
          </motion.div>
        )}
      </AnimatePresence>
      <p className="mt-3 text-xs text-muted-foreground">{t("home.store.note")}</p>
    </div>
  );
}
