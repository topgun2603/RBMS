"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, FileLockIcon, Loader2Icon, PlayIcon, Trash2Icon } from "lucide-react";
import { Button, DataTable, DataTableToolbar, EmptyState, PageHeader, toast, type DataTableColumn } from "@srirealtime/ui";
import { StatusBadge } from "@/components/badges";
import { Page } from "@/components/page";
import { SuperAdminOnly } from "@/components/superadmin-only";
import { api } from "@/lib/api";
import { describeError, tOr, useI18n } from "@/lib/i18n";
import type { DataRequest, DataRequestStatus } from "@/lib/types";
import { useServerTable, type ServerFilterDefs } from "@/lib/use-server-table";

/** Filter values of GET /v1/consent/requests (packages/consent/src/list.ts). */
const STATUSES: DataRequestStatus[] = ["pending", "processing", "completed", "cancelled", "failed"];
const TYPES = ["export", "delete"] as const;
const REQUESTS_KEY = ["platform", "consent-requests"] as const;

export default function PrivacyRequestsPage() {
  return (
    <SuperAdminOnly>
      {/* useServerTable reads the search params, which needs a Suspense boundary. */}
      <React.Suspense fallback={null}>
        <RequestsList />
      </React.Suspense>
    </SuperAdminOnly>
  );
}

function RequestsList() {
  const { t, formatDateTime, formatRelative } = useI18n();
  const qc = useQueryClient();

  const processDue = useMutation({
    mutationFn: () => api.post<Record<string, unknown>>("/consent/requests/process-due", undefined, { tenant: null }),
    onSuccess: (r) => {
      const n = typeof r?.processed === "number" ? r.processed : Array.isArray(r?.items) ? r.items.length : null;
      toast.success(n === null ? t("admin.platform.processed") : t("admin.platform.processedCount", { count: n }));
      void qc.invalidateQueries({ queryKey: REQUESTS_KEY });
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const filters = React.useMemo(
    () =>
      ({
        type: { kind: "options", label: t("admin.platform.requestType"), options: TYPES.map((v) => ({ value: v, label: tOr(t, `admin.platform.requestTypes.${v}`, v) })) },
        status: { kind: "options", label: t("admin.common.status"), options: STATUSES.map((s) => ({ value: s, label: tOr(t, `admin.status.${s}`, s) })) },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<DataRequest>[]>(
    () => [
      {
        id: "type",
        header: t("admin.platform.requestType"),
        sortable: true,
        hideable: false,
        card: "title",
        cell: (r) => (
          <span className="flex items-center gap-2">
            {r.type === "export" ? <DownloadIcon className="size-4 text-muted-foreground" /> : <Trash2Icon className="size-4 text-destructive" />}
            {tOr(t, `admin.platform.requestTypes.${r.type}`, r.type)}
          </span>
        ),
      },
      {
        id: "user",
        header: t("admin.platform.user"),
        card: "subtitle",
        cell: (r) => <span className="font-mono text-xs break-all">{r.userId}</span>,
      },
      { id: "status", header: t("admin.common.status"), sortable: true, card: "right", cell: (r) => <StatusBadge status={r.status} /> },
      {
        id: "scheduled",
        header: t("admin.platform.scheduledFor"),
        sortable: true,
        hideBelow: "md",
        card: "meta",
        cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.scheduledFor)}</span>,
      },
      {
        id: "created",
        header: t("admin.common.created"),
        sortable: true,
        sortDescFirst: true,
        align: "right",
        hideBelow: "sm",
        card: "meta",
        cell: (r) => (
          <span className="whitespace-nowrap text-muted-foreground" title={r.error ?? undefined}>
            {formatRelative(r.createdAt)}
          </span>
        ),
      },
    ],
    [t, formatDateTime, formatRelative],
  );

  const st = useServerTable<DataRequest, typeof filters>({
    queryKey: [...REQUESTS_KEY, "table"],
    path: "/consent/requests",
    columns,
    filters,
    defaultSort: "-created", // = DATA_REQUEST_SORT default
    search: t("admin.platform.searchRequests"),
    storageKey: "admin-platform-privacy-requests",
    getRowId: (r) => r.id,
  });

  return (
    <Page>
      <PageHeader
        eyebrow={t("admin.nav.platform")}
        title={t("admin.platform.requestsTitle")}
        description={t("admin.platform.requestsSubtitle")}
        actions={
          <Button onClick={() => processDue.mutate()} disabled={processDue.isPending}>
            {processDue.isPending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
            {t("admin.platform.processDue")}
          </Button>
        }
      />
      <DataTableToolbar table={st.table}>
        {st.total !== undefined && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{t("admin.platform.requestCount", { count: st.total })}</span>}
      </DataTableToolbar>
      <DataTable table={st.table} empty={<EmptyState compact icon={FileLockIcon} title={t("admin.platform.noRequests")} />} />
    </Page>
  );
}
