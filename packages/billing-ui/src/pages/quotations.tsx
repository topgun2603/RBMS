"use client";

import * as React from "react";
import { ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, usePermission, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { FileSignatureIcon, PlusIcon } from "lucide-react";
import { Button, ChipGroup, cn, DataTable, DataTableToolbar, EmptyState, InitialsAvatar, type DataTableColumn } from "@srirealtime/ui";
import { QuotationStatusPill, useValidityText } from "../components/quotations/quotation-ui";
import { compactINR, money } from "../lib/format";
import { useQuotationSummary } from "../lib/queries-quotations";
import { QUOTATION_DISPLAY_STATUSES, type QuotationListResponse, type QuotationSummary } from "../lib/types-quotations";

export default function QuotationsPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <Quotations />
    </React.Suspense>
  );
}

function Quotations() {
  const { t, formatDate, formatNumber } = useI18n();
  const navigate = useModuleNavigate();
  const canManage = usePermission("quotations.manage");
  const validity = useValidityText();
  const summary = useQuotationSummary();

  const filters = React.useMemo(
    () =>
      ({
        status: { kind: "options", label: t("billing.q.list.status"), options: QUOTATION_DISPLAY_STATUSES.map((s) => ({ value: s, label: t(`billing.q.status.${s}`) })) },
        date: { kind: "dateRange", label: t("billing.q.list.col.date") },
        customerId: { kind: "text" },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<QuotationSummary>[]>(
    () => [
      {
        id: "number",
        header: t("billing.q.list.col.number"),
        sortable: true,
        hideable: false,
        card: "subtitle",
        cell: (q) => (
          <ModuleLink to={`quotations/${q.id}`} className="font-mono font-medium outline-none hover:text-primary hover:underline focus-visible:underline">
            {q.number}
            {q.rev > 1 && <span className="ml-1.5 text-xs font-sans font-normal text-muted-foreground">{t("billing.q.rev", { rev: q.rev })}</span>}
          </ModuleLink>
        ),
        cardCell: (q) => (
          <span>
            <span className="font-mono">{q.number}</span>
            {q.rev > 1 ? ` · ${t("billing.q.rev", { rev: q.rev })}` : ""} · {formatDate(q.date)}
          </span>
        ),
      },
      {
        id: "date",
        header: t("billing.q.list.col.date"),
        sortable: true,
        sortDescFirst: true,
        hideBelow: "md",
        cell: (q) => <span className="tabular-nums">{formatDate(q.date)}</span>,
      },
      {
        id: "customer",
        header: t("billing.q.list.col.customer"),
        hideable: false,
        card: "title",
        className: "max-w-[18rem]",
        cell: (q) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <InitialsAvatar name={q.customerName} size="sm" />
            <span className={cn("truncate font-medium", q.status === "cancelled" && "text-muted-foreground line-through")}>{q.customerName}</span>
          </div>
        ),
        cardCell: (q) => <span className={cn(q.status === "cancelled" && "text-muted-foreground line-through")}>{q.customerName}</span>,
      },
      {
        id: "validUntil",
        header: t("billing.q.list.col.validUntil"),
        sortable: true,
        hideBelow: "lg",
        card: "meta",
        cell: (q) => {
          const left = q.status === "sent" ? validity(q.daysLeft) : null;
          return (
            <span className="grid">
              <span className="tabular-nums">{formatDate(q.validUntil)}</span>
              {left && <span className={cn("text-xs", q.displayStatus === "expired" ? "text-warning-ink" : "text-muted-foreground")}>{left}</span>}
            </span>
          );
        },
        cardCell: (q) => {
          const left = q.status === "sent" ? validity(q.daysLeft) : null;
          return <span>{t("billing.q.validUntilShort", { date: formatDate(q.validUntil) })}{left ? ` · ${left}` : ""}</span>;
        },
      },
      {
        id: "status",
        header: t("billing.q.list.status"),
        card: "right",
        cell: (q) => <QuotationStatusPill status={q.displayStatus} />,
      },
      {
        id: "total",
        header: t("billing.q.list.col.total"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (q) => <span className="font-semibold">{money(q.total)}</span>,
      },
    ],
    [t, formatDate, validity],
  );

  const st = useServerTable<QuotationSummary, typeof filters>({
    queryKey: ["quotations", "list", "table"],
    path: "/quotations",
    columns,
    filters,
    defaultSort: "-date",
    search: t("billing.q.list.search"),
    storageKey: "billing-quotations",
  });

  const totals = (st.query.data as QuotationListResponse | undefined)?.totals;
  const status = st.filters.status;
  const counts = st.facets?.status;
  const pill = status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : "";
  const filtered = st.table.activeFilterCount > 0;
  const s = summary.data;

  const newButton = canManage ? (
    <Button asChild size="lg">
      <ModuleLink to="quotations/new">
        <PlusIcon /> {t("billing.q.new")}
      </ModuleLink>
    </Button>
  ) : undefined;

  return (
    <Page>
      <PageHeading icon={FileSignatureIcon} title={t("billing.q.list.title")} description={t("billing.q.list.subtitle")} actions={newButton} />

      {s && (s.open.count > 0 || s.acceptedThisMonth.count > 0 || s.sentLast90 > 0) && (
        <div className="mb-3 grid grid-cols-3 gap-2 rounded-2xl border border-card-ring bg-card p-3 shadow-elevated" aria-live="polite" data-testid="quote-summary">
          <Summary label={t("billing.q.summary.open")} value={compactINR(s.open.value)} title={money(s.open.value)} sub={t("billing.q.summary.openCount", { count: s.open.count })} />
          <Summary
            label={t("billing.q.summary.accepted")}
            value={compactINR(s.acceptedThisMonth.value)}
            title={money(s.acceptedThisMonth.value)}
            sub={t("billing.q.summary.acceptedCount", { count: s.acceptedThisMonth.count })}
            tone={s.acceptedThisMonth.count > 0 ? "text-success-ink" : undefined}
          />
          <Summary label={t("billing.q.summary.rate")} value={`${formatNumber(s.conversionRate)}%`} sub={t("billing.q.summary.rateHint", { count: s.sentLast90 })} />
        </div>
      )}

      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("billing.q.list.status")}
            value={pill}
            onChange={(v) => status.set(v === "all" ? [] : [v])}
            options={[
              { value: "all", label: t("billing.q.list.all") },
              ...QUOTATION_DISPLAY_STATUSES.map((x) => ({ value: x, label: t(`billing.q.status.${x}`), meta: counts ? counts[x] || undefined : undefined })),
            ]}
          />
        }
      />

      {totals && totals.count > 0 && filtered && (
        <p className="mb-2 text-meta text-muted-foreground tabular-nums">{t("billing.q.list.shown", { count: totals.count, total: money(totals.value) })}</p>
      )}

      <DataTable
        table={st.table}
        onRowClick={(q) => navigate(`quotations/${q.id}`)}
        empty={
          filtered ? undefined : (
            <EmptyState className="border-0 bg-transparent" icon={FileSignatureIcon} title={t("billing.q.list.emptyTitle")} description={t("billing.q.list.emptyBody")} action={newButton} />
          )
        }
      />
    </Page>
  );
}

function Summary({ label, value, title, sub, tone }: { label: string; value: string; title?: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0 text-center sm:text-left" title={title}>
      <p className="truncate text-xs text-muted-foreground sm:text-meta">{label}</p>
      <p className={cn("truncate font-heading text-lg font-bold tabular-nums", tone)}>{value}</p>
      {sub && <p className="truncate text-[0.6875rem] text-muted-foreground">{sub}</p>}
      {title && <span className="sr-only">{title}</span>}
    </div>
  );
}
