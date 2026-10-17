"use client";

import * as React from "react";
import { ModuleLink, Page, PageHeading, useFeature, useI18n, useModuleNavigate, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { BellRingIcon, HandCoinsIcon, Loader2Icon, NotebookTabsIcon, PiggyBankIcon, PlusIcon, UsersRoundIcon, WalletIcon } from "lucide-react";
import { Button, ChipGroup, cn, DataTable, DataTableToolbar, EmptyState, InitialsAvatar, type DataTableColumn } from "@srirealtime/ui";
import { StatTile } from "../components/charts/stat-tile";
import { CustomerDialog } from "../components/customer-dialog";
import { CreditBookIllustration } from "../components/illustrations";
import { BalancePill, balanceInk, OverduePill, useRemind } from "../components/credit-book/credit-book-ui";
import { ReceiveDialog } from "../components/credit-book/receive-dialog";
import { money } from "../lib/format";
import type { Customer, CreditBookResponse, CreditBookRow } from "../lib/types";

const SIDES = ["due", "advance"] as const;
const AGES = ["current", "1-30", "31-60", "61-90", "90+"] as const;

export default function CreditBookPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <CreditBook />
    </React.Suspense>
  );
}

function CreditBook() {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const remind = useRemind();
  const whatsapp = useFeature("invoices.whatsapp");
  const [receiving, setReceiving] = React.useState<Pick<Customer, "id" | "name" | "outstanding"> | null>(null);
  const [adding, setAdding] = React.useState(false);

  const filters = React.useMemo(
    () =>
      ({
        // due / advance (no value = everyone); shown as the pills, so no toolbar button.
        filter: { kind: "options", single: true, hidden: true, label: t("billing.creditBook.filter.label"), options: SIDES.map((f) => ({ value: f, label: t(`billing.creditBook.filter.${f}`) })) },
        age: {
          kind: "options",
          label: t("billing.creditBook.ageFilter"),
          options: AGES.map((a) => ({ value: a, label: t(`billing.creditBook.age.${a}`) })),
        },
      }) satisfies ServerFilterDefs,
    [t],
  );

  // `send` changes identity every render; read it through a ref so the columns stay memoised.
  const sendRef = React.useRef(remind.send);
  sendRef.current = remind.send;
  const pendingId = remind.pendingId;
  const columns = React.useMemo<DataTableColumn<CreditBookRow>[]>(
    () => [
      {
        id: "name",
        header: t("billing.creditBook.col.customer"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[18rem]",
        cell: (r) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <InitialsAvatar name={r.customer.name} size="sm" />
            <div className="grid min-w-0">
              <ModuleLink to={`customers/${r.customer.id}`} className="truncate font-medium outline-none hover:text-primary hover:underline focus-visible:underline">
                {r.customer.name}
              </ModuleLink>
              {r.customer.phone && <span className="truncate text-xs text-muted-foreground tabular-nums">{r.customer.phone}</span>}
            </div>
          </div>
        ),
        cardCell: (r) => r.customer.name,
      },
      {
        id: "oldestDue",
        header: t("billing.creditBook.col.oldestDue"),
        sortable: true,
        card: "subtitle",
        cell: (r) => (r.oldestDue ? <span className="tabular-nums">{formatDate(r.oldestDue)}</span> : <span className="text-muted-foreground">—</span>),
        cardCell: (r) =>
          r.oldestDue
            ? t("billing.creditBook.oldestDueOn", { date: formatDate(r.oldestDue) })
            : r.lastActivity
              ? t("billing.creditBook.lastActivity", { date: formatDate(r.lastActivity) })
              : t("billing.creditBook.noActivity"),
      },
      {
        id: "overdue",
        header: t("billing.creditBook.col.overdue"),
        card: "meta",
        hideBelow: "md",
        cell: (r) => <OverduePill overdue={r.overdue} />,
      },
      {
        id: "lastPayment",
        header: t("billing.creditBook.col.lastPayment"),
        sortable: true,
        sortDescFirst: true,
        hideBelow: "lg",
        cell: (r) => (r.lastPayment ? <span className="tabular-nums">{formatDate(r.lastPayment)}</span> : <span className="text-muted-foreground">—</span>),
      },
      {
        id: "due",
        header: t("billing.creditBook.col.balance"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (r) => <span className={cn("font-heading font-semibold", balanceInk(r.balance))}>{money(Math.abs(r.balance))}</span>,
      },
      {
        id: "side",
        header: t("billing.creditBook.col.status"),
        card: "right",
        cell: (r) => <BalancePill balance={r.balance} />,
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("billing.common.actions")}</span>,
        label: t("billing.common.actions"),
        hideable: false,
        card: "meta",
        align: "right",
        cell: (r) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="outline"
              className="h-9 px-3"
              onClick={() => setReceiving({ ...r.customer, outstanding: r.balance })}
              aria-label={t("billing.creditBook.receiveFor", { name: r.customer.name })}
            >
              <WalletIcon />
              <span>{t("billing.creditBook.receive")}</span>
            </Button>
            {r.balance > 0 && whatsapp && (
              <Button
                variant="ghost"
                className="h-9 px-3"
                onClick={() => sendRef.current(r.customer, r.balance)}
                disabled={pendingId === r.customer.id}
                aria-label={t("billing.creditBook.remindFor", { name: r.customer.name })}
              >
                {pendingId === r.customer.id ? <Loader2Icon className="animate-spin" /> : <BellRingIcon />}
                <span className="hidden sm:inline">{t("billing.creditBook.remind")}</span>
              </Button>
            )}
          </div>
        ),
      },
    ],
    [t, formatDate, whatsapp, pendingId],
  );

  const st = useServerTable<CreditBookRow, typeof filters>({
    queryKey: ["credit-book", "table"],
    path: "/invoices/credit-book",
    columns,
    filters,
    defaultSort: "-due",
    search: t("billing.creditBook.search"),
    storageKey: "billing-credit-book",
    getRowId: (r) => r.customer.id,
  });

  const totals = (st.query.data as CreditBookResponse | undefined)?.totals;
  const side = st.filters.filter;
  const filtered = st.table.activeFilterCount > 0 || side.value.length > 0;

  return (
    <Page>
      <PageHeading
        icon={NotebookTabsIcon}
        title={t("billing.creditBook.title")}
        description={t("billing.creditBook.description")}
        actions={
          <Button asChild variant="outline" size="lg" className="h-11">
            <ModuleLink to="customers">
              <UsersRoundIcon /> {t("billing.nav.customers")}
            </ModuleLink>
          </Button>
        }
      />

      {/* Totals on a branded band */}
      <section aria-label={t("billing.creditBook.totals.aria")} className="hero-band relative mb-5 overflow-hidden rounded-2xl p-3 shadow-raised sm:p-4">
        <div aria-hidden className="hero-dots pointer-events-none absolute inset-0" />
        <div className="relative grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile
            variant="hero"
            className="col-span-2 sm:col-span-1"
            label={t("billing.creditBook.totals.receivable")}
            value={totals?.receivable}
            icon={HandCoinsIcon}
            loading={!totals && st.query.isPending}
          />
          <StatTile variant="hero" label={t("billing.creditBook.totals.advance")} value={totals?.advance} icon={PiggyBankIcon} loading={!totals && st.query.isPending} />
          <StatTile
            variant="hero"
            kind="count"
            label={t("billing.creditBook.totals.customersWithDues")}
            value={totals?.customersWithDues}
            icon={UsersRoundIcon}
            loading={!totals && st.query.isPending}
          />
        </div>
      </section>

      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("billing.creditBook.filter.label")}
            value={side.value[0] ?? "all"}
            onChange={(v) => side.set(v === "all" ? [] : [v])}
            options={[
              { value: "due", label: t("billing.creditBook.filter.due"), meta: totals ? totals.customersWithDues || undefined : undefined },
              { value: "advance", label: t("billing.creditBook.filter.advance") },
              { value: "all", label: t("billing.creditBook.filter.all") },
            ]}
          />
        }
      />

      <DataTable
        table={st.table}
        onRowClick={(r) => navigate(`customers/${r.customer.id}`)}
        empty={
          filtered ? undefined : (
            <EmptyState
              className="border-0 bg-transparent"
              illustration={<CreditBookIllustration />}
              title={t("billing.creditBook.empty.allTitle")}
              description={t("billing.creditBook.empty.allBody")}
              action={
                <Button size="lg" className="h-11" onClick={() => setAdding(true)}>
                  <PlusIcon /> {t("billing.customers.add")}
                </Button>
              }
            />
          )
        }
      />

      {receiving && <ReceiveDialog customer={receiving} open={!!receiving} onOpenChange={(o) => !o && setReceiving(null)} />}
      <CustomerDialog open={adding} onOpenChange={setAdding} />
    </Page>
  );
}
