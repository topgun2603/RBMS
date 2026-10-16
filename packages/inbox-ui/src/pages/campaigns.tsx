"use client";

import * as React from "react";
import { Loader2Icon, MegaphoneIcon, PlusIcon } from "lucide-react";
import { Button, Card, cn, EmptyState, Skeleton, Stagger, StaggerItem } from "@srirealtime/ui";
import { ModuleLink, Page, PageHeading, QueryError, useI18n } from "@srirealtime/web";
import { ConnectionPill } from "../components/bits";
import { CampaignStatusPill, CountBars } from "../components/pills";
import { useSentinel } from "../components/two-pane";
import { pollWhenNotLive } from "../lib/live";
import { useCampaigns } from "../lib/queries";
import type { Campaign } from "../lib/types";
import { useWhatsAppLive } from "../lib/wa-live";

export default function CampaignsPage() {
  const { t, formatDate } = useI18n();
  const status = useWhatsAppLive();
  const list = useCampaigns(pollWhenNotLive(status));
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const sentinel = useSentinel(() => void list.fetchNextPage(), !!list.hasNextPage && !list.isFetchingNextPage);

  const when = (c: Campaign) =>
    c.status === "scheduled" && c.scheduleAt
      ? t("inbox.campaign.scheduledFor", { date: formatDate(c.scheduleAt, { dateStyle: "medium", timeStyle: "short" }) })
      : c.startedAt
        ? t("inbox.campaign.startedOn", { date: formatDate(c.startedAt, { dateStyle: "medium", timeStyle: "short" }) })
        : t("inbox.campaign.createdOn", { date: formatDate(c.createdAt, { dateStyle: "medium" }) });

  const add = (
    <Button asChild size="lg">
      <ModuleLink to="campaigns/new">
        <PlusIcon /> {t("inbox.campaign.new")}
      </ModuleLink>
    </Button>
  );

  return (
    <Page>
      <PageHeading
        icon={MegaphoneIcon}
        title={t("inbox.campaign.title")}
        description={t("inbox.campaign.subtitle")}
        actions={
          <>
            <ConnectionPill status={status} />
            {add}
          </>
        }
      />
      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={MegaphoneIcon} title={t("inbox.campaign.emptyTitle")} description={t("inbox.campaign.emptyBody")} action={add} />
      ) : (
        <Stagger className="grid gap-3">
          {items.map((c) => (
            <StaggerItem key={c.id}>
              <ModuleLink to={`campaigns/${c.id}`} className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Card className="p-card gap-0 transition-colors hover:border-primary/30">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate font-heading text-base font-semibold">{c.name}</h2>
                        <CampaignStatusPill status={c.status} />
                      </div>
                      <p className="text-meta text-muted-foreground">
                        {when(c)}
                        {c.counts.total > 0 && ` · ${t("inbox.campaign.recipientsCount", { count: c.counts.total })}`}
                      </p>
                      {c.error && <p className="text-xs text-danger-ink">{c.error}</p>}
                    </div>
                    <div className={cn("shrink-0", c.counts.total === 0 && "opacity-50")}>
                      <CountBars counts={c.counts} compact />
                    </div>
                  </div>
                </Card>
              </ModuleLink>
            </StaggerItem>
          ))}
        </Stagger>
      )}
      <div ref={sentinel} className="h-1" />
      {list.isFetchingNextPage && <Loader2Icon className="mx-auto my-4 size-5 animate-spin text-muted-foreground" aria-hidden />}
    </Page>
  );
}
