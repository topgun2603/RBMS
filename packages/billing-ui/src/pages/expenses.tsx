"use client";

import * as React from "react";
import {
  BarChart3Icon,
  BellRingIcon,
  FileTextIcon,
  FolderCogIcon,
  ListIcon,
  RepeatIcon,
  LayersIcon,
  LockIcon,
  PiggyBankIcon,
  PlusIcon,
  ReceiptIndianRupeeIcon,
  ReceiptTextIcon,
  WalletIcon,
} from "lucide-react";
import { Button, cn, DataTable, DataTableToolbar, EmptyState, StatusPill, Tabs, TabsContent, TabsList, TabsTrigger, type DataTableColumn } from "@srirealtime/ui";
import { absoluteUrl, api, Page, PageHeading, useI18n, useMyBranches, useServerTable, type ListResponse, type ServerFilterDefs } from "@srirealtime/web";
import { ExpenseReportPanel } from "../components/expenses/expense-report";
import { RecurringExpensesPanel } from "../components/expenses/recurring-expenses";
import { useSuppliers } from "../lib/queries-v2";
import { BarList } from "../components/charts/bar-list";
import { ChartCard } from "../components/charts/chart-card";
import { MonthBars } from "../components/charts/month-bars";
import { StatTile } from "../components/charts/stat-tile";
import { initialRange } from "../components/date-range-picker";
import { CategoriesDialog } from "../components/expenses/categories-dialog";
import { categoryLabel, ExpenseDialog } from "../components/expenses/expense-dialog";
import { ChartIllustration } from "../components/illustrations";
import { DownloadCsvButton, TabError, TileGrid } from "../components/reports/report-ui";
import { EXPENSES_PERMISSION, useHasPermission } from "../lib/access";
import { EXPENSE_PAYMENT_METHODS, useExpenseCategories, useExpenseSummary, useRecurringSummary, type Expense, type ExpenseCategory, type ExpenseList } from "../lib/expenses";
import { compactINR, money } from "../lib/format";

export default function ExpensesPage() {
  const { t } = useI18n();
  const allowed = useHasPermission(EXPENSES_PERMISSION);
  if (!allowed) {
    return (
      <Page>
        <PageHeading icon={ReceiptIndianRupeeIcon} title={t("billing.expenses.title")} description={t("billing.expenses.subtitle")} />
        <EmptyState icon={LockIcon} title={t("billing.expenses.noAccessTitle")} description={t("billing.expenses.noAccessBody")} />
      </Page>
    );
  }
  return <Expenses />;
}

function Expenses() {
  // The category names load first so a `?categoryId=` in the URL survives a refresh; useServerTable reads the search
  // params, which needs a Suspense boundary.
  const categories = useExpenseCategories();
  if (categories.isPending) return null;
  return (
    <React.Suspense fallback={null}>
      <ExpensesList categories={categories.data ?? []} />
    </React.Suspense>
  );
}

const TABS = ["list", "recurring", "report"] as const;
type Tab = (typeof TABS)[number];
const TAB_ICON = { list: ListIcon, recurring: RepeatIcon, report: BarChart3Icon } as const;

