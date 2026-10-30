"use client";

import * as React from "react";
import { ChevronRightIcon, HistoryIcon, RefreshCwIcon } from "lucide-react";
import { Button, cn, DataTable, DataTableToolbar, EmptyState, Skeleton, type DataTableColumn } from "@rbms/ui";
import { useI18n, useQueryParams, useServerTable, type ServerFilterDefs } from "@rbms/web";
import { DELIVERY_PAGE_SIZE, shortUrl } from "../../lib/developer";
import { DELIVERIES_DEFAULT_SORT, developerKeys, useEndpoints, useEvents, type DeliveryDetail } from "../../lib/queries/developer";
import type { DeliveryStatus } from "../../lib/types";
import { DeliverySheet } from "./delivery-sheet";
import { DeliveryStatusPill, HttpStatus } from "./status";

const STATUSES: readonly DeliveryStatus[] = ["succeeded", "failed", "pending"];
/** URL prefix of the delivery-log table (the page also keeps `tab` in the URL). */
export const DELIVERIES_URL_PREFIX = "dl";
/** The endpoint filter's URL key (the webhooks tab links here with it). */
export const DELIVERIES_ENDPOINT_PARAM = `${DELIVERIES_URL_PREFIX}.endpointId`;

/**
 * Delivery log: server-paged table (sort by time, HTTP status, attempts; filter by status, event, endpoint and date).
 * The endpoint and event filter options come from the endpoint list and the event catalogue, so the table mounts once
 * both are loaded (its filters are read from the URL on mount).
 */
