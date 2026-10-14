"use client";

import * as React from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, FileLockIcon, Loader2Icon, PlayIcon, Trash2Icon } from "lucide-react";
import {
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  type DataTableColumn,
} from "@srirealtime/ui";
import { StatusBadge } from "@/components/badges";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { SuperAdminOnly } from "@/components/superadmin-only";
import { api } from "@/lib/api";
import { describeError, tOr, useI18n } from "@/lib/i18n";
import type { DataRequest, DataRequestStatus } from "@/lib/types";

const PAGE = 50;
const STATUSES: DataRequestStatus[] = ["pending", "processing", "completed", "cancelled", "failed"];

export default function PrivacyRequestsPage() {
  return (
    <SuperAdminOnly>
      <RequestsList />
    </SuperAdminOnly>
  );
}

function RequestsList() {
  const { t, formatDateTime, formatRelative } = useI18n();
  const qc = useQueryClient();
  const [status, setStatus] = React.useState<"all" | DataRequestStatus>("all");
  const [type, setType] = React.useState<"all" | "export" | "delete">("all");
  const [page, setPage] = React.useState(0);

  const requests = useQuery({
    queryKey: ["platform", "consent-requests", status, type, page],
    queryFn: () =>
      api
        .get<{ items: DataRequest[] }>(
          "/consent/requests",
          { status: status === "all" ? undefined : status, type: type === "all" ? undefined : type, limit: PAGE, offset: page * PAGE },
          { tenant: null },
        )
        .then((r) => r.items),
    placeholderData: keepPreviousData,
  });

  const processDue = useMutation({
    mutationFn: () => api.post<Record<string, unknown>>("/consent/requests/process-due", undefined, { tenant: null }),
    onSuccess: (r) => {
      const n = typeof r?.processed === "number" ? r.processed : Array.isArray(r?.items) ? r.items.length : null;
      toast.success(n === null ? t("admin.platform.processed") : t("admin.platform.processedCount", { count: n }));
      void qc.invalidateQueries({ queryKey: ["platform", "consent-requests"] });
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const columns: DataTableColumn<DataRequest>[] = [
    {
      id: "type",
      header: t("admin.platform.requestType"),
      cell: (r) => (
        <span className="flex items-center gap-2">
          {r.type === "export" ? <DownloadIcon className="size-4 text-muted-foreground" /> : <Trash2Icon className="size-4 text-destructive" />}
          {tOr(t, `admin.platform.requestTypes.${r.type}`, r.type)}
        </span>
      ),
    },
    { id: "user", header: t("admin.platform.user"), cell: (r) => <span className="font-mono text-xs">{r.userId}</span> },
    { id: "status", header: t("admin.common.status"), cell: (r) => <StatusBadge status={r.status} /> },
    {
      id: "scheduled",
      header: t("admin.platform.scheduledFor"),
      hideBelow: "md",
      cell: (r) => <span className="text-muted-foreground">{formatDateTime(r.scheduledFor)}</span>,
    },
    {
      id: "created",
      header: t("admin.common.created"),
      align: "right",
      hideBelow: "sm",
      cell: (r) => (
        <span className="text-muted-foreground" title={r.error ?? undefined}>
          {formatRelative(r.createdAt)}
        </span>
      ),
    },
  ];

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
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={type}
          onValueChange={(v) => {
            setType(v as typeof type);
            setPage(0);
          }}
        >
          <SelectTrigger size="sm" className="w-40" aria-label={t("admin.platform.requestType")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.common.allTypes")}</SelectItem>
            <SelectItem value="export">{t("admin.platform.requestTypes.export")}</SelectItem>
            <SelectItem value="delete">{t("admin.platform.requestTypes.delete")}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as typeof status);
            setPage(0);
          }}
        >
          <SelectTrigger size="sm" className="w-40" aria-label={t("admin.common.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.common.allStatuses")}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {tOr(t, `admin.status.${s}`, s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {requests.isError ? (
        <QueryError error={requests.error} onRetry={() => void requests.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={requests.data}
          loading={requests.isLoading}
          getRowId={(r) => r.id}
          pagination={{ page, pageSize: PAGE, hasNext: (requests.data?.length ?? 0) === PAGE, onPageChange: setPage }}
          labels={{
            previous: t("admin.table.previous"),
            next: t("admin.table.next"),
            range: ({ from, to }) => t("admin.table.rangeOpen", { from, to }),
          }}
          empty={<EmptyState compact icon={FileLockIcon} title={t("admin.platform.noRequests")} />}
        />
      )}
    </Page>
  );
}
