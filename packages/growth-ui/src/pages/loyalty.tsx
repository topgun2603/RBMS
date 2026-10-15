"use client";

import * as React from "react";
import { GiftIcon } from "lucide-react";
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@srirealtime/ui";
import { Page, PageHeading, useI18n, useModuleNavigate, useQueryParams } from "@srirealtime/web";
import { MembersTab } from "../components/loyalty/members-tab";
import { ProgramTab } from "../components/loyalty/program-tab";

const TABS = ["members", "program"] as const;
type Tab = (typeof TABS)[number];

export default function LoyaltyPage() {
  return (
    <React.Suspense fallback={<LoyaltyFallback />}>
      <Loyalty />
    </React.Suspense>
  );
}

function Loyalty() {
  const { t } = useI18n();
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const p = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(p ?? "") ? (p as Tab) : "members";
  const setTab = (v: string) => navigate(v === "members" ? "?" : `?tab=${v}`, { replace: true, scroll: false });

  return (
    <Page className="max-w-6xl">
      <PageHeading icon={GiftIcon} title={t("growth.loyalty.title")} description={t("growth.loyalty.subtitle")} />
      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList aria-label={t("growth.loyalty.tabs")} className="h-11 w-full rounded-xl p-1 sm:w-max">
          <TabsTrigger value="members" className="h-full flex-1 rounded-lg px-4">
            {t("growth.loyalty.membersTab")}
          </TabsTrigger>
          <TabsTrigger value="program" className="h-full flex-1 rounded-lg px-4">
            {t("growth.loyalty.programTab")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="members">{tab === "members" && <MembersTab />}</TabsContent>
        <TabsContent value="program">{tab === "program" && <ProgramTab />}</TabsContent>
      </Tabs>
    </Page>
  );
}

function LoyaltyFallback() {
  return (
    <Page className="max-w-6xl">
      <Skeleton className="mb-5 h-12 w-72" />
      <Skeleton className="mb-4 h-11 w-64 rounded-xl" />
      <Skeleton className="h-96 rounded-2xl" />
    </Page>
  );
}
