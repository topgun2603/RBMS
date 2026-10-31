import * as React from "react";
import { GiftIcon, SparklesIcon, TagIcon } from "lucide-react";
import { cn } from "@rbms/ui/lib/utils";
import { formatDate } from "../lib/format";
import { offerText } from "../lib/offers";
import type { OfferBadge } from "../types";

type T = (key: string, vars?: Record<string, string | number>) => string;

const ICON: Record<string, React.ComponentType<{ className?: string }>> = { bxgy: TagIcon, tiered: SparklesIcon, free_gift: GiftIcon };

/**
 * The live offers on a product ("Buy 2 get 1 free", "Spend ₹999 get a free gift") as a list of pills next to the buy
 * box. Server-rendered (crawlable); the cart works the discount out.
 */
export function OfferBadgeList({ offers, t, locale, className }: { offers: OfferBadge[]; t: T; locale: string; className?: string }) {
  if (!offers.length) return null;
  return (
    <section aria-label={t("offer.badgesTitle")} className={cn("grid gap-2", className)} data-testid="offer-badges">
      <h2 className="sr-only">{t("offer.badgesTitle")}</h2>
      <ul className="flex flex-wrap gap-2">
        {offers.map((o) => {
          const Icon = ICON[o.kind] ?? TagIcon;
          const cheapest = o.kind === "bxgy";
          return (
            <li
              key={o.id}
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-dashed border-primary/45 bg-primary/6 py-1.5 ps-2 pe-3 text-sm"
              title={o.description ?? (cheapest ? t("offer.cheapestFree") : undefined)}
            >
              <span className="icon-chip size-6 shrink-0 text-primary">
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="font-semibold">{offerText(t, o)}</span>
                {o.endsAt && <span className="ms-1.5 text-xs text-muted-foreground">· {t("offer.endsOn", { date: formatDate(o.endsAt, locale, { day: "numeric", month: "short" }) })}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
