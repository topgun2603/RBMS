"use client";

import * as React from "react";
import { KeyRoundIcon, PercentIcon, UsersRoundIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@srirealtime/ui";
import { Page, PageHeading, SettingsNav, useI18n, useModuleNavigate, useQueryParams } from "@srirealtime/web";
import { NoPermission } from "../components/bits";
import { DiscountLimitsTab } from "../components/team/discount-limits-tab";
import { MembersTab } from "../components/team/members-tab";
import { RolesTab } from "../components/team/roles-tab";
import { PERMISSIONS, useHasPermission } from "../lib/access";

export default function TeamPage() {
  return (
    <React.Suspense fallback={null}>
      <Team />
    </React.Suspense>
  );
}

function Team() {
  const { t } = useI18n();
  const allowed = useHasPermission(PERMISSIONS.staff);
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const tabParam = params.get("tab");
  const tab = tabParam === "roles" ? "roles" : tabParam === "discounts" ? "discounts" : "members";
  const setTab = (v: string) => navigate(v === "members" ? "?" : `?tab=${v}`, { replace: true, scroll: false });

  return (
    <Page>
      <SettingsNav />
      <PageHeading icon={UsersRoundIcon} title={t("workspace.team.title")} description={t("workspace.team.subtitle")} />
      {!allowed ? (
        <NoPermission permission={PERMISSIONS.staff} />
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <TabsList aria-label={t("workspace.team.tabs")} className="h-11 w-max rounded-xl p-1 shadow-inner">
            <TabsTrigger value="members" className="h-full rounded-lg px-4">
              <UsersRoundIcon /> {t("workspace.team.membersTab")}
            </TabsTrigger>
            <TabsTrigger value="roles" className="h-full rounded-lg px-4">
              <KeyRoundIcon /> {t("workspace.team.rolesTab")}
            </TabsTrigger>
            <TabsTrigger value="discounts" className="h-full rounded-lg px-4">
              <PercentIcon /> {t("workspace.discounts.tab")}
            </TabsTrigger>
          </TabsList>
          </div>
          <TabsContent value="members">{tab === "members" && <MembersTab />}</TabsContent>
          <TabsContent value="roles">{tab === "roles" && <RolesTab />}</TabsContent>
          <TabsContent value="discounts">{tab === "discounts" && <DiscountLimitsTab />}</TabsContent>
        </Tabs>
      )}
    </Page>
  );
}
