"use client";

import * as React from "react";
import { KeyRoundIcon, UsersRoundIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@srirealtime/ui";
import { Page, PageHeading, SettingsNav, useI18n, useModuleNavigate, useQueryParams } from "@srirealtime/web";
import { NoPermission } from "../components/bits";
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
  const tab = params.get("tab") === "roles" ? "roles" : "members";
  const setTab = (v: string) => navigate(v === "roles" ? "?tab=roles" : "?", { replace: true, scroll: false });

  return (
    <Page className="max-w-5xl">
      <SettingsNav />
      <PageHeading icon={UsersRoundIcon} title={t("workspace.team.title")} description={t("workspace.team.subtitle")} />
      {!allowed ? (
        <NoPermission permission={PERMISSIONS.staff} />
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <TabsList aria-label={t("workspace.team.tabs")} className="h-11 w-max rounded-xl p-1 shadow-inner">
            <TabsTrigger value="members" className="h-full rounded-lg px-4">
              <UsersRoundIcon /> {t("workspace.team.membersTab")}
            </TabsTrigger>
            <TabsTrigger value="roles" className="h-full rounded-lg px-4">
              <KeyRoundIcon /> {t("workspace.team.rolesTab")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="members">{tab === "members" && <MembersTab />}</TabsContent>
          <TabsContent value="roles">{tab === "roles" && <RolesTab />}</TabsContent>
        </Tabs>
      )}
    </Page>
  );
}
