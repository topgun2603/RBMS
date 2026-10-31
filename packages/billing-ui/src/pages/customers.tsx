"use client";

import * as React from "react";
import { ModuleLink, Page, PageHeading, useFeature, useI18n, useModuleNavigate, useServerTable, type ServerFilterDefs } from "@rbms/web";
import { NotebookTabsIcon, PlusIcon, UsersRoundIcon } from "lucide-react";
import { Button, ChipGroup, cn, DataTable, DataTableToolbar, EmptyState, InitialsAvatar, StatusPill, type DataTableColumn } from "@rbms/ui";
import { CustomerDialog } from "../components/customer-dialog";
import { PeopleIllustration } from "../components/illustrations";
import { BalancePill, balanceInk } from "../components/credit-book/credit-book-ui";
import { money } from "../lib/format";
import type { Customer } from "../lib/types";

const BALANCES = ["due", "advance", "settled"] as const;

export default function CustomersPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <Customers />
    </React.Suspense>
  );
}

function Customers() {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const [adding, setAdding] = React.useState(false);
  const creditBook = useFeature("invoices.credit-book");

  const filters = React.useMemo(
    () =>
      ({
        balance: {
          kind: "options",
          label: t("billing.customers.filter.balance"),
          options: BALANCES.map((b) => ({ value: b, label: t(`billing.customers.balance.${b}`) })),
        },
        overLimit: {
          kind: "options",
          single: true,
          label: t("billing.customers.filter.creditLimit"),
          options: [
            { value: "true", label: t("billing.customers.overLimit") },
            { value: "false", label: t("billing.customers.withinLimit") },
          ],
        },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<Customer>[]>(
    () => [
      {
        id: "name",
        header: t("billing.customers.col.name"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[20rem]",
        cell: (c) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <InitialsAvatar name={c.name} size="sm" />
            <div className="grid min-w-0">
              <ModuleLink to={`customers/${c.id}`} className="truncate font-medium outline-none hover:text-primary hover:underline focus-visible:underline">
                {c.name}
              </ModuleLink>
              {c.gstin && <span className="truncate font-mono text-xs text-muted-foreground">{c.gstin}</span>}
            </div>
          </div>
        ),
        cardCell: (c) => c.name,
      },
      {
        id: "phone",
        header: t("billing.customers.col.phone"),
        card: "subtitle",
        hideBelow: "md",
        cell: (c) => <span className="tabular-nums text-muted-foreground">{c.phone || "—"}</span>,
        cardCell: (c) => [c.phone, c.gstin].filter(Boolean).join(" · ") || t("billing.picker.noDetails"),
      },
      {
        id: "lastBill",
        header: t("billing.customers.col.lastBill"),
        sortable: true,
        sortDescFirst: true,
        card: "meta",
        cell: (c) => (c.lastBillDate ? <span className="tabular-nums">{formatDate(c.lastBillDate)}</span> : <span className="text-muted-foreground">—</span>),
        cardCell: (c) => (c.lastBillDate ? t("billing.customers.lastBillOn", { date: formatDate(c.lastBillDate) }) : null),
      },
      {
        id: "billed",
        header: t("billing.customers.col.billed"),
        sortable: true,
        numeric: true,
        hideBelow: "lg",
        cell: (c) => money(c.totalBilled ?? 0),
      },
      {
        id: "balance",
        header: t("billing.customers.col.balance"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (c) =>
          c.outstanding === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className={cn("font-semibold", balanceInk(c.outstanding))}>{money(Math.abs(c.outstanding))}</span>
          ),
      },
      {
        id: "status",
        header: t("billing.customers.col.status"),
        card: "right",
        cell: (c) => (
          <div className="flex flex-wrap items-center gap-1">
            <BalancePill balance={c.outstanding} />
            {c.creditLimit != null && c.outstanding > c.creditLimit && (
              <StatusPill tone="danger">{t("billing.customers.overLimit")}</StatusPill>
            )}
          </div>
        ),
      },
    ],
    [t, formatDate],
  );

  const st = useServerTable<Customer, typeof filters>({
    queryKey: ["customers", "table"],
    path: "/invoices/customers",
    columns,
    filters,
    defaultSort: "name",
    search: t("billing.customers.search"),
    storageKey: "billing-customers",
  });

  const balance = st.filters.balance;
  const counts = st.facets?.balance;
  const pill = balance.value.length === 0 ? "all" : balance.value.length === 1 ? balance.value[0]! : "";
  const filtered = st.table.activeFilterCount > 0;

  return (
    <Page>
      <PageHeading
        icon={UsersRoundIcon}
        title={t("billing.customers.title")}
        description={st.total !== undefined ? t("billing.customers.count", { count: st.total }) : undefined}
        actions={
          <>
            {creditBook && (
              <Button asChild variant="outline" size="lg" className="h-11">
                <ModuleLink to="credit-book">
                  <NotebookTabsIcon /> {t("billing.creditBook.openCreditBook")}
                </ModuleLink>
              </Button>
            )}
            <Button size="lg" className="h-11" onClick={() => setAdding(true)}>
              <PlusIcon /> {t("billing.customers.add")}
            </Button>
          </>
        }
      />

      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("billing.customers.filter.balance")}
            value={pill}
            onChange={(v) => balance.set(v === "all" ? [] : [v])}
            options={[
              { value: "all", label: t("billing.customers.all") },
              ...BALANCES.map((b) => ({ value: b, label: t(`billing.customers.balance.${b}`), meta: counts ? counts[b] || undefined : undefined })),
            ]}
          />
        }
      />

      <DataTable
        table={st.table}
        onRowClick={(c) => navigate(`customers/${c.id}`)}
        empty={
          filtered ? undefined : (
            <EmptyState
              className="border-0 bg-transparent"
              illustration={<PeopleIllustration />}
              title={t("billing.customers.emptyTitle")}
              description={t("billing.customers.emptyBody")}
              action={
                <Button size="lg" className="h-11" onClick={() => setAdding(true)}>
                  <PlusIcon /> {t("billing.customers.add")}
                </Button>
              }
            />
          )
        }
      />

      <CustomerDialog open={adding} onOpenChange={setAdding} />
    </Page>
  );
}
