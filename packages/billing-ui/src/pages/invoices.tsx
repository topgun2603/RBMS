"use client";

import * as React from "react";
import {
  ModuleLink,
  MULTI_BRANCH_FEATURE,
  Page,
  PageHeading,
  useFeature,
  useI18n,
  useModuleNavigate,
  useMyBranches,
  useServerTable,
  type ServerFilterDefs,
} from "@srirealtime/web";
import { FilePlus2Icon, FileTextIcon, PlusIcon, Undo2Icon } from "lucide-react";
import { Button, ChipGroup, cn, DataTable, DataTableToolbar, EmptyState, InitialsAvatar, type DataTableColumn } from "@srirealtime/ui";
import { BillsIllustration } from "../components/illustrations";
import { StatusBadge } from "../components/status-badge";
import { money } from "../lib/format";
import type { InvoiceSummary } from "../lib/types";

const STATUSES = ["draft", "issued", "partially_paid", "overdue", "paid", "cancelled"] as const;
const METHODS = ["cash", "upi", "card", "bank", "cheque", "other"] as const;

const isOpen = (inv: InvoiceSummary) => inv.status === "issued" || inv.status === "partially_paid";

export default function InvoicesPage() {
  return (
    <React.Suspense fallback={null}>
      <InvoicesList />
    </React.Suspense>
  );
}