export function DeliveriesTab() {
  const endpoints = useEndpoints();
  const events = useEvents();
  const ready = (endpoints.data || endpoints.isError) && (events.data || events.isError);
  if (!ready) {
    return (
      <div className="grid gap-3" aria-busy="true">
        <Skeleton className="h-10 w-full max-w-sm" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }
  return (
    <DeliveriesTable
      endpoints={(endpoints.data?.items ?? []).map((e) => ({ id: e.id, url: e.url }))}
      eventTypes={["ping", ...(events.data?.items ?? []).map((e) => e.type)]}
    />
  );
}

function DeliveriesTable({ endpoints, eventTypes }: { endpoints: { id: string; url: string }[]; eventTypes: string[] }) {
  const { t, formatDate } = useI18n();
  const params = useQueryParams();
  const [open, setOpen] = React.useState<string | null>(null);

  // A link to a deleted endpoint (or an event type no longer in the catalogue) still filters.
  const linkedEndpoint = params.get(DELIVERIES_ENDPOINT_PARAM);
  const linkedType = params.get(`${DELIVERIES_URL_PREFIX}.type`);
  const urlOf = React.useMemo(() => new Map(endpoints.map((e) => [e.id, e.url])), [endpoints]);

  const filters = React.useMemo(() => {
    const endpointOptions = endpoints.map((e) => ({ value: e.id, label: shortUrl(e.url) }));
    for (const id of linkedEndpoint?.split(",") ?? []) if (id && !urlOf.has(id)) endpointOptions.push({ value: id, label: id.slice(0, 8) });
    const types = [...eventTypes];
    for (const ty of linkedType?.split(",") ?? []) if (ty && !types.includes(ty)) types.push(ty);
    return {
      status: {
        kind: "options",
        label: t("growth.common.status"),
        options: STATUSES.map((s) => ({ value: s, label: t(`growth.developer.deliveries.status.${s}`) })),
      },
      type: { kind: "options", label: t("growth.developer.deliveries.event"), options: types.map((x) => ({ value: x, label: x })) },
      endpointId: { kind: "options", label: t("growth.developer.deliveries.endpoint"), options: endpointOptions },
      date: { kind: "dateRange", label: t("growth.developer.deliveries.date"), presets: ["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth"] },
    } satisfies ServerFilterDefs;
  }, [t, endpoints, eventTypes, urlOf, linkedEndpoint, linkedType]);

  const when = React.useCallback(
    (iso: string) => formatDate(iso, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", second: "2-digit" }),
    [formatDate],
  );

  const columns = React.useMemo<DataTableColumn<DeliveryDetail>[]>(
    () => [
      {
        id: "event",
        header: t("growth.developer.deliveries.event"),
        hideable: false,
        card: "title",
        cell: (d) => (
          <button
            type="button"
            onClick={() => setOpen(d.id)}
            className="group flex w-full min-w-0 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0 flex-1">
              <code className="block truncate font-mono text-sm">{d.type}</code>
              <span className="block truncate text-xs text-muted-foreground">{shortUrl(urlOf.get(d.endpointId) ?? d.endpointId)}</span>
            </span>
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          </button>
        ),
        cardCell: (d) => <code className="font-mono text-sm">{d.type}</code>,
      },
      {
        id: "endpoint",
        header: t("growth.developer.deliveries.endpoint"),
        card: "subtitle",
        defaultHidden: true,
        cell: (d) => <span className="block max-w-[16rem] truncate font-mono text-xs">{shortUrl(urlOf.get(d.endpointId) ?? d.endpointId)}</span>,
        cardCell: (d) => shortUrl(urlOf.get(d.endpointId) ?? d.endpointId),
      },
      { id: "status", header: t("growth.common.status"), card: "right", width: "8.5rem", cell: (d) => <DeliveryStatusPill status={d.status} /> },
      {
        id: "statusCode",
        header: t("growth.developer.deliveries.response"),
        sortable: true,
        numeric: true,
        card: "meta",
        width: "7rem",
        cell: (d) => <HttpStatus status={d.responseStatus} />,
        cardCell: (d) => (d.responseStatus === null ? null : <HttpStatus status={d.responseStatus} />),
      },
      {
        id: "attempts",
        header: t("growth.developer.deliveries.attempts"),
        sortable: true,
        numeric: true,
        width: "7rem",
        cell: (d) => <span className="text-muted-foreground">{d.attempts}</span>,
      },
      {
        id: "time",
        header: t("growth.developer.deliveries.created"),
        sortable: true,
        sortDescFirst: true,
        card: "meta",
        width: "11rem",
        cell: (d) => <span className="whitespace-nowrap text-muted-foreground tabular-nums">{when(d.createdAt)}</span>,
      },
    ],
    [t, urlOf, when],
  );

  const st = useServerTable<DeliveryDetail, typeof filters>({
    queryKey: [...developerKeys.deliveries(), "table"],
    path: "/developer/deliveries",
    columns,
    filters,
    defaultSort: DELIVERIES_DEFAULT_SORT,
    defaultPageSize: DELIVERY_PAGE_SIZE,
    search: t("growth.developer.deliveries.search"),
    urlPrefix: DELIVERIES_URL_PREFIX,
    storageKey: "growth-developer-deliveries",
    getRowId: (d) => d.id,
  });

  const rows = st.query.data?.items;
  const filtered = st.table.activeFilterCount > 0;
  return (
    <div>
      <DataTableToolbar table={st.table}>
        <Button variant="outline" onClick={() => void st.query.refetch()} disabled={st.query.isFetching} aria-label={t("growth.developer.deliveries.refresh")}>
          <RefreshCwIcon className={cn(st.query.isFetching && "animate-spin")} />
          <span className="hidden sm:inline">{t("growth.developer.deliveries.refresh")}</span>
        </Button>
      </DataTableToolbar>
      <DataTable
        table={st.table}
        onRowClick={(d) => setOpen(d.id)}
        empty={
          filtered ? undefined : (
            <EmptyState compact icon={HistoryIcon} title={t("growth.developer.deliveries.emptyTitle")} description={t("growth.developer.deliveries.emptyBody")} />
          )
        }
      />
      <DeliverySheet
        id={open}
        endpointUrl={open ? urlOf.get(rows?.find((r) => r.id === open)?.endpointId ?? "") : undefined}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}
