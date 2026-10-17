"use client";

import * as React from "react";
import { ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { FileTextIcon, Undo2Icon } from "lucide-react";
import { Button, ChipGroup, cn, DataTable, DataTableToolbar, EmptyState, InitialsAvatar, type DataTableColumn } from "@srirealtime/ui";
import { CreditNoteStatusPill } from "../components/credit-notes/credit-note-ui";
import { compactINR, money } from "../lib/format";
import type { CreditNoteSummary } from "../lib/types";

const STATUSES = ["issued", "cancelled"] as const;
const REASONS = ["return", "price_correction", "discount", "other"] as const;
const MODES = ["cash", "upi", "card", "credit_book", "none"] as const;

interface CreditNoteTotals {
  count: number;
  issued?: number;
  total: number;
  refunded?: number;
}

export default function CreditNotesPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <CreditNotes />
    </React.Suspense>
  );
}

function CreditNotes() {
  const { t, formatDate, formatNumber } = useI18n();
  const navigate = useModuleNavigate();

  const filters = React.useMemo(
    () =>
      ({
        status: { kind: "options", label: t("billing.cn.statusFilter"), options: STATUSES.map((s) => ({ value: s, label: t(`billing.cn.status.${s}`) })) },
        reason: { kind: "options", label: t("billing.cn.reason"), options: REASONS.map((r) => ({ value: r, label: t(`billing.cn.reasons.${r}`) })) },
        refundMode: { kind: "options", label: t("billing.cn.refundMode"), options: MODES.map((m) => ({ value: m, label: t(`billing.cn.modes.${m}`) })) },
        date: { kind: "dateRange", label: t("billing.cn.col.date") },
        customerId: { kind: "text" },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<CreditNoteSummary>[]>(
    () => [
      {
        id: "number",
        header: t("billing.cn.col.number"),
        sortable: true,
        hideable: false,
        card: "subtitle",
        cell: (n) => (
          <ModuleLink to={`credit-notes/${n.id}`} className="font-mono font-medium outline-none hover:text-primary hover:underline focus-visible:underline">
            {n.number}
          </ModuleLink>
        ),
        cardCell: (n) => (
          <span>
            <span className="font-mono">{n.number}</span> · {t("billing.cn.against", { number: n.invoiceNumber })} · {formatDate(n.date)}
          </span>
        ),
      },
      {
        id: "date",
        header: t("billing.cn.col.date"),
        sortable: true,
        sortDescFirst: true,
        cell: (n) => <span className="tabular-nums">{formatDate(n.date)}</span>,
      },
      {
        id: "customer",
        header: t("billing.cn.col.customer"),
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
        header: t("billing.cn.col.bill"),
        hideBelow: "md",
        cell: (n) => (
          <ModuleLink to={`invoices/${n.invoiceId}`} className="font-mono text-sm text-muted-foreground hover:text-primary hover:underline">
            {n.invoiceNumber}
          </ModuleLink>
        ),
      },
      {
        id: "reason",
        header: t("billing.cn.reason"),
        hideBelow: "lg",
        card: "meta",
        cell: (n) => t(`billing.cn.reasons.${n.reason}`),
      },
      {
        id: "refund",
        header: t("billing.cn.col.refund"),
        sortable: true,
        numeric: true,
        card: "meta",
        cell: (n) =>
          n.refundAmount > 0 ? (
            <span className="grid">
              <span className="text-warning-ink">{money(n.refundAmount)}</span>
              <span className="text-xs text-muted-foreground">{t(`billing.cn.modes.${n.refundMode}`)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{t(`billing.cn.modes.${n.refundMode}`)}</span>
          ),
        cardCell: (n) =>
          n.refundAmount > 0 ? (
            <span className="tabular-nums">{t("billing.cn.refundedIn", { amount: money(n.refundAmount), mode: t(`billing.cn.modes.${n.refundMode}`) })}</span>
          ) : (
            t(`billing.cn.modes.${n.refundMode}`)
          ),
      },
      {
        id: "status",
        header: t("billing.cn.statusFilter"),
        card: "right",
        cell: (n) => <CreditNoteStatusPill status={n.status} />,
      },
      {
        id: "total",
        header: t("billing.cn.col.total"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (n) => <span className="font-semibold">−{money(n.total)}</span>,
      },
    ],
    [t, formatDate],
  );

  const st = useServerTable<CreditNoteSummary, typeof filters>({
    queryKey: ["credit-notes", "list", "table"],
    path: "/invoices/credit-notes",
    columns,
    filters,
    defaultSort: "-date",
    search: t("billing.cn.search"),
    storageKey: "billing-credit-notes",
  });

  const totals = (st.query.data as { totals?: CreditNoteTotals } | undefined)?.totals;
  const status = st.filters.status;
  const counts = st.facets?.status;
  const pill = status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : "";
  const filtered = st.table.activeFilterCount > 0;

  const billsButton = (
    <Button asChild variant="outline" size="lg">
      <ModuleLink to="invoices">
        <FileTextIcon /> {t("billing.cn.toBills")}
      </ModuleLink>
    </Button>
  );

  return (
    <Page>
      <PageHeading icon={Undo2Icon} title={t("billing.cn.title")} description={t("billing.cn.subtitle")} actions={billsButton} />

      {totals && totals.count > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2 rounded-2xl border border-card-ring bg-card p-3 shadow-elevated" aria-live="polite">
          <Summary label={t("billing.cn.count")} value={formatNumber(totals.issued ?? totals.count)} />
          <Summary label={t("billing.cn.totalShown")} value={compactINR(totals.total)} title={money(totals.total)} />
          <Summary
            label={t("billing.cn.refundedShown")}
            value={compactINR(totals.refunded ?? 0)}
            title={money(totals.refunded ?? 0)}
            tone={(totals.refunded ?? 0) > 0 ? "text-warning-ink" : undefined}
          />
        </div>
      )}

      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("billing.cn.statusFilter")}
            value={pill}
            onChange={(v) => status.set(v === "all" ? [] : [v])}
            options={[
              { value: "all", label: t("billing.cn.allStatuses") },
              ...STATUSES.map((s) => ({ value: s, label: t(`billing.cn.status.${s}`), meta: counts ? counts[s] || undefined : undefined })),
            ]}
          />
        }
      />

      <DataTable
        table={st.table}
        onRowClick={(n) => navigate(`credit-notes/${n.id}`)}
        empty={
          filtered ? undefined : (
            <EmptyState className="border-0 bg-transparent" icon={Undo2Icon} title={t("billing.cn.emptyTitle")} description={t("billing.cn.emptyBody")} action={billsButton} />
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
