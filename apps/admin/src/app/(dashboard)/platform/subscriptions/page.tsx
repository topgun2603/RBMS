"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CreditCardIcon, ReceiptIcon } from "lucide-react";
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@rbms/ui";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { SuperAdminOnly } from "@/components/superadmin-only";
import { SUBS_KEY } from "@/components/subscriptions/dialogs";
import { PlatformInvoicesTable } from "@/components/subscriptions/invoices-table";
import { SubscriptionStatsTiles } from "@/components/subscriptions/stats";
import { STATUSES, SubscriptionsTable } from "@/components/subscriptions/subscriptions-table";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSubsT } from "@/lib/subscriptions-messages";
import type { SubscriptionStats, SubscriptionStatus } from "@/lib/types";

export default function PlatformSubscriptionsPage() {
  return (
    <SuperAdminOnly>
      <React.Suspense fallback={null}>
        <Subscriptions />
      </React.Suspense>
    </SuperAdminOnly>
  );
}

function Subscriptions() {
  const { t } = useI18n();
  const k = useSubsT();
  const router = useRouter();
  const pathname = usePathname() ?? "/platform/subscriptions";
  const params = useSearchParams();
  const tab = params.get("tab") === "invoices" ? "invoices" : "subscriptions";
  // The subscription table's own `status` URL filter: one value lights its tile.
  const raw = (params.get("status") ?? "").split(",").filter(Boolean);
  const status: SubscriptionStatus | "all" = raw.length === 1 && (STATUSES as string[]).includes(raw[0]!) ? (raw[0] as SubscriptionStatus) : "all";

  const replace = (sp: URLSearchParams) => {
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const setTab = (v: string) => {
    const sp = new URLSearchParams(params.toString());
    if (v === "invoices") sp.set("tab", v);
    else sp.delete("tab");
    replace(sp);
  };
  /** A status tile: the same filter the table's pills set (back to page 1). */
  const setStatus = (s: SubscriptionStatus | "all") => {
    const sp = new URLSearchParams(params.toString());
    sp.delete("tab");
    sp.delete("page");
    if (s === "all") sp.delete("status");
    else sp.set("status", s);
    replace(sp);
  };

  const stats = useQuery({
    queryKey: [...SUBS_KEY, "stats"],
    queryFn: () => api.get<SubscriptionStats>("/subscriptions/admin/stats", undefined, { tenant: null }),
    staleTime: 60_000,
  });

  return (
    <Page>
      <PageHeader eyebrow={t("admin.nav.platform")} title={k("admin.subs.title")} description={k("admin.subs.subtitle")} />
      {stats.isError ? (
        <div className="mb-5">
          <QueryError error={stats.error} onRetry={() => void stats.refetch()} />
        </div>
      ) : (
        <SubscriptionStatsTiles stats={stats.data} loading={stats.isLoading} status={tab === "subscriptions" ? status : "all"} onStatus={setStatus} />
      )}
      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList aria-label={k("admin.subs.tabs")} className="h-11 w-full rounded-xl p-1 shadow-inner sm:w-max">
          <TabsTrigger value="subscriptions" className="h-full flex-1 rounded-lg px-4 sm:flex-none">
            <CreditCardIcon /> {k("admin.subs.tab.subscriptions")}
          </TabsTrigger>
          <TabsTrigger value="invoices" className="h-full flex-1 rounded-lg px-4 sm:flex-none">
            <ReceiptIcon /> {k("admin.subs.tab.invoices")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="subscriptions">{tab === "subscriptions" && <SubscriptionsTable />}</TabsContent>
        <TabsContent value="invoices">{tab === "invoices" && <PlatformInvoicesTable />}</TabsContent>
      </Tabs>
    </Page>
  );
}
