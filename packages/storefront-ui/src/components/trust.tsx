import * as React from "react";
import { BanknoteIcon, MapPinnedIcon, ShieldCheckIcon, Undo2Icon } from "lucide-react";
import { cn } from "@srirealtime/ui/lib/utils";

type T = (key: string, vars?: Record<string, string | number | null | undefined>) => string;

/** Secure payment · COD · easy returns · made in Tamil Nadu: only the claims the shop's settings and trade back up. */
export function TrustBadges({ t, cod, returns, local = false, className, compact }: { t: T; cod: boolean; returns: boolean; /** "Made in Tamil Nadu": only for trades that make things locally (the business pack's `localMade`). */ local?: boolean; className?: string; compact?: boolean }) {
  const items = [
    { icon: ShieldCheckIcon, title: t("trust.secure"), text: t("trust.secureText"), show: true },
    { icon: BanknoteIcon, title: t("trust.cod"), text: t("trust.codText"), show: cod },
    { icon: Undo2Icon, title: t("trust.returns"), text: t("trust.returnsText"), show: returns },
    { icon: MapPinnedIcon, title: t("trust.local"), text: t("trust.localText"), show: local },
  ].filter((x) => x.show);
  return (
    <ul className={cn("grid gap-2", compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 lg:grid-cols-4 sm:gap-3", className)}>
      {items.map((x) => (
        <li key={x.title} className={cn("flex items-center gap-3 rounded-2xl bg-tint-1 ring-1 ring-primary/10", compact ? "px-3 py-2.5" : "p-4")}>
          <span className={cn("icon-chip text-primary", compact ? "size-8" : "size-10")}>
            <x.icon className={compact ? "size-4" : "size-5"} />
          </span>
          <span className="min-w-0">
            <span className={cn("block leading-tight font-semibold", compact ? "text-xs" : "text-sm")}>{x.title}</span>
            {!compact && <span className="mt-0.5 block text-xs text-muted-foreground">{x.text}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* Payment marks drawn as simple wordmark chips (no third-party logos/trademarks are embedded). */
const chip = "inline-flex h-7 items-center gap-1 rounded-md border bg-card px-2 text-[10px] font-extrabold tracking-wide text-foreground/75 shadow-xs";

export function PaymentIcons({ t, cod, className }: { t: T; cod: boolean; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-1.5", className)} aria-label={t("trust.payWith")}>
      <li className={chip}>
        <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
          <path d="M8 1 14 8 8 15 2 8Z" fill="currentColor" opacity=".25" />
          <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        UPI
      </li>
      <li className={chip}>
        <svg viewBox="0 0 20 14" className="h-3 w-4" aria-hidden>
          <rect width="20" height="14" rx="2" fill="currentColor" opacity=".2" />
          <rect y="3" width="20" height="3" fill="currentColor" opacity=".6" />
        </svg>
        {t("trust.cards")}
      </li>
      <li className={chip}>
        <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
          <path d="M1 6 8 2l7 4v1H1Z" fill="currentColor" opacity=".6" />
          <path d="M3 8v5M6.5 8v5M9.5 8v5M13 8v5M1 14h14" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        {t("trust.netbanking")}
      </li>
      {cod && (
        <li className={chip}>
          <BanknoteIcon className="size-3.5" aria-hidden />
          COD
        </li>
      )}
    </ul>
  );
}
