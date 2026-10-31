"use client";

import * as React from "react";
import { Page, PageHeading, QueryError, useI18n, useModuleNavigate, useQueryParams } from "@rbms/web";
import { BoxesIcon, FileCheck2Icon, FileSpreadsheetIcon, FileTextIcon, LayoutDashboardIcon, PercentIcon, ScaleIcon, SettingsIcon } from "lucide-react";
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@rbms/ui";
import { CompositionTab } from "../components/gst/composition-tab";
import { Gstr1Tab } from "../components/gst/gstr1-tab";
import { Gstr2bTab } from "../components/gst/gstr2b-tab";
import { Gstr3bTab } from "../components/gst/gstr3b-tab";
import { ItcTab } from "../components/gst/itc-tab";
import { OverviewTab, type GoFn } from "../components/gst/overview-tab";
import { SettingsTab } from "../components/gst/settings-tab";
import { todayIST } from "../lib/format";
import { defaultMonth, isMonthKey, isQuarterKey, schemeOf, useGstOverview, type IssueTab } from "../lib/gst";

const TABS = [
  { key: "overview", icon: LayoutDashboardIcon },
  { key: "gstr1", icon: FileTextIcon },
  { key: "gstr3b", icon: ScaleIcon },
  { key: "itc", icon: BoxesIcon },
  { key: "gstr2b", icon: FileSpreadsheetIcon },
  { key: "composition", icon: PercentIcon },
  { key: "settings", icon: SettingsIcon },
] as const;
type TabKey = (typeof TABS)[number]["key"];
const isTab = (v: string | null): v is TabKey => TABS.some((x) => x.key === v);
/** A composition shop files CMP-08 and GSTR-4, so the regular return tabs are hidden for it. */
const COMPOSITION_HIDDEN: TabKey[] = ["gstr1", "gstr3b", "itc", "gstr2b"];

/** The GST centre: due dates, GSTR-1, GSTR-3B, input credit, GSTR-2B, composition and settings. */
export default function GstPage() {
  return (
    <React.Suspense fallback={<GstFallback />}>
      <Gst />
    </React.Suspense>
  );
}

function Gst() {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const params = useQueryParams();
  const overview = useGstOverview();
  const listRef = React.useRef<HTMLDivElement>(null);
  const config = overview.data?.config;
  const scheme = schemeOf(config);

  const tabs = TABS.filter((x) => (scheme === "composition" ? !COMPOSITION_HIDDEN.includes(x.key) : x.key !== "composition"));
  const param = params.get("tab");
  const tab: TabKey = isTab(param) && tabs.some((x) => x.key === param) ? param : "overview";
  const rawPeriod = params.get("period");
  const period = rawPeriod && (isMonthKey(rawPeriod) || isQuarterKey(rawPeriod)) ? rawPeriod : defaultMonth(todayIST());

  const push = (next: URLSearchParams) => navigate(next.toString() ? `?${next}` : "?", { replace: true, scroll: false });
  const setTab = (v: string) => {
    if (!isTab(v)) return;
    const next = new URLSearchParams();
    if (v !== "overview") next.set("tab", v);
    if (rawPeriod) next.set("period", rawPeriod);
    push(next);
  };
  const setPeriod = (p: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("period", p);
    push(next);
  };
  const setSection = (s: "register" | "rcm") => {
    const next = new URLSearchParams(params.toString());
    next.delete("filter");
    if (s === "rcm") next.set("section", "rcm");
    else next.delete("section");
    push(next);
  };
  /** Jump to the screen a "fix this" button points at. */
  const go: GoFn = (to) => {
    const next = new URLSearchParams();
    const target: IssueTab = to.tab;
    const key: TabKey = target === "rcm" ? "itc" : target === "calendar" ? "overview" : target;
    if (key !== "overview") next.set("tab", key);
    if (to.period) next.set("period", to.period);
    else if (rawPeriod) next.set("period", rawPeriod);
    if (to.filter) next.set("filter", to.filter);
    if (target === "rcm") next.set("section", "rcm");
    push(next);
    window.scrollTo?.({ top: 0 });
  };

  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-state="active"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  return (
    <Page>
      <PageHeading title={t("billing.gst.title")} description={t("billing.gst.description")} icon={FileCheck2Icon} />
      {overview.isError && !overview.data ? (
        <QueryError error={overview.error} onRetry={() => void overview.refetch()} />
      ) : !overview.data || !config ? (
        <GstBody />
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <div ref={listRef} className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden" data-print-hide>
            <TabsList aria-label={t("billing.gst.tabsLabel")} className="h-11 w-max rounded-xl p-1 shadow-inner">
              {tabs.map(({ key, icon: Icon }) => (
                <TabsTrigger key={key} value={key} className="h-full rounded-lg px-3 sm:px-4">
                  <Icon />
                  {t(`billing.gst.tabs.${key}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* Only the active tab mounts, so a tab never loads the bills of a period nobody looks at. */}
          <TabsContent value="overview">{tab === "overview" && <OverviewTab overview={overview.data} period={period} onPeriod={setPeriod} go={go} />}</TabsContent>
          <TabsContent value="gstr1">{tab === "gstr1" && <Gstr1Tab config={config} period={period} onPeriod={setPeriod} />}</TabsContent>
          <TabsContent value="gstr3b">{tab === "gstr3b" && <Gstr3bTab config={config} period={period} onPeriod={setPeriod} />}</TabsContent>
          <TabsContent value="itc">
            {tab === "itc" && <ItcTab period={period} onPeriod={setPeriod} filter={params.get("filter")} section={params.get("section")} onSection={setSection} />}
          </TabsContent>
          <TabsContent value="gstr2b">{tab === "gstr2b" && <Gstr2bTab period={period} onPeriod={setPeriod} />}</TabsContent>
          <TabsContent value="composition">{tab === "composition" && <CompositionTab config={config} period={period} onPeriod={setPeriod} />}</TabsContent>
          <TabsContent value="settings">{tab === "settings" && <SettingsTab profileGstin={overview.data.profile.gstin} />}</TabsContent>
        </Tabs>
      )}
    </Page>
  );
}

function GstBody() {
  return (
    <>
      <Skeleton className="mb-4 h-11 w-full max-w-xl rounded-xl" />
      <Skeleton className="mb-4 h-20 w-full rounded-2xl" />
      <Skeleton className="h-72 rounded-2xl" />
    </>
  );
}

/** Matches the final layout while search params resolve. */
function GstFallback() {
  return (
    <Page>
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <GstBody />
    </Page>
  );
}
