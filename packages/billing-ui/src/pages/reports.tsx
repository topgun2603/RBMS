"use client";

import * as React from "react";
import { Page, PageHeading, useFeatures, useI18n, useModuleNavigate, useQueryParams } from "@srirealtime/web";
import {
  BarChart3Icon,
  CalendarClockIcon,
  HandCoinsIcon,
  LandmarkIcon,
  PiggyBankIcon,
  ShoppingCartIcon,
  TrendingUpIcon,
  WalletCardsIcon,
  WarehouseIcon,
} from "lucide-react";
import { Card, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@srirealtime/ui";
import { DateRangePicker, initialRange, type DateRangeValue } from "../components/date-range-picker";
import { DuesTab } from "../components/reports/dues-tab";
import { GstTab } from "../components/reports/gst-tab";
import { PaymentsTab } from "../components/reports/payments-tab";
import { ProfitTab } from "../components/reports/profit-tab";
import { PurchasesTab } from "../components/reports/purchases-tab";
import { SalesTab } from "../components/reports/sales-tab";
import { StockTab } from "../components/reports/stock-tab";
import { EXPENSES_PERMISSION, useHasPermission } from "../lib/access";

/** Each tab belongs to a feature; the page itself needs invoices.reports (see billingModule). */
const TABS = [
  { key: "sales", icon: TrendingUpIcon, feature: "invoices.reports" },
  { key: "gst", icon: LandmarkIcon, feature: "invoices.gst-reports" },
  { key: "payments", icon: HandCoinsIcon, feature: "invoices.reports" },
  { key: "dues", icon: WalletCardsIcon, feature: "invoices.reports" },
  { key: "stock", icon: WarehouseIcon, feature: "inventory" },
  { key: "purchases", icon: ShoppingCartIcon, feature: "inventory.purchases" },
  // Needs expenses.manage too (the profit API is part of the expenses module).
  { key: "profit", icon: PiggyBankIcon, feature: "expenses" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
const isTab = (v: string | null): v is TabKey => TABS.some((t) => t.key === v);

export default function ReportsPage() {
  return (
    <React.Suspense fallback={<ReportsFallback />}>
      <Reports />
    </React.Suspense>
  );
}

function Reports() {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const params = useQueryParams();
  const features = useFeatures();
  const canExpenses = useHasPermission(EXPENSES_PERMISSION);
  const tabs = TABS.filter((x) => features.isEnabled(x.feature) && (x.key !== "profit" || canExpenses));
  const param = params.get("tab");
  const tab: TabKey = isTab(param) && tabs.some((x) => x.key === param) ? param : (tabs[0]?.key ?? "sales");
  const [range, setRange] = React.useState<DateRangeValue>(() => initialRange("thisMonth"));
  const listRef = React.useRef<HTMLDivElement>(null);

  const setTab = (v: string) => {
    if (!isTab(v)) return;
    const next = new URLSearchParams(params.toString());
    if (v === tabs[0]?.key) next.delete("tab");
    else next.set("tab", v);
    navigate(next.toString() ? `?${next}` : "?", { replace: true, scroll: false });
  };

  // Keep the active tab visible in the horizontally scrolling strip on phones.
  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-state="active"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  const dLong = (d: string) => formatDate(d, { day: "numeric", month: "short", year: "numeric" });
  const { from, to } = range;

  return (
    <Page>
      <PageHeading title={t("billing.reports.title")} description={t("billing.reports.description")} icon={BarChart3Icon} />

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <div
          ref={listRef}
          className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
          data-print-hide
        >
          <TabsList aria-label={t("billing.reports.tabsLabel")} className="h-11 w-max rounded-xl p-1 shadow-inner">
            {tabs.map(({ key, icon: Icon }) => (
              <TabsTrigger key={key} value={key} className="h-full rounded-lg px-3 sm:px-4">
                <Icon />
                {t(`billing.reports.tabs.${key}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <Card className="px-card gap-2 py-3" data-print-hide>
          {tab === "stock" ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="icon-chip size-8 text-primary">
                <WarehouseIcon className="size-4" />
              </span>
              {t("billing.reports.stockNow")}
            </p>
          ) : (
            <>
              <DateRangePicker value={range} onChange={setRange} />
              {tab === "dues" && (
                <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <CalendarClockIcon className="size-3.5 text-primary" />
                  {t("billing.reports.asOf", { date: dLong(to) })}
                </p>
              )}
            </>
          )}
        </Card>

        {/* Only the active tab mounts (Radix), so hidden tabs never call APIs of features that are off. */}
        <TabsContent value="sales">{tab === "sales" && <SalesTab from={from} to={to} />}</TabsContent>
        <TabsContent value="gst">{tab === "gst" && <GstTab from={from} to={to} />}</TabsContent>
        <TabsContent value="payments">{tab === "payments" && <PaymentsTab from={from} to={to} />}</TabsContent>
        <TabsContent value="dues">{tab === "dues" && <DuesTab asOf={to} />}</TabsContent>
        <TabsContent value="stock">{tab === "stock" && <StockTab />}</TabsContent>
        <TabsContent value="purchases">{tab === "purchases" && <PurchasesTab from={from} to={to} />}</TabsContent>
        <TabsContent value="profit">{tab === "profit" && <ProfitTab from={from} to={to} />}</TabsContent>
      </Tabs>
    </Page>
  );
}

/** Matches the final layout while search params resolve. */
function ReportsFallback() {
  return (
    <Page>
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <Skeleton className="mb-4 h-11 w-full max-w-xl rounded-xl" />
      <Skeleton className="mb-4 h-20 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mt-4 h-72 rounded-2xl" />
    </Page>
  );
}
