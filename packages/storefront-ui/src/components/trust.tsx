import * as React from "react";
import { BadgeCheckIcon, BanknoteIcon, ClockIcon, GiftIcon, HeartIcon, LeafIcon, MapPinnedIcon, PhoneIcon, ShieldCheckIcon, StarIcon, TagIcon, TruckIcon, Undo2Icon } from "lucide-react";
import { cn } from "@srirealtime/ui/lib/utils";
import { paymentMarks, trustItems, type TrustIcon } from "../lib/trust";
import type { StoreConfig } from "../types";

type T = (key: string, vars?: Record<string, string | number | null | undefined>) => string;

const ICONS: Record<TrustIcon, React.ComponentType<{ className?: string }>> = {
  truck: TruckIcon,
  cash: BanknoteIcon,
  return: Undo2Icon,
  shield: ShieldCheckIcon,
  star: StarIcon,
  gift: GiftIcon,
  phone: PhoneIcon,
  leaf: LeafIcon,
  clock: ClockIcon,
  tag: TagIcon,
  heart: HeartIcon,
  check: BadgeCheckIcon,
  pin: MapPinnedIcon,
};

/**
 * Trust badges: only the claims the shop can back up (lib/trust.ts: the owner's own badges, or the trade's promise,
 * how shoppers pay, COD, how returns work, made locally). Laid out by the width they get (`.sf-trust-box` container
 * queries, styles.css): all in a row under a wide hero, two per row in a narrow buy column, one per row when narrower.
 */
export function TrustBadges({
  t,
  config,
  locale,
  className,
  compact,
}: {
  t: T;
  config: Pick<StoreConfig, "codEnabled" | "policies" | "trust"> & { shop: Pick<StoreConfig["shop"], "businessType"> };
  locale: string;
  className?: string;
  compact?: boolean;
}) {
  const items = trustItems(config, t, locale);
  if (!items.length) return null;
  return (
    // The box is the container the grid's column count is measured against.
    <div className={cn("sf-trust-box", className)}>
      <ul className="sf-trust" style={{ "--n": items.length } as React.CSSProperties} data-compact={compact ? "" : undefined} data-testid="trust-badges">
        {items.map((x) => {
          const Icon = ICONS[x.icon] ?? BadgeCheckIcon;
          return (
            <li key={x.key} data-trust={x.key} className={cn("flex min-w-0 items-center gap-3 rounded-[calc(var(--sf-radius-card)*8/9)] bg-tint-1 ring-1 ring-primary/10", compact ? "px-3 py-2.5" : "p-4")}>
              <span className={cn("icon-chip shrink-0 text-primary", compact ? "size-8" : "size-10")}>
                <Icon className={compact ? "size-4" : "size-5"} />
              </span>
              {/* Words break only between words; overflow-wrap is the last resort for one Tamil word wider than the cell. */}
              <span className="min-w-0 break-normal [overflow-wrap:break-word] [hyphens:manual]">
                <span className={cn("block leading-tight font-semibold", compact ? "text-xs" : "text-sm")}>{x.title}</span>
                {!compact && x.text && <span className="mt-0.5 block text-xs text-muted-foreground">{x.text}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* Payment marks drawn as simple wordmark chips (no third-party logos/trademarks are embedded). */
const chip = "inline-flex h-7 items-center gap-1 rounded-md border bg-card px-2 text-[10px] font-extrabold tracking-wide text-foreground/75 shadow-xs";

/** Payment marks: UPI, cards and net banking for online checkout; UPI, cards and cash for shops paid at the visit; COD when on. */
export function PaymentIcons({
  t,
  cod,
  config,
  className,
}: {
  t: T;
  cod: boolean;
  /** The shop's settings: the marks follow how it is paid (lib/trust.ts paymentMarks). */ config?: Parameters<typeof paymentMarks>[0];
  className?: string;
}) {
  const marks = config ? paymentMarks(config) : { upi: true, cards: true, netbanking: true, cash: false, cod };
  const showCod = cod && marks.cod;
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
      {marks.netbanking && (
        <li className={chip}>
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
            <path d="M1 6 8 2l7 4v1H1Z" fill="currentColor" opacity=".6" />
            <path d="M3 8v5M6.5 8v5M9.5 8v5M13 8v5M1 14h14" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          {t("trust.netbanking")}
        </li>
      )}
      {marks.cash && (
        <li className={chip}>
          <BanknoteIcon className="size-3.5" aria-hidden />
          {t("trust.cash")}
        </li>
      )}
      {showCod && (
        <li className={chip}>
          <BanknoteIcon className="size-3.5" aria-hidden />
          COD
        </li>
      )}
    </ul>
  );
}
