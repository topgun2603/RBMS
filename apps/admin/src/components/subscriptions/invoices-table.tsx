"use client";

import * as React from "react";
import { BanIcon, CheckCircle2Icon, DownloadIcon, FileTextIcon, Loader2Icon, MoreHorizontalIcon, XCircleIcon } from "lucide-react";
import {
  Button,
  ChipGroup,
  DataTable,
  DataTableToolbar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  StatusPill,
  toast,
  type DataTableColumn,
} from "@rbms/ui";
import { apiDownload } from "@/lib/api";
import { describeError, useI18n } from "@/lib/i18n";
import { useSubsT } from "@/lib/subscriptions-messages";
import type { AdminPlatformInvoice } from "@/lib/types";
import { useServerTable, type ServerFilterDefs } from "@/lib/use-server-table";
import { INVOICES_KEY, VoidInvoiceDialog } from "./dialogs";

const STATUSES = ["paid", "void"] as const;

/**
 * Platform (RBMS → shop) tax invoices, server-paged: paid/void pills, date range, search, sort on number, date
 * and total; PDF and void per row. URL params are prefixed `inv.` (the page also holds the subscription table's).
 */
export function PlatformInvoicesTable() {
  const { t, formatCurrency, formatDate } = useI18n();
  const k = useSubsT();
  const [voiding, setVoiding] = React.useState<AdminPlatformInvoice | null>(null);
  const [downloading, setDownloading] = React.useState<string | null>(null);

  const pdf = React.useCallback(
    async (inv: AdminPlatformInvoice) => {
      setDownloading(inv.id);
      try {
        await apiDownload(`/subscriptions/admin/invoices/${inv.id}.pdf`, `${inv.number.replace(/[^\w-]+/g, "-")}.pdf`, { tenant: null });
        toast.success(k("admin.subs.inv.downloaded"));
      } catch (err) {
        toast.error(describeError(err, t));
      } finally {
        setDownloading(null);
      }
    },
    [k, t],
  );

  const filters = React.useMemo(
    () =>
      ({
        status: { kind: "options", label: k("admin.subs.inv.col.status"), hidden: true, options: STATUSES.map((s) => ({ value: s, label: k(`admin.subs.inv.status.${s}`) })) },
        date: { kind: "dateRange", label: k("admin.subs.inv.col.date") },
      }) satisfies ServerFilterDefs,
    [k],
  );

  const columns = React.useMemo<DataTableColumn<AdminPlatformInvoice>[]>(() => {
    const money = (p: number) => formatCurrency(p / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return [
      {
        id: "number",
        header: k("admin.subs.inv.col.number"),
        sortable: true,
        hideable: false,
        card: "title",
        cell: (inv) => (
          <div className="min-w-0">
            <div className={inv.status === "void" ? "font-mono text-sm font-medium line-through opacity-70" : "font-mono text-sm font-medium"}>{inv.number}</div>
            <div className="truncate text-xs text-muted-foreground sm:hidden">{inv.tenant?.name ?? inv.buyer.legalName}</div>
          </div>
        ),
        cardCell: (inv) => <span className={inv.status === "void" ? "font-mono line-through opacity-70" : "font-mono"}>{inv.number}</span>,
      },
      {
        id: "shop",
        header: k("admin.subs.inv.col.shop"),
        hideBelow: "sm",
        card: "subtitle",
        cell: (inv) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{inv.tenant?.name ?? inv.buyer.legalName}</div>
            <div className="truncate font-mono text-xs text-muted-foreground">{inv.buyer.gstin ?? inv.tenant?.slug ?? "—"}</div>
          </div>
        ),
        cardCell: (inv) => inv.tenant?.name ?? inv.buyer.legalName,
      },
      {
        id: "date",
        header: k("admin.subs.inv.col.date"),
        sortable: true,
        sortDescFirst: true,
        hideBelow: "md",
        card: "meta",
        cell: (inv) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(inv.date || inv.createdAt)}</span>,
      },
      {
        id: "gst",
        header: k("admin.subs.inv.col.gst"),
        hideBelow: "lg",
        numeric: true,
        cell: (inv) => (
          <div className="text-xs">
            <div>{money(inv.cgstPaise + inv.sgstPaise + inv.igstPaise)}</div>
            <div className="text-muted-foreground">{k(inv.igstPaise > 0 ? "admin.subs.inv.gst.inter" : "admin.subs.inv.gst.intra")}</div>
          </div>
        ),
      },
      {
        id: "total",
        header: k("admin.subs.inv.col.total"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (inv) => <span className="font-medium whitespace-nowrap">{money(inv.totalPaise)}</span>,
      },
      {
        id: "status",
        header: k("admin.subs.inv.col.status"),
        hideBelow: "sm",
        card: "meta",
        cell: (inv) => (
          <StatusPill tone={inv.status === "void" ? "neutral" : "success"} icon={inv.status === "void" ? XCircleIcon : CheckCircle2Icon}>
            {k(`admin.subs.inv.status.${inv.status}`)}
          </StatusPill>
        ),
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("admin.common.actions")}</span>,
        label: t("admin.common.actions"),
        hideable: false,
        align: "right",
        width: "48px",
        card: "right",
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
  }, [t, k, formatCurrency, formatDate, downloading, pdf]);

  const st = useServerTable<AdminPlatformInvoice, typeof filters>({
    queryKey: [...INVOICES_KEY, "table"],
    path: "/subscriptions/admin/invoices",
    columns,
    filters,
    defaultSort: "-date", // = PLATFORM_INVOICE_SORT default
    search: k("admin.subs.inv.search"),
    urlPrefix: "inv",
    storageKey: "admin-platform-invoices",
    getRowId: (inv) => inv.id,
  });

  const status = st.filters.status;
  const counts = st.facets?.status;
  return (
    <>
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            aria-label={k("admin.subs.inv.col.status")}
            size="sm"
            value={status.value.length === 1 ? status.value[0]! : "all"}
            onChange={(v) => status.set(v === "all" ? [] : [v])}
            options={[
              { value: "all", label: k("admin.subs.filter.all"), meta: counts ? (counts.paid ?? 0) + (counts.void ?? 0) : undefined },
              ...STATUSES.map((s) => ({ value: s, label: k(`admin.subs.inv.status.${s}`), meta: counts ? (counts[s] ?? 0) : undefined })),
            ]}
          />
        }
      >
        {st.total !== undefined && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{k("admin.subs.inv.count", { count: st.total })}</span>}
      </DataTableToolbar>
      <DataTable table={st.table} empty={<EmptyState compact icon={FileTextIcon} title={k("admin.subs.inv.empty")} description={k("admin.subs.inv.emptyHint")} />} />
      <VoidInvoiceDialog invoice={voiding} onClose={() => setVoiding(null)} />
    </>
  );
}
