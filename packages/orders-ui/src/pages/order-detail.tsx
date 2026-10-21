"use client";

import * as React from "react";
import { ArrowRightIcon, ChevronDownIcon, Loader2Icon, ShoppingBagIcon, XCircleIcon, Undo2Icon } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
} from "@srirealtime/ui";
import { Page, PageHeading, QueryError, useI18n, useRouteParams } from "@srirealtime/web";
import { LinesCard } from "../components/order/lines-card";
import { PaymentsCard } from "../components/order/payments-card";
import { OrderProgress } from "../components/order/progress";
import { ShippingCard } from "../components/order/shipping-card";
import { ReviewRequestCard } from "../components/order/review-request-card";
import { AddressCard, CustomerCard, DocumentsCard } from "../components/order/side-cards";
import { TimelineCard } from "../components/order/timeline-card";
import { ORDER_STATUS_META, OrderStatusPill, PaymentPill } from "../components/pills";
import { useStatusMover } from "../components/status-actions";
import { useOrder } from "../lib/queries";
import { nextStep, skipAheadSteps } from "../lib/status";
import type { Order } from "../lib/types";

export default function OrderDetailPage() {
  const { id } = useRouteParams<{ id: string }>();
  const { t } = useI18n();
  const order = useOrder(id);

  return (
    <Page>
      {order.isError ? (
        <>
          <PageHeading icon={ShoppingBagIcon} title={t("orders.detail.title")} back={{ href: "orders", label: t("orders.list.title") }} />
          <QueryError error={order.error} onRetry={() => void order.refetch()} />
        </>
      ) : order.isPending ? (
        <DetailSkeleton />
      ) : (
        <OrderView order={order.data} />
      )}
    </Page>
  );
}

function OrderView({ order }: { order: Order }) {
  const { t, formatDate } = useI18n();
  const mover = useStatusMover();
  const allowed = order.nextStatuses ?? [];
  const next = nextStep(order.status, allowed);
  const primary = next && mover.canMove(next) ? next : null;
  const skips = skipAheadSteps(order.status, allowed).filter(mover.canMove);
  const canCancel = allowed.includes("cancelled") && mover.canMove("cancelled");
  const canReturn = allowed.includes("returned") && mover.canMove("returned");
  const busy = mover.busyId === order.id;
  const PrimaryIcon = primary ? ORDER_STATUS_META[primary].icon : ArrowRightIcon;
  const hasMenu = skips.length > 0 || canCancel || canReturn;

  return (
    <>
      <PageHeading
        icon={ShoppingBagIcon}
        back={{ href: "orders", label: t("orders.list.title") }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {order.number}
            <OrderStatusPill status={order.status} size="md" />
            <PaymentPill status={order.paymentStatus} />
          </span>
        }
        description={t("orders.detail.subtitle", {
          date: formatDate(order.placedAt, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }),
          channel: t(`orders.channel.${order.channel}`),
        })}
        actions={
          (primary || hasMenu) && (
            <div className="flex w-full items-center gap-2 sm:w-auto">
              {primary && (
                <Button size="lg" className="h-11 flex-1 sm:flex-none" disabled={busy} onClick={() => mover.request(order, primary)}>
                  {busy ? <Loader2Icon className="animate-spin" /> : <PrimaryIcon />}
                  {t(`orders.action.${primary}`)}
                </Button>
              )}
              {hasMenu && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="lg" variant="outline" className="h-11" disabled={busy} aria-label={t("orders.detail.moreActions")}>
                      {primary ? <ChevronDownIcon /> : <>{t("orders.detail.moreActions")} <ChevronDownIcon /></>}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-52">
                    {skips.length > 0 && <DropdownMenuLabel className="text-xs text-muted-foreground">{t("orders.detail.skipTo")}</DropdownMenuLabel>}
                    {skips.map((s) => {
                      const Icon = ORDER_STATUS_META[s].icon;
                      return (
                        <DropdownMenuItem key={s} className="h-10" onSelect={() => mover.request(order, s)}>
                          <Icon /> {t(`orders.action.${s}`)}
                        </DropdownMenuItem>
                      );
                    })}
                    {(canCancel || canReturn) && skips.length > 0 && <DropdownMenuSeparator />}
                    {canReturn && (
                      <DropdownMenuItem className="h-10" onSelect={() => mover.request(order, "returned")}>
                        <Undo2Icon /> {t("orders.action.returned")}
                      </DropdownMenuItem>
                    )}
                    {canCancel && (
                      <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => mover.request(order, "cancelled")}>
                        <XCircleIcon /> {t("orders.action.cancelled")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )
        }
      />

      {(order.status === "cancelled" || order.status === "returned") && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-destructive/25 bg-destructive/8 p-4 text-sm">
          {order.status === "cancelled" ? <XCircleIcon className="mt-0.5 size-5 shrink-0 text-danger-ink" /> : <Undo2Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />}
          <div>
            <p className="font-medium">
              {order.status === "cancelled"
                ? t("orders.detail.cancelledOn", { date: order.cancelledAt ? formatDate(order.cancelledAt, { day: "numeric", month: "short", year: "numeric" }) : "" })
                : t("orders.detail.returned")}
            </p>
            {order.cancelReason && <p className="text-muted-foreground">{order.cancelReason}</p>}
          </div>
        </div>
      )}

      <div className="mb-4 rounded-2xl border border-card-ring bg-card px-3 py-4 shadow-elevated sm:px-6">
        <OrderProgress order={order} />
      </div>

      <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-4">
          <LinesCard order={order} />
          <ShippingCard order={order} />
          <PaymentsCard order={order} />
          <TimelineCard order={order} />
        </div>
        <div className="grid min-w-0 content-start gap-4 lg:sticky lg:top-20 lg:self-start">
          <CustomerCard order={order} />
          <AddressCard order={order} />
          <DocumentsCard order={order} />
          <ReviewRequestCard order={order} />
        </div>
      </div>
      {mover.dialogs}
    </>
  );
}

function DetailSkeleton() {
  return (
    <div className="grid gap-section">
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-11 w-36 rounded-lg" />
      </div>
      <Skeleton className="h-24 rounded-2xl" />
      <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-section">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
        <div className="grid content-start gap-section">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
