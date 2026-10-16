"use client";

import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BanIcon, CheckCircle2Icon, DownloadIcon, FileTextIcon, Loader2Icon, MoreHorizontalIcon, XCircleIcon } from "lucide-react";
import {
  Button,
  ChipGroup,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  StatusPill,
  toast,
  type DataTableColumn,
} from "@srirealtime/ui";
import { QueryError } from "@/components/query-state";
import { DebouncedSearch } from "@/components/search-input";
import { api, apiDownload } from "@/lib/api";
import { describeError, useI18n } from "@/lib/i18n";
import { useSubsT } from "@/lib/subscriptions-messages";
import type { AdminPlatformInvoice, Paged } from "@/lib/types";
import { INVOICES_KEY, VoidInvoiceDialog } from "./dialogs";

const PAGE = 25;

/** Platform (Srirealtime → shop) tax invoices: search, paid/void filter, PDF and void. */
export function PlatformInvoicesTable() {
  const { t, formatCurrency, formatDate } = useI18n();
  const k = useSubsT();
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<"all" | "paid" | "void">("all");
  const [page, setPage] = React.useState(0);
  const [voiding, setVoiding] = React.useState<AdminPlatformInvoice | null>(null);
  const [downloading, setDownloading] = React.useState<string | null>(null);

  const list = useQuery({
    queryKey: [...INVOICES_KEY, status, q, page],
    queryFn: () =>
      api.get<Paged<AdminPlatformInvoice>>("/subscriptions/admin/invoices", { status: status === "all" ? undefined : status, q, limit: PAGE, offset: page * PAGE }, { tenant: null }),
    placeholderData: keepPreviousData,
  });

  const money = (p: number) => formatCurrency(p / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const pdf = async (inv: AdminPlatformInvoice) => {
    setDownloading(inv.id);
    try {
      await apiDownload(`/subscriptions/admin/invoices/${inv.id}.pdf`, `${inv.number.replace(/[^\w-]+/g, "-")}.pdf`, { tenant: null });
      toast.success(k("admin.subs.inv.downloaded"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setDownloading(null);
    }
  };

  const columns: DataTableColumn<AdminPlatformInvoice>[] = [
    {
      id: "number",
      header: k("admin.subs.inv.col.number"),
      cell: (inv) => (
        <div className="min-w-0">
          <div className={inv.status === "void" ? "font-mono text-sm font-medium line-through opacity-70" : "font-mono text-sm font-medium"}>{inv.number}</div>
          <div className="truncate text-xs text-muted-foreground sm:hidden">{inv.tenant?.name ?? inv.buyer.legalName}</div>
        </div>
      ),
    },
    {
      id: "shop",
      header: k("admin.subs.inv.col.shop"),
      hideBelow: "sm",
      cell: (inv) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{inv.tenant?.name ?? inv.buyer.legalName}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">{inv.buyer.gstin ?? inv.tenant?.slug ?? "—"}</div>
        </div>
      ),
    },
    { id: "date", header: k("admin.subs.inv.col.date"), hideBelow: "md", cell: (inv) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(inv.date || inv.createdAt)}</span> },
    {
      id: "gst",
      header: k("admin.subs.inv.col.gst"),
      hideBelow: "lg",
      align: "right",
      cell: (inv) => (
        <div className="text-right text-xs">
          <div className="tabular-nums">{money(inv.cgstPaise + inv.sgstPaise + inv.igstPaise)}</div>
          <div className="text-muted-foreground">{k(inv.igstPaise > 0 ? "admin.subs.inv.gst.inter" : "admin.subs.inv.gst.intra")}</div>
        </div>
      ),
    },
    { id: "total", header: k("admin.subs.inv.col.total"), align: "right", cell: (inv) => <span className="font-medium whitespace-nowrap tabular-nums">{money(inv.totalPaise)}</span> },
    {
      id: "status",
      header: k("admin.subs.inv.col.status"),
      hideBelow: "sm",
      cell: (inv) => (
        <StatusPill tone={inv.status === "void" ? "neutral" : "success"} icon={inv.status === "void" ? XCircleIcon : CheckCircle2Icon}>
          {k(`admin.subs.inv.status.${inv.status}`)}
        </StatusPill>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("admin.common.actions")}</span>,
      align: "right",
      width: "48px",
      cell: (inv) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("admin.common.actions")} disabled={downloading === inv.id}>
              {downloading === inv.id ? <Loader2Icon className="animate-spin" /> : <MoreHorizontalIcon />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => void pdf(inv)}>
              <DownloadIcon /> {k("admin.subs.inv.pdf")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={inv.status === "void"} onSelect={() => setVoiding(inv)}>
              <BanIcon /> {k("admin.subs.inv.void")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <ChipGroup
          aria-label={k("admin.subs.inv.col.status")}
          size="sm"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(0);
          }}
          options={[
            { value: "all" as const, label: k("admin.subs.filter.all") },
            { value: "paid" as const, label: k("admin.subs.inv.status.paid") },
            { value: "void" as const, label: k("admin.subs.inv.status.void") },
          ]}
        />
        <div className="flex items-center gap-2 sm:ml-auto">
          <DebouncedSearch
            placeholder={k("admin.subs.inv.search")}
            onSearch={(v) => {
              setQ(v);
              setPage(0);
            }}
          />
          {list.data?.total !== undefined && <span className="shrink-0 text-xs text-muted-foreground">{k("admin.subs.inv.count", { count: list.data.total })}</span>}
        </div>
      </div>
      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={list.data?.items}
          loading={list.isLoading}
          getRowId={(inv) => inv.id}
          pagination={{ page, pageSize: PAGE, total: list.data?.total, onPageChange: setPage }}
          labels={{
            previous: t("admin.table.previous"),
            next: t("admin.table.next"),
            range: ({ from, to, total }) => (total !== undefined ? t("admin.table.range", { from, to, total }) : t("admin.table.rangeOpen", { from, to })),
          }}
          empty={<EmptyState compact icon={FileTextIcon} title={q ? t("admin.common.noResults") : k("admin.subs.inv.empty")} description={q ? undefined : k("admin.subs.inv.emptyHint")} />}
        />
      )}
      <VoidInvoiceDialog invoice={voiding} onClose={() => setVoiding(null)} />
    </>
  );
}
