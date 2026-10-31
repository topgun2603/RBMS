"use client";

import * as React from "react";
import { ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, useServerTable, type ServerFilterDefs } from "@rbms/web";
import { FileDownIcon, FilePlus2Icon, FileTextIcon } from "lucide-react";
import { Button, ChipGroup, cn, DataTable, DataTableToolbar, EmptyState, InitialsAvatar, type DataTableColumn } from "@rbms/ui";
import { DebitNoteStatusPill } from "../components/debit-notes/debit-note-ui";
import { FileButton } from "../components/gst/shared";
import { compactINR, money } from "../lib/format";
import { DEBIT_NOTE_REASONS, type DebitNoteSummary } from "../lib/types-debit-notes";

const STATUSES = ["issued", "cancelled"] as const;

interface DebitNoteTotals {
  count: number;
  issued: number;
  total: number;
  balance: number;
}

export default function DebitNotesPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <DebitNotes />
    </React.Suspense>
  );
}

function DebitNotes() {
  const { t, formatDate, formatNumber } = useI18n();
  const navigate = useModuleNavigate();

  const filters = React.useMemo(
    () =>
      ({
        status: { kind: "options", label: t("billing.dn.statusFilter"), options: STATUSES.map((s) => ({ value: s, label: t(`billing.dn.status.${s}`) })) },
        reason: { kind: "options", label: t("billing.dn.reason"), options: DEBIT_NOTE_REASONS.map((r) => ({ value: r, label: t(`billing.dn.reasons.${r}`) })) },
        date: { kind: "dateRange", label: t("billing.dn.col.date") },
        customerId: { kind: "text" },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<DebitNoteSummary>[]>(
    () => [
      {
        id: "number",
        header: t("billing.dn.col.number"),
        sortable: true,
        hideable: false,
        card: "subtitle",
        cell: (n) => (
          <ModuleLink to={`sales-debit-notes/${n.id}`} className="font-mono font-medium outline-none hover:text-primary hover:underline focus-visible:underline">
            {n.number}
          </ModuleLink>
        ),
        cardCell: (n) => (
          <span>
            <span className="font-mono">{n.number}</span> · {t("billing.dn.on", { number: n.invoiceNumber })} · {formatDate(n.date)}
          </span>
        ),
      },
      {
        id: "date",
        header: t("billing.dn.col.date"),
        sortable: true,
        sortDescFirst: true,
        cell: (n) => <span className="tabular-nums">{formatDate(n.date)}</span>,
      },
      {
        id: "customer",
        header: t("billing.dn.col.customer"),
        hideable: false,
        card: "title",
        className: "max-w-[18rem]",
        cell: (n) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <InitialsAvatar name={n.customerName} size="sm" />
            <span className={cn("truncate font-medium", n.status === "cancelled" && "text-muted-foreground line-through")}>{n.customerName}</span>
          </div>
        ),
        cardCell: (n) => <span className={cn(n.status === "cancelled" && "text-muted-foreground line-through")}>{n.customerName}</span>,
      },
      {
        id: "invoice",
        header: t("billing.dn.col.bill"),
        hideBelow: "md",
        cell: (n) => (
          <ModuleLink to={`invoices/${n.invoiceId}`} className="font-mono text-sm text-muted-foreground hover:text-primary hover:underline">
            {n.invoiceNumber}
          </ModuleLink>
        ),
      },
      {
        id: "reason",
        header: t("billing.dn.reason"),
        hideBelow: "lg",
        card: "meta",
        cell: (n) => t(`billing.dn.reasons.${n.reason}`),
      },
      {
        id: "balance",
        header: t("billing.dn.col.balance"),
        numeric: true,
        hideBelow: "md",
        cell: (n) => (n.balance > 0 ? <span className="text-warning-ink">{money(n.balance)}</span> : <span className="text-muted-foreground">—</span>),
      },
      {
        id: "status",
        header: t("billing.dn.statusFilter"),
        card: "right",
        cell: (n) => <DebitNoteStatusPill status={n.status} />,
      },
      {
        id: "total",
        header: t("billing.dn.col.total"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (n) => <span className="font-semibold">+{money(n.total)}</span>,
      },
    ],
    [t, formatDate],
  );

  const st = useServerTable<DebitNoteSummary, typeof filters>({
    queryKey: ["sales-debit-notes", "list", "table"],
    path: "/invoices/debit-notes",
    columns,
    filters,
    defaultSort: "-date",
    search: t("billing.dn.search"),
    storageKey: "billing-sales-debit-notes",
  });

  const totals = (st.query.data as { totals?: DebitNoteTotals } | undefined)?.totals;
  const status = st.filters.status;
  const counts = st.facets?.status;
  const pill = status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : "";
  const filtered = st.table.activeFilterCount > 0;
  const { limit: _l, offset: _o, ...csvParams } = st.apiParams;

  const billsButton = (
    <Button asChild variant="outline" size="lg">
      <ModuleLink to="invoices">
        <FileTextIcon /> {t("billing.dn.toBills")}
      </ModuleLink>
    </Button>
  );

  return (
    <Page>
      <PageHeading
        icon={FilePlus2Icon}
        title={t("billing.dn.title")}
        description={t("billing.dn.subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <FileButton path="/invoices/debit-notes" params={{ ...csvParams, format: "csv" }} fileName="debit-notes.csv" label={t("billing.dn.csv")} icon={<FileDownIcon />} />
            {billsButton}
          </div>
        }
      />

      {totals && totals.count > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2 rounded-2xl border border-card-ring bg-card p-3 shadow-elevated" aria-live="polite">
          <Summary label={t("billing.dn.count")} value={formatNumber(totals.issued)} />
          <Summary label={t("billing.dn.totalShown")} value={compactINR(totals.total)} title={money(totals.total)} />
          <Summary label={t("billing.dn.balanceShown")} value={compactINR(totals.balance)} title={money(totals.balance)} tone={totals.balance > 0 ? "text-warning-ink" : undefined} />
        </div>
      )}

      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("billing.dn.statusFilter")}
            value={pill}
            onChange={(v) => status.set(v === "all" ? [] : [v])}
            options={[
              { value: "all", label: t("billing.dn.allStatuses") },
              ...STATUSES.map((s) => ({ value: s, label: t(`billing.dn.status.${s}`), meta: counts ? counts[s] || undefined : undefined })),
            ]}
          />
        }
      />

      <DataTable
        table={st.table}
        onRowClick={(n) => navigate(`sales-debit-notes/${n.id}`)}
        empty={
          filtered ? undefined : (
            <EmptyState className="border-0 bg-transparent" icon={FilePlus2Icon} title={t("billing.dn.emptyTitle")} description={t("billing.dn.emptyBody")} action={billsButton} />
          )
        }
      />
    </Page>
  );
}

function Summary({ label, value, title, tone }: { label: string; value: string; title?: string; tone?: string }) {
  return (
    <div className="min-w-0 text-center sm:text-left" title={title}>
      <p className="truncate text-xs text-muted-foreground sm:text-meta">{label}</p>
      <p className={cn("truncate font-heading text-lg font-bold tabular-nums", tone)}>{value}</p>
      {title && <span className="sr-only">{title}</span>}
    </div>
  );
}
