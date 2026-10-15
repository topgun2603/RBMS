"use client";

import * as React from "react";
import { ArrowRightIcon, StoreIcon, WalletIcon } from "lucide-react";
import { AnimatedNumber, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@srirealtime/ui";
import { ModuleLink, QueryError, useI18n } from "@srirealtime/web";
import { VendorLogo } from "../components/bits";
import { money, previewPayouts } from "../lib/logic";
import { todayIST, useMarketplaceSettings, usePayoutPreviewData, useVendorList } from "../lib/queries";

function WidgetCard({ icon: Icon, title, to, children }: { icon: React.ComponentType<{ className?: string }>; title: string; to: string; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <Card className="h-full gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4 sm:px-5">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="icon-chip size-8 text-primary">
            <Icon className="size-4" />
          </span>
          {title}
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <ModuleLink to={to}>
            {t("marketplace.widget.view")} <ArrowRightIcon />
          </ModuleLink>
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3 px-4 sm:px-5">{children}</CardContent>
    </Card>
  );
}

/** Pending seller applications waiting for approval. */
export function ApplicationsWidget() {
  const { t } = useI18n();
  const q = useVendorList({ status: "pending", offset: 0, limit: 3 });
  const n = q.data?.counts.pending ?? 0;
  return (
    <WidgetCard icon={StoreIcon} title={t("marketplace.widget.applications")} to="vendors?status=pending">
      {q.isError ? (
        <QueryError compact error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <>
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-10 w-full" />
        </>
      ) : (
        <>
          <p className="font-heading text-3xl font-semibold tabular-nums">
            <AnimatedNumber value={n} from={0} />
          </p>
          {n === 0 ? (
            <p className="text-sm text-muted-foreground">{t("marketplace.widget.noApplications")}</p>
          ) : (
            <ul className="grid gap-1.5">
              {q.data.items.map((v) => (
                <li key={v.id}>
                  <ModuleLink to={`vendors/${v.id}`} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring">
                    <VendorLogo name={v.name} url={v.logoUrl} className="size-8 rounded-lg text-xs" />
                    <span className="min-w-0 flex-1 truncate font-medium">{v.name}</span>
                    <ArrowRightIcon className="size-3.5 text-muted-foreground" />
                  </ModuleLink>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </WidgetCard>
  );
}

/** What a payout run today would pay (the same client-side dry run as the payouts screen). */
export function PayableWidget() {
  const { t } = useI18n();
  const until = todayIST();
  const settings = useMarketplaceSettings();
  const data = usePayoutPreviewData(until);
  const preview = React.useMemo(
    () => (data.data && settings.data ? previewPayouts(data.data.vendors.map((v) => ({ ...v, balance: v.balance.balance })), data.data.orders, settings.data, data.data.until) : null),
    [data.data, settings.data],
  );
  return (
    <WidgetCard icon={WalletIcon} title={t("marketplace.widget.payable")} to="payouts">
      {data.isError ? (
        <QueryError compact error={data.error} onRetry={() => void data.refetch()} />
      ) : !preview ? (
        <>
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-4 w-40" />
        </>
      ) : (
        <>
          <p className="font-heading text-3xl font-semibold tabular-nums">
            <AnimatedNumber value={preview.total} from={0} format={money} />
          </p>
          <p className="text-sm text-muted-foreground">
            {t("marketplace.widget.payableBody", { count: preview.pay.length, skipped: preview.skip.length })}
          </p>
        </>
      )}
    </WidgetCard>
  );
}
