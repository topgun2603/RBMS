"use client";

import * as React from "react";
import { BookOpenIcon, CodeXmlIcon, HistoryIcon, KeyRoundIcon, WebhookIcon } from "lucide-react";
import { FadeIn, Tabs, TabsContent, TabsList, TabsTrigger } from "@srirealtime/ui";
import { Page, PageHeading, SettingsNav, useI18n, useModuleNavigate, useQueryParams } from "@srirealtime/web";
import { DELIVERIES_ENDPOINT_PARAM, DELIVERIES_URL_PREFIX, DeliveriesTab } from "../components/developer/deliveries-tab";
import { DocsTab } from "../components/developer/docs-tab";
import { KeysTab } from "../components/developer/keys-tab";
import { WebhooksTab } from "../components/developer/webhooks-tab";

const TABS = [
  { key: "keys", icon: KeyRoundIcon },
  { key: "webhooks", icon: WebhookIcon },
  { key: "deliveries", icon: HistoryIcon },
  { key: "docs", icon: BookOpenIcon },
] as const;
type TabKey = (typeof TABS)[number]["key"];
const isTab = (v: string | null): v is TabKey => TABS.some((x) => x.key === v);

/** Settings → API & webhooks: API keys, webhook endpoints, delivery log and docs (feature `developer`). */
export default function DeveloperSettingsPage() {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const params = useQueryParams();
  const param = params.get("tab");
  const tab: TabKey = isTab(param) ? param : "keys";
  const listRef = React.useRef<HTMLDivElement>(null);

  const go = React.useCallback(
    (next: { tab: TabKey; endpoint?: string }) => {
      const q = new URLSearchParams(params.toString());
      if (next.tab === "keys") q.delete("tab");
      else q.set("tab", next.tab);
      // Changing tabs drops the delivery-log table's state (page, sort, filters); a webhook's "View deliveries" link
      // opens the log filtered to that endpoint.
      for (const k of [...q.keys()]) if (k.startsWith(`${DELIVERIES_URL_PREFIX}.`) || k === "endpoint") q.delete(k);
      if (next.endpoint && next.tab === "deliveries") q.set(DELIVERIES_ENDPOINT_PARAM, next.endpoint);
      navigate(q.toString() ? `?${q}` : "?", { replace: true, scroll: false });
    },
    [params, navigate],
  );

  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-state="active"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  return (
    <Page>
      <SettingsNav />
      <PageHeading icon={CodeXmlIcon} title={t("growth.developer.title")} description={t("growth.developer.subtitle")} />
      <Tabs value={tab} onValueChange={(v) => isTab(v) && go({ tab: v })} className="gap-4">
        <div ref={listRef} className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          <TabsList aria-label={t("growth.developer.tabsLabel")} className="h-11 w-max rounded-xl p-1 shadow-inner">
            {TABS.map(({ key, icon: Icon }) => (
              <TabsTrigger key={key} value={key} className="h-full rounded-lg px-3 sm:px-4">
                <Icon />
                {t(`growth.developer.tabs.${key}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {/* Only the active tab mounts, so each tab loads its own data when opened. */}
        <TabsContent value="keys">
          {tab === "keys" && (
            <FadeIn>
              <KeysTab />
            </FadeIn>
          )}
        </TabsContent>
        <TabsContent value="webhooks">
          {tab === "webhooks" && (
            <FadeIn>
              <WebhooksTab onShowDeliveries={(id) => go({ tab: "deliveries", endpoint: id })} />
            </FadeIn>
          )}
        </TabsContent>
        <TabsContent value="deliveries">
          {tab === "deliveries" && (
            <FadeIn>
              <React.Suspense fallback={null}>
                <DeliveriesTab />
              </React.Suspense>
            </FadeIn>
          )}
        </TabsContent>
        <TabsContent value="docs">
          {tab === "docs" && (
            <FadeIn>
              <DocsTab />
            </FadeIn>
          )}
        </TabsContent>
      </Tabs>
    </Page>
  );
}
