"use client";

import * as React from "react";
import { AlertTriangleIcon, BikeIcon, CheckIcon, ChefHatIcon, Loader2Icon, PackageCheckIcon, RefreshCwIcon, SettingsIcon, XIcon } from "lucide-react";
import { Button, ChipGroup, cn, EmptyState, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, StatusPill, toast, type StatusTone } from "@srirealtime/ui";
import { describeError, ModuleLink, Page, PageHeading, useI18n, usePermission, useSettingsHref } from "@srirealtime/web";
import { InlineError, ReasonDialog } from "../components/bits";
import { DueChip, PlatformBadge } from "../components/platform";
import { RESTAURANT_PERMISSIONS } from "../lib/access";
import { elapsed, minutesSince, money, qty } from "../lib/format";
import { useOnlineActions, useOnlineOrders, type OnlineOrder, type OnlineStatus } from "../lib/online";

const PREP_CHOICES = [10, 15, 20, 25, 30, 45, 60];

const STATUS_TONE: Record<OnlineStatus, StatusTone> = {
  placed: "info",
  accepted: "warning",
  ready: "success",
  dispatched: "neutral",
  completed: "neutral",
  rejected: "danger",
  cancelled: "danger",
};

/**
 * Online orders: Zomato / Swiggy / ONDC orders from the aggregator. New ones wait here for Accept (with a prep time)
 * or Reject (with a reason); accepted ones are cooking (tickets on the kitchen display), then Ready and Handed to
 * rider. Every step is reported to the platform; a failed report can be re-sent.
 */
export default function OnlineOrdersPage() {
  const { t } = useI18n();
  const settingsHref = useSettingsHref();
  const canSetup = usePermission(RESTAURANT_PERMISSIONS.manage);
  const [tab, setTab] = React.useState<"active" | "done">("active");
  const orders = useOnlineOrders(tab);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const list = orders.data?.items ?? [];
  const waiting = list.filter((o) => o.status === "placed").length;

  return (
    <Page width="full">
      <PageHeading
        title={t("restaurant.online.title")}
        description={tab === "active" ? t("restaurant.online.summary", { count: waiting }) : undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <ModuleLink to="kitchen">
                <ChefHatIcon /> {t("restaurant.nav.kitchen")}
              </ModuleLink>
            </Button>
            {canSetup && (
              <Button variant="outline" asChild>
                <a href={settingsHref("online-platforms")}>
                  <SettingsIcon /> {t("restaurant.online.settings")}
                </a>
              </Button>
            )}
          </div>
        }
      />
      <ChipGroup
        aria-label={t("restaurant.online.title")}
        value={tab}
        onChange={(v) => setTab(v as "active" | "done")}
        options={[
          { value: "active", label: t("restaurant.online.tab.active") },
          { value: "done", label: t("restaurant.online.tab.done") },
        ]}
      />
      {orders.isError && <InlineError title={describeError(orders.error, t)} />}
      {orders.isPending ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={BikeIcon} title={t(tab === "active" ? "restaurant.online.emptyTitle" : "restaurant.online.emptyDone")} description={tab === "active" ? t("restaurant.online.emptyBody") : undefined} />
      ) : (
        <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((o) => (
            <OnlineCard key={o.id} order={o} now={now} />
          ))}
        </div>
      )}
    </Page>
  );
}

