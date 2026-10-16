"use client";

import * as React from "react";
import { BookOpenIcon, InboxIcon, LifeBuoyIcon, MegaphoneIcon, MessageCircleIcon, MessageSquareTextIcon } from "lucide-react";
import { Card, EmptyState, Stagger, StaggerItem } from "@srirealtime/ui";
import { ModuleLink, Page, PageHeading, useI18n, useVisible } from "@srirealtime/web";
import { NAV_ITEMS } from "../lib/nav";
import { TicketsWidget, UnreadWidget } from "../components/overview-cards";
import { useInboxSources } from "../widgets/inbox";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  chat: MessageCircleIcon,
  whatsapp: MessageSquareTextIcon,
  campaigns: MegaphoneIcon,
  support: LifeBuoyIcon,
  faq: BookOpenIcon,
};

/** The module root: unread + tickets cards and a tile per section the member may open. */
export default function InboxOverviewPage() {
  const { t } = useI18n();
  const visible = useVisible();
  const s = useInboxSources();
  // Inside the module's scope the kit already applies its `features` restriction.
  const items = NAV_ITEMS.filter((i) => visible(i));
  return (
    <Page>
      <PageHeading icon={InboxIcon} title={t("inbox.nav.section")} description={t("inbox.overview.subtitle")} />
      {items.length === 0 ? (
        <EmptyState icon={InboxIcon} title={t("inbox.overview.emptyTitle")} description={t("inbox.overview.emptyBody")} />
      ) : (
        <div className="grid gap-5">
          {(s.chat || s.wa || s.support) && (
            <div className="grid gap-4 md:grid-cols-2">
              {(s.chat || s.wa) && <UnreadWidget />}
              {s.support && <TicketsWidget />}
            </div>
          )}
          <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((i) => {
              const Icon = ICONS[i.href] ?? InboxIcon;
              return (
                <StaggerItem key={i.href}>
                  <ModuleLink to={i.href} className="block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Card className="p-card h-full flex-row items-start gap-3 transition-colors hover:border-primary/30">
                      <span className="icon-chip size-10 rounded-xl text-primary">
                        <Icon className="size-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-heading font-semibold">{t(i.label)}</span>
                        <span className="block text-xs text-muted-foreground">{t(`inbox.overview.${i.href}`)}</span>
                      </span>
                    </Card>
                  </ModuleLink>
                </StaggerItem>
              );
            })}
          </Stagger>
        </div>
      )}
    </Page>
  );
}
