import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckIcon, ExternalLinkIcon, PackageIcon, PackageSearchIcon, TruckIcon, XIcon } from "lucide-react";
import { cn } from "@srirealtime/ui/lib/utils";
import { Reveal, RevealGroup, RevealItem } from "@srirealtime/ui/motion";
import { apiGetOrNull, getRequestInfo, requireStore } from "../server/api";
import { formatDate, money } from "../lib/format";
import type { Translator } from "../lib/messages";
import type { Tracking } from "../types";
import { Container, StatusChip, StoreImage } from "../components/bits";
import { PayNowButton, SuccessBurst, TrackLookup } from "../client/order-bits";
import { PurchaseTracker } from "../client/trackers";
import { ChatAboutOrder } from "../client/help-center";

const getTracking = (token: string) => (/^[A-Za-z0-9_-]{8,64}$/.test(token) ? apiGetOrNull<Tracking>(`/store/track/${encodeURIComponent(token)}`, { revalidate: 0 }) : Promise.resolve(null));

export async function orderMetadata(): Promise<Metadata> {
  const { t } = await getRequestInfo();
  return { title: t("order.thanks"), robots: { index: false, follow: false } };
}
export async function trackMetadata(): Promise<Metadata> {
  const { t } = await getRequestInfo();
  return { title: t("order.track"), robots: { index: false, follow: false } };
}

const FLOW = ["placed", "confirmed", "packed", "shipped", "delivered"] as const;

/** `/order/[accessToken]`: confirmation right after checkout (success animation, pay-now if unpaid). */
export async function OrderConfirmationPage({ accessToken }: { accessToken: string }) {
  const { t, locale } = await getRequestInfo();
  const o = await getTracking(accessToken);
  if (!o) notFound();
  const unpaid = o.paymentMethod === "online" && (o.paymentStatus === "unpaid" || o.paymentStatus === "pending") && o.status !== "cancelled";
  return (
    <Container className="max-w-3xl py-10 sm:py-14">
      {!unpaid && <PurchaseTracker orderNumber={o.number} value={o.totals.total} />}
      <div className="text-center" data-testid="order-confirmation">
        {unpaid ? (
          <span className="mx-auto flex size-20 items-center justify-center rounded-full bg-warning/15 text-warning-ink">
            <PackageIcon className="size-9" />
          </span>
        ) : (
          <SuccessBurst label={t("order.thanks")} />
        )}
        <h1 className="mt-6 font-display text-h1 font-semibold">{unpaid ? t("order.paymentPending") : t("order.thanks")}</h1>
        <p className="mt-2 text-muted-foreground">{t("order.placed", { number: o.number })}</p>
        {unpaid ? (
          <div className="mt-6">
            <PayNowButton accessToken={accessToken} amountLabel={money(o.totals.total)} />
          </div>
        ) : (
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">{t("order.confirmationNote")}</p>
        )}
      </div>
      <Reveal>
        <OrderDetails o={o} t={t} locale={locale} />
      </Reveal>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href={`/track/${accessToken}`} className="inline-flex h-11 items-center gap-2 rounded-full border px-6 text-sm font-semibold hover:bg-accent">
          <TruckIcon className="size-4" />
          {t("order.track")}
        </Link>
        <Link href="/products" className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          {t("order.continue")}
        </Link>
        <ChatAboutOrder order={{ number: o.number, status: o.status, total: o.totals.total, image: o.lines[0]?.image ?? null, itemCount: o.lines.reduce((n, l) => n + l.qty, 0) }} className="h-11 px-6" />
      </div>
    </Container>
  );
}