function OnlineCard({ order: o, now }: { order: OnlineOrder; now: number }) {
  const { t } = useI18n();
  const a = useOnlineActions();
  const [prep, setPrep] = React.useState("20");
  const [rejecting, setRejecting] = React.useState(false);
  const busy = Object.values(a).some((m) => m.isPending && (m.variables === o.id || (m.variables as { id?: string } | undefined)?.id === o.id));
  const run = async (p: Promise<unknown>, ok?: string) => {
    try {
      await p;
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const failed = o.lastCallback && !o.lastCallback.ok;
  const due = o.status === "accepted" || o.status === "placed" ? (o.acceptedAt && o.prepMinutes ? new Date(Date.parse(o.acceptedAt) + o.prepMinutes * 60_000).toISOString() : o.expectedPickupAt) : null;

  return (
    <article className={cn("grid gap-3 rounded-xl border-2 bg-card p-4 shadow-sm", o.status === "placed" ? "border-primary" : "border-transparent")}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <span className="flex flex-wrap items-center gap-2 text-lg font-bold">
            <PlatformBadge platform={o.platform} />
            {o.platformOrderId ? `#${o.platformOrderId}` : t(`restaurant.online.type.${o.type}`)}
            {o.test && <StatusPill tone="warning">{t("restaurant.online.test")}</StatusPill>}
          </span>
          <span className="text-meta text-muted-foreground">
            {[o.kitchenNumber ? t("restaurant.online.kitchenNo", { number: o.kitchenNumber }) : null, t(`restaurant.online.type.${o.type}`), o.order.customer.name, elapsed(minutesSince(o.placedAt, now))]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        <span className="flex flex-col items-end gap-1">
          <StatusPill tone={STATUS_TONE[o.status]}>{t(`restaurant.online.status.${o.status}`)}</StatusPill>
          <DueChip dueAt={due} now={now} />
        </span>
      </header>

      <ul className="grid gap-1">
        {o.lines.map((l, i) => (
          <li key={`${l.externalId}-${i}`} className="text-sm leading-snug">
            <span className="font-semibold tabular-nums">{qty(l.qty)}×</span> {l.title}
            {!l.itemId && (
              <span className="ml-1 inline-flex items-center gap-1 rounded bg-warning/15 px-1 text-xs font-medium text-warning">
                <AlertTriangleIcon className="size-3" /> {t("restaurant.online.unmapped")}
              </span>
            )}
            {l.note && <span className="block pl-6 text-meta text-muted-foreground">↳ {l.note}</span>}
          </li>
        ))}
      </ul>
      {o.order.instructions && <p className="rounded bg-muted px-2 py-1 text-sm">{o.order.instructions}</p>}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-meta">
        <dt className="text-muted-foreground">{t("restaurant.online.total")}</dt>
        <dd className="text-right font-semibold tabular-nums">{money(o.total)}</dd>
        <dt className="text-muted-foreground">{t("restaurant.online.payment")}</dt>
        <dd className={cn("text-right font-medium", o.payment === "cod" && "text-warning")}>{t(`restaurant.online.pay.${o.payment}`)}</dd>
        {o.rider?.name && (
          <>
            <dt className="text-muted-foreground">{t("restaurant.online.rider")}</dt>
            <dd className="text-right">{[o.rider.name, o.rider.status].filter(Boolean).join(" · ")}</dd>
          </>
        )}
      </dl>
      <p className="text-xs text-muted-foreground">{o.taxMode === "eco_9_5" ? t("restaurant.online.gst95", { gst: money(o.gst) }) : t("restaurant.online.gstOwn")}</p>
      {o.reason && <p className="text-meta text-destructive">{o.reason}</p>}
      {o.kitchenError && (
        <div className="flex items-center justify-between gap-2 rounded bg-destructive/10 px-2 py-1 text-meta text-destructive">
          {t("restaurant.online.kitchenError")}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(a.retryKitchen.mutateAsync(o.id))}>
            <RefreshCwIcon /> {t("restaurant.online.retry")}
          </Button>
        </div>
      )}
      {failed && (
        <div className="flex items-center justify-between gap-2 rounded bg-warning/10 px-2 py-1 text-meta text-warning">
          <span>{t("restaurant.online.reportFailed", { error: o.lastCallback?.error ?? "" })}</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(a.resync.mutateAsync(o.id), t("restaurant.online.resent"))}>
            <RefreshCwIcon /> {t("restaurant.online.resend")}
          </Button>
        </div>
      )}

      <footer className="flex flex-wrap gap-2">
        {o.status === "placed" && (
          <>
            <Select value={prep} onValueChange={setPrep}>
              <SelectTrigger className="h-10 w-28" aria-label={t("restaurant.online.prepTime")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PREP_CHOICES.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {t("restaurant.online.minutes", { min: m })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="lg" className="flex-1" disabled={busy} onClick={() => run(a.accept.mutateAsync({ id: o.id, prepMinutes: Number(prep) }), t("restaurant.online.accepted"))}>
              {busy ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} {t("restaurant.online.accept")}
            </Button>
          </>
        )}
        {o.status === "accepted" && (
          <Button size="lg" className="flex-1" disabled={busy} onClick={() => run(a.ready.mutateAsync(o.id))}>
            <PackageCheckIcon /> {t("restaurant.online.markReady")}
          </Button>
        )}
        {(o.status === "accepted" || o.status === "ready") && (
          <Button size="lg" variant={o.status === "ready" ? "default" : "outline"} className={cn(o.status === "ready" && "flex-1")} disabled={busy} onClick={() => run(a.dispatched.mutateAsync(o.id))}>
            <BikeIcon /> {t("restaurant.online.handedOver")}
          </Button>
        )}
        {(o.status === "placed" || o.status === "accepted") && (
          <Button size="lg" variant="outline" className="text-destructive" disabled={busy} onClick={() => setRejecting(true)}>
            <XIcon /> {t("restaurant.online.reject")}
          </Button>
        )}
        {o.diningOrderId && (
          <Button size="lg" variant="ghost" asChild>
            <ModuleLink to={`orders/${o.diningOrderId}`}>{t("restaurant.online.openOrder")}</ModuleLink>
          </Button>
        )}
      </footer>
      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={t("restaurant.online.rejectTitle")}
        description={t("restaurant.online.rejectBody")}
        confirm={t("restaurant.online.reject")}
        onConfirm={(reason) => a.reject.mutateAsync({ id: o.id, reason })}
      />
    </article>
  );
}
