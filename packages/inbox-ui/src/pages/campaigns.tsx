"use client";

import * as React from "react";
import { MegaphoneIcon, PlusIcon } from "lucide-react";
import { Button, ChipGroup, cn, DataTable, DataTableToolbar, EmptyState, type DataTableColumn } from "@srirealtime/ui";
import { ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { ConnectionPill } from "../components/bits";
import { CampaignStatusPill, CountBars } from "../components/pills";
import { pollWhenNotLive } from "../lib/live";
import { qk } from "../lib/queries";
import { CAMPAIGN_STATUSES, type Campaign } from "../lib/types";
import { useWhatsAppLive } from "../lib/wa-live";

export default function CampaignsPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <CampaignsList />
    </React.Suspense>
  );
}

function CampaignsList() {
  const { t, formatDate, formatNumber } = useI18n();
  const navigate = useModuleNavigate();
  // Live campaign events refresh this table (wa-live invalidates qk.campaignTable).
  const live = useWhatsAppLive();
  const dateTime = React.useCallback((d: string) => formatDate(d, { dateStyle: "medium", timeStyle: "short" }), [formatDate]);

  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("inbox.campaign.col.status"),
          options: CAMPAIGN_STATUSES.map((s) => ({
            value: s,
            label: t(`inbox.campaign.status.${s}`),
          })),
        },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<Campaign>[]>(
    () => [
      {
        id: "name",
        header: t("inbox.campaign.col.name"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[24rem]",
        cell: (c) => (
          <div className="grid min-w-0">
            <ModuleLink to={`campaigns/${c.id}`} className="truncate font-medium outline-none hover:text-primary hover:underline focus-visible:underline">
              {c.name}
            </ModuleLink>
            {c.error && <span className="truncate text-xs text-danger-ink">{c.error}</span>}
          </div>
        ),
        cardCell: (c) => c.name,
      },
      {
        id: "status",
        header: t("inbox.campaign.col.status"),
        sortable: true,
        card: "right",
        cell: (c) => <CampaignStatusPill status={c.status} />,
      },
      {
        id: "recipients",
        header: t("inbox.campaign.count.total"),
        numeric: true,
        card: "meta",
        cell: (c) => formatNumber(c.counts.total),
        cardCell: (c) => (c.counts.total > 0 ? t("inbox.campaign.recipientsCount", { count: c.counts.total }) : null),
      },
      {
        id: "progress",
        header: t("inbox.campaign.col.progress"),
        hideBelow: "md",
        cell: (c) => (
          <div className={cn(c.counts.total === 0 && "opacity-50")}>
            <CountBars counts={c.counts} compact />
          </div>
        ),
      },
      {
        id: "sent",
        header: t("inbox.campaign.col.sent"),
        sortable: true,
        sortDescFirst: true,
        card: "subtitle",
        cell: (c) =>
          c.startedAt ? (
            <span className="tabular-nums">{dateTime(c.startedAt)}</span>
          ) : c.status === "scheduled" && c.scheduleAt ? (
            <span className="text-muted-foreground">
              {t("inbox.campaign.scheduledFor", {
                date: dateTime(c.scheduleAt),
              })}
            </span>
          ) : (
            <span className="text-muted-foreground">{t("inbox.campaign.notSent")}</span>
          ),
        cardCell: (c) =>
          c.startedAt
            ? t("inbox.campaign.startedOn", { date: dateTime(c.startedAt) })
            : c.status === "scheduled" && c.scheduleAt
              ? t("inbox.campaign.scheduledFor", {
                  date: dateTime(c.scheduleAt),
                })
              : t("inbox.campaign.createdOn", {
                  date: formatDate(c.createdAt, { dateStyle: "medium" }),
                }),
      },
      {
        id: "created",
        header: t("inbox.campaign.col.created"),
        sortable: true,
        sortDescFirst: true,
        cell: (c) => <span className="tabular-nums">{formatDate(c.createdAt, { dateStyle: "medium" })}</span>,
      },
    ],
    [t, formatDate, formatNumber, dateTime],
  );

  const st = useServerTable<Campaign, typeof filters>({
    queryKey: qk.campaignTable,
    path: "/whatsapp/campaigns",
    columns,
    filters,
    defaultSort: "-created",
    search: t("inbox.campaign.search"),
    storageKey: "inbox-campaigns",
  });

  // Without the live stream, poll so running campaigns' progress keeps moving (as the list did before).
  const poll = pollWhenNotLive(live);
  const refetch = st.query.refetch;
  React.useEffect(() => {
    if (!poll) return;
    const id = window.setInterval(() => void refetch(), poll);
    return () => window.clearInterval(id);
  }, [poll, refetch]);

  const status = st.filters.status;
  const counts = st.facets?.status;
  const allCount = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;
  const pill = status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : "";
  const filtered = st.table.activeFilterCount > 0;

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
        description={st.total !== undefined && st.total > 0 ? t("inbox.campaign.countTotal", { count: st.total }) : t("inbox.campaign.subtitle")}
        actions={
          <>
            <ConnectionPill status={live} />
            {add}
          </>
        }
      />
      <DataTableToolbar
        table={st.table}
        quickFilters={
          allCount === 0 && status.value.length === 0 ? undefined : (
            <ChipGroup
              size="sm"
              aria-label={t("inbox.campaign.col.status")}
              value={pill}
              onChange={(v) => status.set(v === "all" ? [] : [v])}
              options={[
                {
                  value: "all",
                  label: t("inbox.common.all"),
                  meta: allCount !== undefined ? formatNumber(allCount) : undefined,
                },
                ...CAMPAIGN_STATUSES.filter((s) => !counts || counts[s] || status.value.includes(s)).map((s) => ({
                  value: s as string,
                  label: t(`inbox.campaign.status.${s}`),
                  meta: counts?.[s] ? formatNumber(counts[s]) : undefined,
                })),
              ]}
            />
          )
        }
      />
      <DataTable
        table={st.table}
        onRowClick={(c) => navigate(`campaigns/${c.id}`)}
        empty={
          filtered ? undefined : (
            <EmptyState
              className="border-0 bg-transparent"
              icon={MegaphoneIcon}
              title={t("inbox.campaign.emptyTitle")}
              description={t("inbox.campaign.emptyBody")}
              action={add}
            />
          )
        }
      />
    </Page>
  );
}