/** `/track/[accessToken]`: public tracking timeline. */
export async function TrackPage({ accessToken }: { accessToken: string }) {
  const { t, locale } = await getRequestInfo();
  const o = await getTracking(accessToken);
  if (!o) notFound();
  const unpaid = o.paymentMethod === "online" && (o.paymentStatus === "unpaid" || o.paymentStatus === "pending") && o.status !== "cancelled";
  return (
    <Container className="max-w-3xl py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{t("order.number")}</p>
          <h1 className="font-display text-h1 font-semibold" data-testid="track-number">
            {o.number}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("order.date")}: {formatDate(o.placedAt, locale, { dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
        <div className="flex gap-2">
          <StatusChip status={o.status} label={t(`order.status.${o.status}`)} />
          <StatusChip status={o.paymentStatus} label={t(`order.payment.${o.paymentStatus}`)} />
        </div>
      </div>
      {unpaid && (
        <div className="mt-6">
          <PayNowButton accessToken={accessToken} amountLabel={money(o.totals.total)} />
        </div>
      )}
      <Timeline o={o} t={t} locale={locale} />
      <OrderDetails o={o} t={t} locale={locale} />
      <div className="mt-6 flex justify-center">
        <ChatAboutOrder order={{ number: o.number, status: o.status, total: o.totals.total, image: o.lines[0]?.image ?? null, itemCount: o.lines.reduce((n, l) => n + l.qty, 0) }} />
      </div>
    </Container>
  );
}

export async function TrackLookupPage() {
  const { t } = await getRequestInfo();
  await requireStore();
  return (
    <Container className="max-w-xl py-16 text-center">
      <span className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <PackageSearchIcon className="size-8" />
      </span>
      <h1 className="mt-5 font-heading text-3xl font-bold tracking-tight">{t("order.lookupTitle")}</h1>
      <p className="mt-2 text-muted-foreground">{t("order.lookupHint")}</p>
      <div className="mt-8 text-left">
        <TrackLookup />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        <Link href="/account" className="font-semibold text-primary hover:underline">
          {t("order.signInForOrders")}
        </Link>
      </p>
    </Container>
  );
}

function Timeline({ o, t, locale }: { o: Tracking; t: Translator; locale: string }) {
  const cancelled = o.status === "cancelled" || o.status === "returned";
  const reached = FLOW.indexOf(o.status as (typeof FLOW)[number]);
  const at = (s: string) => o.timeline.find((e) => e.status === s)?.at ?? (s === "placed" ? o.placedAt : null);
  const steps = cancelled ? (["placed", o.status] as string[]) : [...FLOW];
  return (
    <section className="mt-8 rounded-3xl border bg-card p-6" aria-label={t("order.timeline")}>
      <h2 className="mb-6 font-heading text-lg font-semibold">{t("order.timeline")}</h2>
      <RevealGroup as="ol" stagger={0.12} className="relative grid gap-6 sm:grid-cols-5 sm:gap-2">
        {steps.map((s, i) => {
          const done = cancelled ? true : i <= reached;
          const current = cancelled ? i === steps.length - 1 : i === reached;
          const when = at(s);
          return (
            <RevealItem as="li" key={s} className="relative flex gap-4 sm:flex-col sm:items-center sm:gap-2 sm:text-center">
              {i < steps.length - 1 && <span aria-hidden className={cn("absolute top-9 left-[17px] h-[calc(100%-12px)] w-0.5 sm:top-[17px] sm:left-[calc(50%+22px)] sm:h-0.5 sm:w-[calc(100%-44px)]", done && (cancelled || i < reached) ? "bg-primary" : "bg-border")} />}
              <span
                className={cn(
                  "relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full border-2 bg-card",
                  done ? (s === "cancelled" || s === "returned" ? "border-destructive bg-destructive text-white" : "border-primary bg-primary text-primary-foreground") : "border-border text-muted-foreground",
                  current && !cancelled && "ring-4 ring-primary/20",
                )}
              >
                {s === "cancelled" ? <XIcon className="size-4" /> : done ? <CheckIcon className="size-4" /> : <span className="size-2 rounded-full bg-current" />}
              </span>
              <span>
                <span className={cn("block text-sm font-semibold", !done && "text-muted-foreground")}>{t(`order.status.${s}`)}</span>
                {when && done && <span className="block text-xs text-muted-foreground">{formatDate(when, locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>}
              </span>
            </RevealItem>
          );
        })}
      </RevealGroup>
      {o.cancelReason && <p className="mt-6 text-sm text-muted-foreground">{t("order.cancelReasonLabel", { reason: o.cancelReason })}</p>}
      {(o.fulfillment.trackingNumber || o.fulfillment.trackingUrl) && (
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-muted/60 p-4 text-sm">
          {o.fulfillment.carrier && (
            <span>
              <span className="text-muted-foreground">{t("order.carrier")}:</span> <span className="font-semibold">{o.fulfillment.carrier}</span>
            </span>
          )}
          {o.fulfillment.trackingNumber && (
            <span>
              <span className="text-muted-foreground">{t("order.trackingNumber")}:</span> <span className="font-mono font-semibold">{o.fulfillment.trackingNumber}</span>
            </span>
          )}
          {o.fulfillment.trackingUrl && /^https?:\/\//.test(o.fulfillment.trackingUrl) && (
            <a href={o.fulfillment.trackingUrl} target="_blank" rel="noopener noreferrer" className="ms-auto inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              {t("order.trackShipment")} <ExternalLinkIcon className="size-3.5" />
            </a>
          )}
        </div>
      )}
    </section>
  );
}

export function OrderDetails({ o, t, locale }: { o: Pick<Tracking, "lines" | "totals" | "paymentMethod" | "shipTo" | "placedAt" | "number">; t: Translator; locale: string }) {
  return (
    <section className="mt-8 overflow-hidden rounded-3xl border bg-card" aria-label={t("order.items")}>
      <div className="flex flex-wrap justify-between gap-2 border-b bg-muted/40 px-5 py-3 text-sm">
        <span>
          <span className="text-muted-foreground">{t("order.number")}:</span> <span className="font-semibold">{o.number}</span>
        </span>
        <span className="text-muted-foreground">{formatDate(o.placedAt, locale)}</span>
      </div>
      <ul className="divide-y px-5">
        {o.lines.map((l, i) => (
          <li key={i} className="flex items-center gap-3 py-3">
            <span className="size-14 shrink-0 overflow-hidden rounded-xl bg-muted">
              <StoreImage src={l.image} alt={l.name} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-sm font-medium">{l.name}</span>
              <span className="block text-xs text-muted-foreground">
                {l.qty} × {money(l.price)}
              </span>
            </span>
            <span className="text-sm font-semibold tabular-nums">{money(l.total)}</span>
          </li>
        ))}
      </ul>
      <dl className="grid gap-1.5 border-t px-5 py-4 text-sm">
        <Row label={t("cart.subtotal")} value={money(o.totals.subtotal)} />
        {o.totals.discount > 0 && <Row label={t("cart.discount")} value={`−${money(o.totals.discount)}`} className="text-success-ink" />}
        {o.totals.loyalty && o.totals.loyalty.discount > 0 && <Row label={t("loyalty.discountRow", { points: o.totals.loyalty.points })} value={`−${money(o.totals.loyalty.discount)}`} className="text-success-ink" />}
        <Row label={t("cart.shipping")} value={o.totals.shipping === 0 ? t("delivery.free") : money(o.totals.shipping)} />
        {o.totals.codFee > 0 && <Row label={t("order.codFee")} value={money(o.totals.codFee)} />}
        <div className="mt-1 flex items-baseline justify-between border-t pt-3">
          <dt className="font-semibold">{t("cart.total")}</dt>
          <dd className="font-heading text-xl font-bold tabular-nums">{money(o.totals.total)}</dd>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(`order.method.${o.paymentMethod}`)}
          {o.shipTo && ` · ${t("order.shipTo", { place: `${o.shipTo.city} ${o.shipTo.pincode}` })}`}
        </p>
      </dl>
    </section>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("flex justify-between", className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
