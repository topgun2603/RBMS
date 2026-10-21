"use client";

import * as React from "react";
import { BanIcon, CalendarClockIcon, CheckCircle2Icon, CircleSlashIcon, ClockIcon, GiftIcon, LayersIcon, PackageIcon, PlusIcon, SparklesIcon, TagIcon } from "lucide-react";
import { Button, ChipGroup, EmptyState, Skeleton, StatusPill, Switch, toast, type StatusTone } from "@srirealtime/ui";
import { describeError, ModuleLink, Page, PageHeading, QueryError, useI18n } from "@srirealtime/web";
import { PERMS, usePermissions } from "../lib/access";
import { couponWindow, type CouponState } from "../lib/coupons";
import { offerState, offerSummary } from "../lib/offers";
import { useOffers, useToggleOffer } from "../lib/queries";
import { OFFER_KINDS, type Offer, type OfferKind } from "../lib/types";

const STATE_META: Record<CouponState, { tone: StatusTone; icon: React.ComponentType<{ className?: string }> }> = {
  active: { tone: "success", icon: CheckCircle2Icon },
  scheduled: { tone: "info", icon: CalendarClockIcon },
  expired: { tone: "neutral", icon: ClockIcon },
  used_up: { tone: "warning", icon: CircleSlashIcon },
  off: { tone: "neutral", icon: BanIcon },
};

export const KIND_ICON: Record<OfferKind, React.ComponentType<{ className?: string }>> = {
  bxgy: TagIcon,
  tiered: LayersIcon,
  free_gift: GiftIcon,
  bundle: PackageIcon,
};

export function OfferStatePill({ offer }: { offer: Offer }) {
  const { t } = useI18n();
  const s = offerState(offer);
  const m = STATE_META[s];
  return (
    <StatusPill tone={m.tone} icon={m.icon}>
      {t(`orders.coupons.state.${s}`)}
    </StatusPill>
  );
}

/** Automatic offers (buy X get Y, tiers, free gifts) and combos: the shop applies them without a code. */
export default function OffersPage() {
  const { t, formatDate } = useI18n();
  const { can } = usePermissions();
  const canManage = can(PERMS.coupons);
  const [kind, setKind] = React.useState<OfferKind | "all">("all");
  const list = useOffers(kind);
  const toggle = useToggleOffer();
  const day = (d: string) => formatDate(d, { day: "numeric", month: "short", year: "numeric" });
  const windowText = (o: Offer) => {
    const w = couponWindow(o);
    if (w.from && w.to) return `${day(w.from)} – ${day(w.to)}`;
    if (w.to) return t("orders.coupons.until", { date: day(w.to) });
    if (w.from) return t("orders.coupons.from", { date: day(w.from) });
    return t("orders.coupons.always");
  };

  const actions = canManage && (
    <>
      <Button asChild size="lg" variant="outline">
        <ModuleLink to="offers/new/bundle">
          <PackageIcon /> {t("orders.offers.addBundle")}
        </ModuleLink>
      </Button>
      <Button asChild size="lg">
        <ModuleLink to="offers/new">
          <PlusIcon /> {t("orders.offers.add")}
        </ModuleLink>
      </Button>
    </>
  );

  const items = list.data?.items ?? [];
  return (
    <Page>
      <PageHeading icon={SparklesIcon} title={t("orders.offers.title")} description={t("orders.offers.subtitle")} actions={actions} />
      <ChipGroup<OfferKind | "all">
        size="sm"
        aria-label={t("orders.offers.filterKind")}
        value={kind}
        onChange={setKind}
        options={[{ value: "all", label: t("orders.list.all") }, ...OFFER_KINDS.map((k) => ({ value: k, label: t(`orders.offers.kind.${k}`) }))]}
        className="mb-4"
      />
      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={SparklesIcon}
          title={t(kind === "bundle" ? "orders.offers.emptyBundles" : "orders.offers.emptyTitle")}
          description={t("orders.offers.emptyBody")}
          action={actions || undefined}
        />
      ) : (
        <ul className="grid gap-3" data-testid="offer-list">
          {items.map((o) => {
            const Icon = KIND_ICON[o.kind];
            return (
              <li key={o.id} className="flex items-center gap-3 rounded-2xl border border-card-ring bg-card p-3 shadow-elevated sm:gap-4 sm:p-4">
                <span className="icon-chip size-10 shrink-0 rounded-xl text-primary">
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <ModuleLink to={`offers/${o.id}`} className="truncate font-semibold outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                      {o.name}
                    </ModuleLink>
                    <OfferStatePill offer={o} />
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{offerSummary(t, o)}</p>
                  <p className="text-meta text-muted-foreground">
                    {[t(`orders.offers.kind.${o.kind}`), windowText(o), o.usageLimit ? t("orders.coupons.usedOf", { used: o.usedCount, limit: o.usageLimit }) : t("orders.coupons.used", { used: o.usedCount })].join(" · ")}
                  </p>
                </div>
                <Switch
                  checked={o.active}
                  disabled={!canManage}
                  aria-label={t("orders.offers.toggle", { name: o.name })}
                  onCheckedChange={async (on) => {
                    try {
                      await toggle.mutateAsync({ id: o.id, active: on });
                      toast.success(t(on ? "orders.offers.turnedOn" : "orders.offers.turnedOff", { name: o.name }));
                    } catch (err) {
                      toast.error(describeError(err, t));
                    }
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