function ExpensesList({ categories }: { categories: ExpenseCategory[] }) {
  const { t, formatDate } = useI18n();
  const [dialog, setDialog] = React.useState<{ expense: Expense | null } | null>(null);
  const [cats, setCats] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>("list");
  const dShort = React.useCallback((d: string) => formatDate(d, { day: "numeric", month: "short" }), [formatDate]);
  const branches = useMyBranches();
  const branchList = React.useMemo(() => branches.data?.items ?? [], [branches.data]);
  const branchName = React.useCallback((id: string | null) => (id ? (branchList.find((b) => b.id === id)?.name ?? "") : t("billing.expenses.b.shopWide")), [branchList, t]);
  const suppliers = useSuppliers("");
  const supplierOptions = React.useMemo(() => (suppliers.data?.items ?? []).map((s) => ({ value: s.id, label: s.name })), [suppliers.data]);
  const recurringSummary = useRecurringSummary();

  const filters = React.useMemo(
    () =>
      ({
        date: { kind: "dateRange", label: t("billing.expenses.date") },
        category: {
          kind: "options",
          param: "categoryId",
          label: t("billing.expenses.category"),
          options: categories.map((c) => ({ value: c.id, label: categoryLabel(t, c) })),
          dynamic: true,
        },
        paymentMethod: {
          kind: "options",
          label: t("billing.expenses.method"),
          options: EXPENSE_PAYMENT_METHODS.map((m) => ({ value: m, label: t(`billing.payment.methods.${m}`) })),
        },
        status: {
          kind: "options",
          label: t("billing.expenses.filter.status"),
          options: [
            { value: "recorded", label: t("billing.expenses.status.recorded") },
            { value: "draft", label: t("billing.expenses.b.draftBadge") },
            { value: "cancelled", label: t("billing.expenses.cancelledBadge") },
          ],
        },
        supplier: { kind: "options", param: "supplierId", label: t("billing.expenses.b.supplier"), options: supplierOptions, dynamic: true },
        unpaid: { kind: "options", single: true, label: t("billing.expenses.b.unpaidFilter"), options: [{ value: "true", label: t("billing.expenses.b.unpaidOnly") }] },
        ...(branchList.length
          ? {
              branch: { kind: "options", param: "branchId", label: t("billing.expenses.b.branch"), options: branchList.map((b) => ({ value: b.id, label: b.name })), dynamic: true },
              shopWide: { kind: "options", single: true, label: t("billing.expenses.b.shopWide"), options: [{ value: "true", label: t("billing.expenses.b.shopWideOnly") }] },
            }
          : {}),
      }) satisfies ServerFilterDefs,
    [t, categories, supplierOptions, branchList],
  );

  const columns = React.useMemo<DataTableColumn<Expense>[]>(
    () => [
      {
        id: "date",
        header: t("billing.expenses.date"),
        sortable: true,
        sortDescFirst: true,
        hideable: false,
        card: "subtitle",
        cell: (e) => (
          <button type="button" onClick={() => setDialog({ expense: e })} className="font-medium text-primary tabular-nums underline-offset-4 hover:underline">
            {dShort(e.date)}
          </button>
        ),
        cardCell: (e) =>
          `${dShort(e.date)} · ${categoryLabel(t, { name: e.categoryName })} · ${e.paymentMethod === "credit" ? t("billing.expenses.b.onCredit") : t(`billing.payment.methods.${e.paymentMethod}`)}`,
      },
      {
        id: "category",
        header: t("billing.expenses.category"),
        sortable: true,
        cell: (e) => categoryLabel(t, { name: e.categoryName }),
      },
      {
        id: "vendor",
        header: t("billing.expenses.vendor"),
        card: "title",
        cell: (e) => (
          <span className="grid max-w-56">
            <span className="truncate">{e.vendorName || "—"}</span>
            {e.vendorGstin && <span className="truncate font-mono text-xs text-muted-foreground">{e.vendorGstin}</span>}
          </span>
        ),
        cardCell: (e) => e.vendorName || categoryLabel(t, { name: e.categoryName }),
      },
      {
        id: "amount",
        header: t("billing.expenses.amount"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (e) =>
          e.status === "draft" ? (
            <span className="grid justify-items-end">
              <span className="text-muted-foreground">{e.amount ? money(e.amount) : "—"}</span>
              <StatusPill tone="warning">{t("billing.expenses.b.draftBadge")}</StatusPill>
            </span>
          ) : (
            <span className="grid justify-items-end">
              <span className={e.status === "cancelled" ? "text-muted-foreground line-through" : "font-semibold"}>{money(e.amount)}</span>
              {e.balance > 0 && <span className="text-xs text-warning-ink">{t("billing.expenses.b.toPay", { amount: money(e.balance) })}</span>}
            </span>
          ),
      },
      {
        id: "gst",
        header: t("billing.expenses.gstItc"),
        numeric: true,
        card: "right",
        cell: (e) =>
          e.gstAmount ? (
            <span className="grid">
              <span>{money(e.gstAmount)}</span>
              <span className={cn("text-xs", e.itc ? "text-success-ink" : "text-muted-foreground")}>
                {e.itc ? t("billing.expenses.itcShort", { amount: money(e.itc) }) : t("billing.expenses.noItc")}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        cardCell: (e) =>
          e.status === "cancelled" ? (
            <StatusPill tone="neutral">{t("billing.expenses.cancelledBadge")}</StatusPill>
          ) : e.itc ? (
            <span className="text-xs text-success-ink">{t("billing.expenses.itcShort", { amount: money(e.itc) })}</span>
          ) : null,
      },
      {
        id: "method",
        header: t("billing.expenses.method"),
        hideBelow: "md",
        cell: (e) => (e.paymentMethod === "credit" ? t("billing.expenses.b.onCredit") : t(`billing.payment.methods.${e.paymentMethod}`)),
      },
      ...(branchList.length ? [{ id: "branch", header: t("billing.expenses.b.branch"), hideBelow: "lg" as const, cell: (e: Expense) => branchName(e.branchId) }] : []),
      {
        id: "receipt",
        header: t("billing.expenses.receipt"),
        hideBelow: "md",
        cell: (e) => <ReceiptThumb url={e.receiptUrl} />,
      },
    ],
    [t, dShort, branchList, branchName],
  );

  const st = useServerTable<Expense, typeof filters>({
    queryKey: ["expenses", "list", "table"],
    path: "/expenses",
    columns,
    filters,
    defaultSort: "-date",
    search: t("billing.expenses.search"),
    storageKey: "billing-expenses",
    // No status chosen = recorded and cancelled (left out, the API shows recorded ones only).
    fetcher: (params, signal) => api.get<ListResponse<Expense>>("/expenses", { status: "all", ...params }, { signal }),
  });

  // The tiles and charts cover the table's date filter (this month when none is set).
  const date = st.filters.date.value;
  const period = React.useMemo(() => {
    const month = initialRange("thisMonth");
    return { from: date.from ?? month.from, to: date.to ?? (date.from && date.from > month.to ? date.from : month.to) };
  }, [date.from, date.to]);
  const summary = useExpenseSummary(period.from, period.to);
  const s = summary.data;
  const loading = summary.isPending;
  const totals = (st.query.data as ExpenseList | undefined)?.totals;
  const filtered = st.table.activeFilterCount > 0;
  const { limit: _limit, offset: _offset, ...csvParams } = st.apiParams;

  const addButton = (
    <Button size="lg" className="h-11" onClick={() => setDialog({ expense: null })}>
      <PlusIcon /> {t("billing.expenses.add")}
    </Button>
  );

  return (
    <Page>
      <PageHeading
        icon={ReceiptIndianRupeeIcon}
        title={t("billing.expenses.title")}
        description={t("billing.expenses.subtitle")}
        actions={
          <>
            <Button variant="outline" size="lg" className="h-11" onClick={() => setCats(true)}>
              <FolderCogIcon /> {t("billing.expenses.categoriesButton")}
            </Button>
            {addButton}
          </>
        }
      />

      {(recurringSummary.data?.drafts ?? 0) > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm" role="status">
          <span className="flex items-center gap-2 text-warning-ink">
            <BellRingIcon className="size-4" /> {t("billing.expenses.b.draftsWaiting", { count: recurringSummary.data!.drafts })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setTab("list");
              st.filters.status.set(["draft"]);
            }}
          >
            {t("billing.expenses.b.showDrafts")}
          </Button>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-4">
        <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          <TabsList aria-label={t("billing.expenses.b.tabsLabel")} className="h-11 w-max rounded-xl p-1 shadow-inner">
            {TABS.map((k) => {
              const Icon = TAB_ICON[k];
              return (
                <TabsTrigger key={k} value={k} className="h-full rounded-lg px-3 sm:px-4">
                  <Icon />
                  {t(`billing.expenses.b.tabs.${k}`)}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
        <TabsContent value="recurring">
          <RecurringExpensesPanel />
        </TabsContent>
        <TabsContent value="report">
          <ExpenseReportPanel />
        </TabsContent>
        <TabsContent value="list">
      <div className="grid gap-4">
        <p className="text-meta text-muted-foreground">{t("billing.expenses.summaryPeriod", { from: dShort(period.from), to: dShort(period.to) })}</p>
        {summary.isError && !s ? (
          <TabError error={summary.error} onRetry={() => void summary.refetch()} />
        ) : (
          <TileGrid>
            {[
              <StatTile key="a" label={t("billing.expenses.tiles.total")} value={s?.total} icon={WalletIcon} loading={loading} />,
              <StatTile key="b" label={t("billing.expenses.tiles.gst")} value={s?.gst} icon={ReceiptTextIcon} iconTone="text-info" loading={loading} />,
              <StatTile
                key="c"
                label={t("billing.expenses.tiles.itc")}
                value={s?.itc}
                icon={PiggyBankIcon}
                iconTone="text-success"
                hint={s && s.gst > s.itc ? t("billing.expenses.tiles.itcHint", { amount: compactINR(s.gst - s.itc) }) : undefined}
                loading={loading}
              />,
              <StatTile key="d" label={t("billing.expenses.tiles.count")} value={s?.count} kind="count" icon={LayersIcon} iconTone="text-warning" loading={loading} />,
            ]}
          </TileGrid>
        )}

        {s && s.count > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title={t("billing.expenses.byCategory")}
              ariaLabel={
                s.byCategory[0]
                  ? t("billing.expenses.byCategoryAria", { name: categoryLabel(t, s.byCategory[0]), amount: money(s.byCategory[0].total) })
                  : t("billing.expenses.byCategory")
              }
              table={{
                columns: [{ label: t("billing.expenses.category") }, { label: t("billing.expenses.amount"), numeric: true }, { label: t("billing.expenses.itc"), numeric: true }],
                rows: s.byCategory.map((c) => [categoryLabel(t, c), money(c.total), money(c.itc)]),
              }}
            >
              <BarList
                formatValue={compactINR}
                items={s.byCategory.map((c) => ({
                  key: c.categoryId,
                  label: categoryLabel(t, c),
                  text: categoryLabel(t, c),
                  value: c.total,
                  meta: t("billing.expenses.entries", { count: c.count }),
                }))}
              />
            </ChartCard>
            <ChartCard
              title={t("billing.expenses.byMonth")}
              ariaLabel={t("billing.expenses.byMonthAria", { months: s.byMonth.length, amount: money(s.total) })}
              table={{
                columns: [{ label: t("billing.expenses.month") }, { label: t("billing.expenses.amount"), numeric: true }, { label: t("billing.expenses.gst"), numeric: true }],
                rows: s.byMonth.map((m) => [formatDate(`${m.month}-01`, { month: "long", year: "numeric" }), money(m.total), money(m.gst)]),
              }}
            >
              <MonthBars data={s.byMonth.map((m) => ({ month: m.month, value: m.total }))} seriesLabel={t("billing.expenses.tiles.total")} />
            </ChartCard>
          </div>
        )}

        <section aria-label={t("billing.expenses.listTitle")} className="grid gap-1">
          <DataTableToolbar table={st.table}>
            <DownloadCsvButton path="/expenses" params={{ status: "all", ...csvParams }} fileName={`expenses-${date.from ?? "all"}-to-${date.to ?? "today"}.csv`} />
          </DataTableToolbar>
          {totals && st.total ? (
            <p className="mb-2 text-meta text-muted-foreground tabular-nums" aria-live="polite">
              {t("billing.expenses.listTotals", { count: st.total, amount: money(totals.amount), gst: money(totals.gst) })}
            </p>
          ) : null}
          <DataTable
            table={st.table}
            onRowClick={(e) => setDialog({ expense: e })}
            empty={
              filtered ? undefined : (
                <EmptyState
                  className="border-0 bg-transparent"
                  illustration={<ChartIllustration />}
                  title={t("billing.expenses.emptyTitle")}
                  description={t("billing.expenses.emptyBody")}
                  action={addButton}
                />
              )
            }
          />
        </section>
      </div>
        </TabsContent>
      </Tabs>

      <ExpenseDialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)} expense={dialog?.expense ?? null} />
      <CategoriesDialog open={cats} onOpenChange={setCats} />
    </Page>
  );
}

function ReceiptThumb({ url, link = true }: { url: string | null; link?: boolean }) {
  const { t } = useI18n();
  const [broken, setBroken] = React.useState(false);
  const src = absoluteUrl(url);
  if (!src) return <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground/60" aria-hidden><ReceiptTextIcon className="size-4" /></span>;
  const pdf = /\.pdf($|\?)/i.test(src);
  const body =
    pdf || broken ? (
      <span className="flex size-full items-center justify-center bg-muted text-muted-foreground">
        <FileTextIcon className="size-4" />
      </span>
    ) : (
      // eslint-disable-next-line @next/next/no-img-element -- UI modules don't use next/image
      <img src={src} alt="" loading="lazy" className="size-full object-cover" onError={() => setBroken(true)} />
    );
  if (!link) return <span className="inline-flex size-9 shrink-0 overflow-hidden rounded-lg ring-1 ring-border ring-inset">{body}</span>;
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex size-9 shrink-0 overflow-hidden rounded-lg ring-1 ring-border outline-none ring-inset focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t("billing.expenses.viewReceipt")}
    >
      {body}
    </a>
  );
}