function InvoicesList() {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const multiBranch = useFeature(MULTI_BRANCH_FEATURE);
  const branches = useMyBranches();
  const branchList = React.useMemo(() => (multiBranch ? (branches.data?.items ?? []) : []), [multiBranch, branches.data]);
  const branchName = React.useMemo(() => new Map(branchList.map((b) => [b.id, b.name])), [branchList]);

  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("billing.invoices.filterStatus"),
          options: STATUSES.map((s) => ({ value: s, label: t(`billing.status.${s}`) })),
        },
        date: { kind: "dateRange", label: t("billing.invoices.filterDate") },
        method: {
          kind: "options",
          label: t("billing.payment.method"),
          options: METHODS.map((m) => ({ value: m, label: t(`billing.payment.methods.${m}`) })),
        },
        branchId: {
          kind: "options",
          label: t("billing.invoices.filterBranch"),
          options: branchList.map((b) => ({ value: b.id, label: b.name })),
          dynamic: true,
          hidden: branchList.length < 2,
        },
        customerId: { kind: "text" },
      }) satisfies ServerFilterDefs,
    [t, branchList],
  );

  const columns = React.useMemo<DataTableColumn<InvoiceSummary>[]>(
    () => [
      {
        id: "number",
        header: t("billing.invoices.col.number"),
        sortable: true,
        hideable: false,
        card: "subtitle",
        cell: (inv) => (
          <ModuleLink to={`invoices/${inv.id}`} className="font-medium tabular-nums outline-none hover:text-primary hover:underline focus-visible:underline">
            {inv.number ?? <span className="text-muted-foreground">{t("billing.status.draft")}</span>}
          </ModuleLink>
        ),
        cardCell: (inv) => (
          <span className="tabular-nums">
            {inv.number ?? t("billing.status.draft")} · {formatDate(inv.date)}
          </span>
        ),
      },
      {
        id: "date",
        header: t("billing.invoices.col.date"),
        sortable: true,
        sortDescFirst: true,
        cell: (inv) => (
          <div className="grid">
            <span className="tabular-nums">{formatDate(inv.date)}</span>
            {inv.dueDate && isOpen(inv) && (
              <span className={cn("text-xs text-muted-foreground tabular-nums", inv.isOverdue && "font-medium text-danger-ink")}>
                {t("billing.invoices.due", { date: formatDate(inv.dueDate) })}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "customer",
        header: t("billing.invoices.col.customer"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[18rem]",
        cell: (inv) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <InitialsAvatar name={inv.customerName} size="sm" />
            <span className={cn("truncate font-medium", inv.status === "cancelled" && "text-muted-foreground line-through")}>{inv.customerName}</span>
          </div>
        ),
        cardCell: (inv) => <span className={cn(inv.status === "cancelled" && "text-muted-foreground line-through")}>{inv.customerName}</span>,
      },
      ...(branchList.length > 1
        ? [
            {
              id: "branch",
              header: t("billing.invoices.col.branch"),
              hideBelow: "lg",
              cell: (inv: InvoiceSummary) => <span className="text-muted-foreground">{(inv.branchId && branchName.get(inv.branchId)) || "—"}</span>,
            } satisfies DataTableColumn<InvoiceSummary>,
          ]
        : []),
      {
        id: "status",
        header: t("billing.invoices.col.status"),
        sortable: true,
        card: "right",
        cell: (inv) => <StatusBadge status={inv.status} overdue={inv.isOverdue} />,
      },
      {
        id: "total",
        header: t("billing.invoices.col.total"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (inv) => <span className="font-semibold">{money(inv.total)}</span>,
      },
      {
        id: "balance",
        header: t("billing.invoices.col.balance"),
        sortable: true,
        numeric: true,
        card: "meta",
        cell: (inv) => (isOpen(inv) && inv.balance > 0 ? money(inv.balance) : <span className="text-muted-foreground">—</span>),
        cardCell: (inv) =>
          isOpen(inv) && inv.balance > 0 && inv.balance !== inv.total ? (
            <span className="tabular-nums">{t("billing.invoices.balanceShort", { amount: money(inv.balance) })}</span>
          ) : null,
      },
    ],
    [t, formatDate, branchList, branchName],
  );

  const st = useServerTable<InvoiceSummary, typeof filters>({
    queryKey: ["invoices", "list", "table"],
    path: "/invoices",
    columns,
    filters,
    defaultSort: "-date",
    search: t("billing.invoices.search"),
    storageKey: "billing-invoices",
  });

  // Status pills: a quick single-status view of the same `status` filter (counts from the API's facets).
  const status = st.filters.status;
  const counts = st.facets?.status;
  const allCount = counts ? Object.entries(counts).reduce((n, [k, v]) => (k === "overdue" ? n : n + v), 0) : undefined;
  const pill = status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : "";
  const filtered = st.table.activeFilterCount > 0;

  return (
    <Page>
      <PageHeading
        icon={FileTextIcon}
        title={t("billing.invoices.title")}
        description={st.total !== undefined ? t("billing.invoices.count", { count: st.total }) : undefined}
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <ModuleLink to="credit-notes">
                <Undo2Icon /> {t("billing.nav.creditNotes")}
              </ModuleLink>
            </Button>
            <Button asChild variant="outline" size="lg">
              <ModuleLink to="sales-debit-notes">
                <FilePlus2Icon /> {t("billing.nav.debitNotes")}
              </ModuleLink>
            </Button>
            <Button asChild size="lg" className="hidden sm:inline-flex">
              <ModuleLink to="invoices/new">
                <PlusIcon /> {t("billing.nav.newBill")}
              </ModuleLink>
            </Button>
          </>
        }
      />

      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("billing.invoices.filter")}
            value={pill}
            onChange={(v) => status.set(v === "all" ? [] : [v])}
            options={[
              { value: "all", label: t("billing.invoices.all"), meta: allCount },
              ...STATUSES.map((s) => ({ value: s, label: t(`billing.status.${s}`), meta: counts ? counts[s] || undefined : undefined })),
            ]}
          />
        }
      />

      <DataTable
        table={st.table}
        onRowClick={(inv) => navigate(`invoices/${inv.id}`)}
        empty={
          filtered ? undefined : (
            <EmptyState
              className="border-0 bg-transparent"
              illustration={<BillsIllustration />}
              title={t("billing.invoices.emptyTitle")}
              description={t("billing.invoices.emptyBody")}
              action={
                <Button asChild size="lg">
                  <ModuleLink to="invoices/new">
                    <PlusIcon /> {t("billing.dashboard.firstBill")}
                  </ModuleLink>
                </Button>
              }
            />
          )
        }
      />
    </Page>
  );
}
