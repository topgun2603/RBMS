"use client";

import * as React from "react";
import { ChevronRightIcon, FilterXIcon, HistoryIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import {
  Button,
  Card,
  cn,
  DataTable,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  FieldRow,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type DataTableColumn,
} from "@srirealtime/ui";
import { QueryError, useI18n } from "@srirealtime/web";
import { shortUrl } from "../../lib/developer";
import { useDeliveries, useEndpoints, useEvents, type DeliveryDetail, type DeliveryFilters } from "../../lib/queries/developer";
import type { DeliveryStatus } from "../../lib/types";
import { DeliverySheet } from "./delivery-sheet";
import { DeliveryStatusPill, HttpStatus } from "./status";

const ANY = "__any";
const STATUSES: readonly DeliveryStatus[] = ["pending", "succeeded", "failed"];
export function DeliveriesTab({ endpointId, onEndpointChange }: { endpointId: string | undefined; onEndpointChange: (id: string | undefined) => void }) {
  const { t, formatDate } = useI18n();
  const endpoints = useEndpoints();
  const events = useEvents();
  const [status, setStatus] = React.useState<DeliveryStatus | undefined>();
  const [type, setType] = React.useState<string | undefined>();
  const [open, setOpen] = React.useState<string | null>(null);

  const filters = React.useMemo<DeliveryFilters>(() => ({ endpointId, status, type }), [endpointId, status, type]);
  const q = useDeliveries(filters);
  const rows = React.useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const total = q.data?.pages[0]?.total;
  const urlOf = React.useMemo(() => new Map((endpoints.data?.items ?? []).map((e) => [e.id, e.url])), [endpoints.data]);
  const filtered = !!endpointId || !!status || !!type;
  const eventTypes = React.useMemo(() => ["ping", ...(events.data?.items ?? []).map((e) => e.type)], [events.data]);

  const when = (iso: string) => formatDate(iso, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", second: "2-digit" });
  const columns: DataTableColumn<DeliveryDetail>[] = [
    {
      id: "event",
      header: t("growth.developer.deliveries.event"),
      cell: (d) => (
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            setOpen(d.id);
          }}
          className="group flex w-full min-w-0 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1">
            <code className="block truncate font-mono text-sm">{d.type}</code>
            <span className="block truncate text-xs text-muted-foreground">
              <span className="md:hidden">{when(d.createdAt)} · </span>
              {shortUrl(urlOf.get(d.endpointId) ?? d.endpointId)}
            </span>
          </span>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </button>
      ),
    },
    { id: "status", header: t("growth.common.status"), cell: (d) => <DeliveryStatusPill status={d.status} />, width: "8.5rem" },
    { id: "http", header: t("growth.developer.deliveries.response"), cell: (d) => <HttpStatus status={d.responseStatus} />, hideBelow: "sm", width: "6rem" },
    {
      id: "attempts",
      header: t("growth.developer.deliveries.attempts"),
      cell: (d) => <span className="tabular-nums text-muted-foreground">{d.attempts}</span>,
      hideBelow: "lg",
      align: "right",
      width: "6rem",
    },
    {
      id: "time",
      header: t("growth.developer.deliveries.created"),
      cell: (d) => <span className="whitespace-nowrap text-muted-foreground tabular-nums">{when(d.createdAt)}</span>,
      hideBelow: "md",
      width: "11rem",
    },
  ];

  return (
    <div className="grid gap-4">
      <Card className="gap-3 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <HistoryIcon className="size-4 text-primary" />
            {t("growth.developer.deliveries.title")}
          </h2>
          <div className="flex gap-2">
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onEndpointChange(undefined);
                  setStatus(undefined);
                  setType(undefined);
                }}
              >
                <FilterXIcon /> {t("growth.developer.deliveries.clear")}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
              <RefreshCwIcon className={cn(q.isFetching && "animate-spin")} /> {t("growth.developer.deliveries.refresh")}
            </Button>
          </div>
        </div>
        <FieldRow cols={3}>
          <Field>
            <FieldLabel>{t("growth.developer.deliveries.endpoint")}</FieldLabel>
            <FieldControl>
              <Select value={endpointId ?? ANY} onValueChange={(v) => onEndpointChange(v === ANY ? undefined : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t("growth.developer.deliveries.anyEndpoint")}</SelectItem>
                  {(endpoints.data?.items ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      <span className="truncate font-mono text-xs">{shortUrl(e.url)}</span>
                    </SelectItem>
                  ))}
                  {endpointId && !urlOf.has(endpointId) && <SelectItem value={endpointId}>{endpointId.slice(0, 8)}</SelectItem>}
                </SelectContent>
              </Select>
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>{t("growth.common.status")}</FieldLabel>
            <FieldControl>
              <Select value={status ?? ANY} onValueChange={(v) => setStatus(v === ANY ? undefined : (v as DeliveryStatus))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t("growth.developer.deliveries.anyStatus")}</SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`growth.developer.deliveries.status.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>{t("growth.developer.deliveries.event")}</FieldLabel>
            <FieldControl>
              <Select value={type ?? ANY} onValueChange={(v) => setType(v === ANY ? undefined : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t("growth.developer.deliveries.anyEvent")}</SelectItem>
                  {eventTypes.map((e) => (
                    <SelectItem key={e} value={e}>
                      <code className="font-mono text-xs">{e}</code>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldControl>
          </Field>
        </FieldRow>
      </Card>

      {q.isError && !q.data ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className={cn("grid gap-3 transition-opacity", q.isPlaceholderData && "opacity-60")}>
          {total !== undefined && <p className="text-xs text-muted-foreground">{t("growth.developer.deliveries.count", { count: total })}</p>}
          <DataTable
            columns={columns}
            data={rows}
            loading={q.isPending}
            getRowId={(d) => d.id}
            onRowClick={(d) => setOpen(d.id)}
            skeletonRows={6}
            empty={
              <EmptyState
                compact
                icon={HistoryIcon}
                title={filtered ? t("growth.developer.deliveries.noMatch") : t("growth.developer.deliveries.emptyTitle")}
                description={filtered ? undefined : t("growth.developer.deliveries.emptyBody")}
              />
            }
          />
          {q.hasNextPage && (
            <Button variant="outline" className="justify-self-center" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              {q.isFetchingNextPage && <Loader2Icon className="animate-spin" />}
              {t("growth.common.loadMore")}
            </Button>
          )}
        </div>
      )}

      <DeliverySheet id={open} endpointUrl={open ? urlOf.get(rows.find((r) => r.id === open)?.endpointId ?? "") : undefined} onClose={() => setOpen(null)} />
    </div>
  );
}
