"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircleIcon, ArrowDownLeftIcon, ArrowUpRightIcon, ClockIcon, CrownIcon, GiftIcon, InfoIcon, SparklesIcon } from "lucide-react";
import { Button } from "@rbms/ui/components/button";
import { Progress } from "@rbms/ui/components/progress";
import { Switch } from "@rbms/ui/components/switch";
import { cn } from "@rbms/ui/lib/utils";
import { AnimatedNumber, AnimatePresence, motion, useReducedMotionSafe } from "@rbms/ui/motion";
import { clampPoints, pointsValue, signedPoints, tierProgress } from "../lib/loyalty";
import { formatDate, money } from "../lib/format";
import type { LoyaltyEntry, LoyaltyMe, LoyaltyQuote } from "../types";
import { Empty } from "../components/bits";
import { call, errorMessage } from "./api";
import { NoticeLine } from "./privacy";
import { useStore } from "./store-context";

// ------------------------------------------------------------------ account: balance, tier, history

export function LoyaltyPanel() {
  const { t, locale } = useStore();
  const reduced = useReducedMotionSafe();
  const q = useQuery({ queryKey: ["loyalty", "me"], queryFn: () => call<LoyaltyMe>("/loyalty/me") });
  if (q.isLoading)
    return (
      <div className="grid gap-4" aria-busy>
        <div className="sf-shimmer h-44 rounded-3xl" />
        <div className="sf-shimmer h-16 rounded-2xl" />
        <div className="sf-shimmer h-16 rounded-2xl" />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <Empty
        icon={<AlertCircleIcon />}
        title={errorMessage(q.error, t)}
        action={
          <Button variant="outline" className="rounded-full" onClick={() => void q.refetch()}>
            {t("common.retry")}
          </Button>
        }
      />
    );
  const me = q.data;
  const m = me.member;
  if (!me.enrolled || !m)
    return (
      <div className="grid gap-4">
        <Empty icon={<GiftIcon />} title={t("loyalty.notEnrolled")} body={t("loyalty.notEnrolledBody")} />
        <NoticeLine />
      </div>
    );
  const pct = tierProgress(me);
  return (
    <div className="grid gap-6" data-testid="loyalty-panel">
      <motion.section
        initial={reduced ? false : { opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative overflow-hidden rounded-3xl bg-[image:var(--sf-gradient)] p-6 text-primary-foreground shadow-lg shadow-primary/25 sm:p-8"
        aria-label={t("loyalty.balance")}
      >
        <span aria-hidden className="absolute -top-16 -right-16 size-56 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-primary-foreground/80">{t("loyalty.balance")}</p>
            <p className="mt-1 font-display text-5xl font-semibold tabular-nums" data-testid="loyalty-balance">
              <AnimatedNumber value={m.pointsBalance} format={(n) => Math.round(n).toLocaleString("en-IN")} />
            </p>
            <p className="mt-1 text-sm text-primary-foreground/85">{t("loyalty.worth", { amount: money(m.pointsValue) })}</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-sm font-semibold backdrop-blur">
            <CrownIcon className="size-4" />
            {t("loyalty.tier", { tier: m.tier })}
          </span>
        </div>
        <div className="relative mt-6 grid gap-2">
          <Progress value={pct} className="h-2.5 bg-white/25" indicatorClassName="bg-white" aria-label={me.nextTier ? t("loyalty.nextTier", { amount: money(me.nextTier.spendNeeded), tier: me.nextTier.tier.name }) : t("loyalty.topTier")} />
          <p className="flex flex-wrap justify-between gap-2 text-xs text-primary-foreground/85">
            <span>{me.nextTier ? t("loyalty.nextTier", { amount: money(me.nextTier.spendNeeded), tier: me.nextTier.tier.name }) : t("loyalty.topTier")}</span>
            <span>{t("loyalty.lifetime", { amount: money(m.lifetimeSpend) })}</span>
          </p>
        </div>
      </motion.section>
      <NoticeLine className="text-xs text-muted-foreground" />

      {me.expiringSoon.length > 0 && (
        <ul className="grid gap-2">
          {me.expiringSoon.map((e) => (
            <li key={e.expiresAt} className="flex items-center gap-2 rounded-2xl bg-warning/12 px-4 py-2.5 text-sm text-warning-ink">
              <ClockIcon className="size-4" />
              {t("loyalty.expiring", { points: e.points, date: formatDate(e.expiresAt, locale) })}
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="loyalty-history">
        <h2 id="loyalty-history" className="mb-3 font-display text-h3 font-semibold">
          {t("loyalty.history")}
        </h2>
        {me.history.length ? (
          <ul className="divide-y rounded-2xl border bg-card" data-testid="loyalty-history">
            {me.history.map((e, i) => (
              <HistoryRow key={e.id} e={e} i={i} />
            ))}
          </ul>
        ) : (
          <Empty icon={<SparklesIcon />} title={t("loyalty.noHistory")} body={t("loyalty.noHistoryBody")} />
        )}
      </section>
    </div>
  );
}

function HistoryRow({ e, i }: { e: LoyaltyEntry; i: number }) {
  const { t, locale } = useStore();
  const plus = e.points > 0;
  return (
    <motion.li initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0, transition: { delay: Math.min(i, 10) * 0.03 } }} className="flex items-center gap-3 px-4 py-3">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", plus ? "bg-success/15 text-success-ink" : "bg-muted text-muted-foreground")}>
        {plus ? <ArrowDownLeftIcon className="size-4" /> : <ArrowUpRightIcon className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">
          {t(`loyalty.type.${e.type}`)} · {t(`loyalty.ref.${e.refType}`)}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {formatDate(e.createdAt, locale, { dateStyle: "medium" })}
          {e.note ? ` · ${e.note}` : ""}
          {e.type === "earn" && e.expiresAt && e.remaining > 0 ? ` · ${t("loyalty.expiresOn", { date: formatDate(e.expiresAt, locale) })}` : ""}
        </span>
      </span>
      <span className={cn("font-semibold tabular-nums", plus ? "text-success-ink" : "text-foreground/80")}>{signedPoints(e.points)}</span>
    </motion.li>
  );
}

// ------------------------------------------------------------------ checkout: "Use points"

/**
 * Quotes the shopper's points for `amount` (goods after coupon, paise) and lets them apply the most they can.
 * `points` / `onChange` are owned by checkout, which sends `loyaltyPoints` with the order; the server redeems,
 * re-prices the lines (pre-tax discount, GST recomputed) and the order page shows its totals.
 */
export function UsePoints({ amount, points, onChange, disabled }: { amount: number; points: number; onChange(points: number, discount: number): void; disabled?: boolean }) {
  const { t } = useStore();
  const reduced = useReducedMotionSafe();
  // Debounce the amount so quantity / coupon changes don't fire a quote per keystroke.
  const [debounced, setDebounced] = React.useState(amount);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(amount), 350);
    return () => clearTimeout(id);
  }, [amount]);
  const q = useQuery({
    queryKey: ["loyalty", "quote", debounced],
    queryFn: () => call<LoyaltyQuote>("/loyalty/quote", { body: { amount: debounced } }),
    enabled: debounced > 0,
    staleTime: 15_000,
    retry: false,
  });
  const quote = q.data ?? null;

  // A smaller cart (or a lower balance) shrinks what can be used: keep the applied points within the quote.
  React.useEffect(() => {
    if (!quote || points === 0) return;
    const ok = clampPoints(points, quote);
    if (ok !== points) onChange(ok, pointsValue(ok, quote.pointValuePaise));
  }, [quote, points, onChange]);

  if (amount <= 0) return null;
  if (q.isLoading) return <div className="sf-shimmer h-16 rounded-2xl" aria-busy />;
  if (q.isError)
    return (
      <p className="flex items-start gap-2 rounded-2xl bg-muted px-3 py-2.5 text-xs text-muted-foreground" data-testid="points-error">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
        {errorMessage(q.error, t) || t("loyalty.quoteError")}
      </p>
    );
  if (!quote) return null;
  if (!quote.canRedeem) {
    if (quote.balance <= 0 && !quote.earnPreview) return null;
    return (
      <div className="grid gap-1 rounded-2xl border border-dashed px-3 py-2.5 text-xs text-muted-foreground" data-testid="points-unavailable">
        {quote.balance > 0 && (
          <p className="flex items-center gap-2">
            <GiftIcon className="size-3.5 text-primary" />
            {t("loyalty.useHint", { points: quote.balance, amount: money(pointsValue(quote.balance, quote.pointValuePaise)) })} · {quote.reason ? t(`loyalty.reason.${quote.reason}`, { min: quote.minRedeemPoints }) : ""}
          </p>
        )}
        {quote.earnPreview > 0 && <p className="flex items-center gap-2"><SparklesIcon className="size-3.5 text-primary" />{t("loyalty.earnPreview", { points: quote.earnPreview })}</p>}
      </div>
    );
  }
  const on = points > 0;
  const max = quote.maxPoints;
  const discount = pointsValue(on ? points : max, quote.pointValuePaise);
  return (
    <motion.div layout={reduced ? false : "position"} className={cn("grid gap-2 rounded-2xl border p-3 transition-colors", on ? "border-primary/40 bg-primary/5" : "bg-card")} data-testid="use-points">
      <label className="flex cursor-pointer items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <GiftIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{t("loyalty.use")}</span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={on ? "on" : "off"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="block text-xs text-muted-foreground">
              {on ? t("loyalty.applied", { points, amount: money(discount) }) : t("loyalty.useMax", { points: max, amount: money(discount) })}
            </motion.span>
          </AnimatePresence>
        </span>
        <Switch checked={on} disabled={disabled} onCheckedChange={(v) => onChange(v ? max : 0, v ? pointsValue(max, quote.pointValuePaise) : 0)} aria-label={t("loyalty.use")} data-testid="use-points-switch" />
      </label>
      <p className="text-[11px] leading-snug text-muted-foreground">{t("loyalty.useHint", { points: quote.balance, amount: money(pointsValue(quote.balance, quote.pointValuePaise)) })}</p>
      {on && <p className="text-[11px] leading-snug text-muted-foreground">{t("loyalty.taxNote")}</p>}
    </motion.div>
  );
}
