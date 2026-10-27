"use client";

import * as React from "react";
import { DownloadIcon, FileUpIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@srirealtime/ui";
import { Page, PageHeading, SettingsNav, useI18n, useModuleNavigate, useQueryParams } from "@srirealtime/web";
import { NoPermission } from "../components/bits";
import { ExportTab } from "../components/import/export-tab";
import { ImportHistory } from "../components/import/history";
import { ImportWizard } from "../components/import/wizard";
import { PERMISSIONS, useHasPermission } from "../lib/access";

export default function ImportPage() {
  return (
    <React.Suspense fallback={null}>
      <ImportExport />
    </React.Suspense>
  );
}

function ImportExport() {
  const { t } = useI18n();
  const allowed = useHasPermission(PERMISSIONS.importexport);
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const tab = params.get("tab") === "export" ? "export" : "import";

  return (
    <Page>
      <SettingsNav />
      <PageHeading icon={FileUpIcon} title={t("workspace.import.title")} description={t("workspace.import.subtitle")} />
      {!allowed ? (
        <NoPermission permission={PERMISSIONS.importexport} />
      ) : (
        <Tabs value={tab} onValueChange={(v) => navigate(v === "export" ? "?tab=export" : "?", { replace: true, scroll: false })} className="gap-4">
          <TabsList aria-label={t("workspace.import.tabs")} className="h-11 w-max rounded-xl p-1 shadow-inner">
            <TabsTrigger value="import" className="h-full rounded-lg px-4">
              <FileUpIcon /> {t("workspace.import.importTab")}
            </TabsTrigger>
            <TabsTrigger value="export" className="h-full rounded-lg px-4">
              <DownloadIcon /> {t("workspace.import.exportTab")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="import">
            {tab === "import" && (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
                <ImportWizard />
                <ImportHistory />
              </div>
            )}
          </TabsContent>
          <TabsContent value="export">{tab === "export" && <ExportTab />}</TabsContent>
        </Tabs>
      )}
    </Page>
  );
}
