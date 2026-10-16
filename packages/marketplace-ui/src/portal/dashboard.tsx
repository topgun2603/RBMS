"use client";

import * as React from "react";
import { ArrowRightIcon, CalendarClockIcon, ClipboardCheckIcon, HourglassIcon, IndianRupeeIcon, PackagePlusIcon, TrendingUpIcon, WalletIcon } from "lucide-react";
import { AnimatedNumber, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Progress, Skeleton, StatCard, Stagger, StaggerItem } from "@srirealtime/ui";
import { ModuleLink, Page, PageHeading, QueryError, useFeature, useI18n } from "@srirealtime/web";
import { OrderStatusPill, Thumb } from "../components/bits";
import { istDateOf, istEndOfDay, istMonthStartOf, money, nextPayoutEstimate, onboardingSteps, pendingSettlement, salesSummary } from "../lib/logic";
import { useKycSubject, useMarketplaceSettings } from "../lib/queries";
import { useMyOrders, useVendor } from "../lib/vendor";
import { MARKETPLACE_SETTINGS_DEFAULTS } from "../lib/types";

/** Seller home: today / this month, money waiting for the return window, next payout estimate, recent orders. */
export default function SellerDashboard() {
  const { t, formatDate } = useI18n();
  const { self, vendorId } = useVendor();
  const now = React.useMemo(() => new Date(), []);
  const month = useMyOrders({ from: istMonthStartOf(now), to: istDateOf(now), limit: 500 });
  const pending = useMyOrders({ settlementStatus: "pending", limit: 500 });
  const recent = useMyOrders({ limit: 6 });
  // Sellers only get the namespace's public keys (if any): fall back to the defaults.
  const settings = useMarketplaceSettings();
  const kycOn = useFeature("kyc");
  const kyc = useKycSubject(vendorId, kycOn);
  if (!self) return null;

  const minPayout = settings.data?.minPayoutPaise ?? MARKETPLACE_SETTINGS_DEFAULTS.minPayoutPaise;
  const sales = month.data ? salesSummary(month.data.items, now) : null;
  const weekAhead = istEndOfDay(istDateOf(new Date(now.getTime() + 7 * 86_400_000)));
  const waiting = pending.data ? pendingSettlement(pending.data.items, weekAhead) : null;
  const estimate = waiting ? nextPayoutEstimate(self.balance.balance, waiting.releasing, minPayout) : null;
  const steps = onboardingSteps(self, kycOn ? (kyc.data?.checks ?? []) : null);

  return (
    <Page>
      <PageHeading title={t("marketplace.dash.title", { name: self.contactName?.split(" ")[0] ?? self.name })} description={t("marketplace.dash.subtitle")} actions={
        <Button asChild size="lg">
          <ModuleLink to="products/new">
            <PackagePlusIcon /> {t("marketplace.products.add")}
          </ModuleLink>
        </Button>
      } />

      {steps.done < steps.total && (
        <Card className="p-card mb-4 flex-row flex-wrap items-center gap-3 border-primary/30 bg-primary/5">
          <span className="icon-chip size-10 rounded-xl text-primary">
            <ClipboardCheckIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t("marketplace.dash.finishSetup")}</p>
            <Progress value={(steps.done / steps.total) * 100} className="mt-2 h-1.5 max-w-xs" />
          </div>
          <Button asChild variant="outline">
            <ModuleLink to="onboarding">
              {t("marketplace.dash.continueSetup", { done: steps.done, total: steps.total })} <ArrowRightIcon />
            </ModuleLink>
          </Button>
        </Card>
      )}

      {month.isError ? (
        <QueryError error={month.error} onRetry={() => void month.refetch()} />
      ) : (
        <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StaggerItem>
            <StatCard
              icon={IndianRupeeIcon}
              title={t("marketplace.dash.today")}
              loading={!sales}
              value={<AnimatedNumber value={sales?.today ?? 0} from={0} format={money} />}
              description={t("marketplace.dash.orders", { count: sales?.todayCount ?? 0 })}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              icon={TrendingUpIcon}
              title={t("marketplace.dash.month")}
              loading={!sales}
              value={<AnimatedNumber value={sales?.month ?? 0} from={0} format={money} />}
              description={t("marketplace.dash.monthNet", { amount: money(sales?.monthNet ?? 0), count: sales?.monthCount ?? 0 })}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              icon={HourglassIcon}
              iconClassName="text-warning-ink"
              title={t("marketplace.dash.pending")}
              loading={!waiting}
              value={<AnimatedNumber value={waiting?.pending ?? 0} from={0} format={money} />}
              description={
                waiting?.nextAt
                  ? t("marketplace.dash.pendingNext", { date: formatDate(waiting.nextAt, { day: "numeric", month: "short" }) })
                  : t("marketplace.dash.pendingHint")
              }
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              icon={WalletIcon}
              iconClassName="text-success-ink"
              title={t("marketplace.dash.nextPayout")}
              loading={!estimate}
              value={<AnimatedNumber value={estimate?.amount ?? 0} from={0} format={money} />}
              description={
                estimate && !estimate.reachesMinimum
                  ? t("marketplace.dash.belowMin", { amount: money(estimate.shortBy), min: money(minPayout) })
                  : t("marketplace.dash.nextPayoutHint", { balance: money(self.balance.balance) })
              }
            />
          </StaggerItem>
        </Stagger>
      )}

      <Card className="mt-4">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2.5 text-base">
            <span className="icon-chip size-8 text-primary">
              <CalendarClockIcon className="size-4" />
            </span>
            {t("marketplace.dash.recent")}
          </CardTitle>
          <Button asChild variant="ghost" size="sm">
            <ModuleLink to="orders">
              {t("marketplace.widget.view")} <ArrowRightIcon />
            </ModuleLink>
          </Button>
        </CardHeader>
        <CardContent className="px-2 sm:px-3">
          {recent.isError ? (
            <QueryError compact error={recent.error} onRetry={() => void recent.refetch()} />
          ) : recent.isPending ? (
            <div className="grid gap-2 px-2">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          ) : recent.data.items.length === 0 ? (
            <EmptyState compact icon={CalendarClockIcon} title={t("marketplace.orders.emptyTitle")} description={t("marketplace.dash.noOrders")} />
          ) : (
            <Stagger className="grid">
              {recent.data.items.map((o) => (
                <StaggerItem key={o.id}>
                  <ModuleLink to="orders" className="flex items-center gap-3 rounded-xl px-2 py-2.5 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring">
                    <Thumb src={o.lines[0]?.image} className="size-10" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{o.lines.map((l) => l.name).join(", ")}</p>
                      <p className="text-meta text-muted-foreground">
                        {o.orderNumber} · {formatDate(o.placedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-sm font-semibold tabular-nums">{money(o.net)}</span>
                      <OrderStatusPill status={o.status} />
                    </div>
                  </ModuleLink>
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
