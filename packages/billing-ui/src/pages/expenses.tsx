"use client";

import * as React from "react";
import {
  FileTextIcon,
  FolderCogIcon,
  LayersIcon,
  LockIcon,
  PiggyBankIcon,
  PlusIcon,
  ReceiptIndianRupeeIcon,
  ReceiptTextIcon,
  WalletIcon,
} from "lucide-react";
import {
  Button,
  Card,
  cn,
  EmptyState,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusPill,
  Switch,
} from "@srirealtime/ui";
import { absoluteUrl, Page, PageHeading, SearchField, useDebounced, useI18n } from "@srirealtime/web";
import { BarList } from "../components/charts/bar-list";
import { ChartCard } from "../components/charts/chart-card";
import { MonthBars } from "../components/charts/month-bars";
import { StatTile } from "../components/charts/stat-tile";
import { DateRangePicker, initialRange, type DateRangeValue } from "../components/date-range-picker";
import { CategoriesDialog } from "../components/expenses/categories-dialog";
import { categoryLabel, ExpenseDialog } from "../components/expenses/expense-dialog";
import { ChartIllustration } from "../components/illustrations";
import { DownloadCsvButton, PeriodEmpty, ReportTable, TabError, TableCard, TableSkeleton, TileGrid, type Column } from "../components/reports/report-ui";
import { EXPENSES_PERMISSION, useHasPermission } from "../lib/access";
import { useExpenseCategories, useExpenses, useExpenseSummary, type Expense } from "../lib/expenses";
import { compactINR, money } from "../lib/format";

const ALL = "__all";

export default function ExpensesPage() {
  const { t } = useI18n();
  const allowed = useHasPermission(EXPENSES_PERMISSION);
  if (!allowed) {
    return (
      <Page className="max-w-6xl">
        <PageHeading icon={ReceiptIndianRupeeIcon} title={t("billing.expenses.title")} description={t("billing.expenses.subtitle")} />
        <EmptyState icon={LockIcon} title={t("billing.expenses.noAccessTitle")} description={t("billing.expenses.noAccessBody")} />
      </Page>
    );
  }
  return <Expenses />;
}

function Expenses() {
  const { t, formatDate } = useI18n();
  const [range, setRange] = React.useState<DateRangeValue>(() => initialRange("thisMonth"));
  const [categoryId, setCategoryId] = React.useState(ALL);
  const [search, setSearch] = React.useState("");
  const [withCancelled, setWithCancelled] = React.useState(false);
  const q = useDebounced(search.trim(), 300);
  const [dialog, setDialog] = React.useState<{ expense: Expense | null } | null>(null);
  const [cats, setCats] = React.useState(false);

  const filters = React.useMemo(
    () => ({
      from: range.from,
      to: range.to,
      categoryId: categoryId === ALL ? undefined : categoryId,
      q: q || undefined,
      status: withCancelled ? ("all" as const) : ("recorded" as const),
    }),
    [range.from, range.to, categoryId, q, withCancelled],
  );
  const list = useExpenses(filters);
  const summary = useExpenseSummary(range.from, range.to);
  const categories = useExpenseCategories();
  const s = summary.data;
  const items = list.data?.items ?? [];
  const loading = summary.isPending;
  const dShort = (d: string) => formatDate(d, { day: "numeric", month: "short" });

  const addButton = (
    <Button size="lg" className="h-11" onClick={() => setDialog({ expense: null })}>
      <PlusIcon /> {t("billing.expenses.add")}
    </Button>
  );

  const columns: Column<Expense>[] = [
    {
      key: "date",
      label: t("billing.expenses.date"),
      cell: (e) => (
        <button type="button" onClick={() => setDialog({ expense: e })} className="font-medium text-primary tabular-nums underline-offset-4 hover:underline">
          {dShort(e.date)}
        </button>
      ),
      footer: t("billing.reports.total"),
    },
    { key: "category", label: t("billing.expenses.category"), cell: (e) => categoryLabel(t, { name: e.categoryName }) },
    {
      key: "vendor",
      label: t("billing.expenses.vendor"),
      cell: (e) => (
        <span className="grid max-w-56">
          <span className="truncate">{e.vendorName || "—"}</span>
          {e.vendorGstin && <span className="truncate font-mono text-[0.6875rem] text-muted-foreground">{e.vendorGstin}</span>}
        </span>
      ),
    },
    {
      key: "amount",
      label: t("billing.expenses.amount"),
      numeric: true,
      cell: (e) => <span className={e.status === "cancelled" ? "text-muted-foreground line-through" : "font-semibold"}>{money(e.amount)}</span>,
      footer: money(list.data?.totals.amount ?? 0),
    },
    {
      key: "gst",
      label: t("billing.expenses.gstItc"),
      numeric: true,
      cell: (e) =>
        e.gstAmount ? (
          <span className="grid">
            <span>{money(e.gstAmount)}</span>
            <span className={cn("text-[0.6875rem]", e.itc ? "text-success-ink" : "text-muted-foreground")}>{e.itc ? t("billing.expenses.itcShort", { amount: money(e.itc) }) : t("billing.expenses.noItc")}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      footer: money(list.data?.totals.gst ?? 0),
    },
    { key: "method", label: t("billing.expenses.method"), cell: (e) => t(`billing.payment.methods.${e.paymentMethod}`) },
    {
      key: "receipt",
      label: t("billing.expenses.receipt"),
      cell: (e) => <ReceiptThumb url={e.receiptUrl} />,
    },
  ];

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

      <div className="grid gap-4">
        <Card className="gap-3 px-4 py-3 sm:px-5">
          <DateRangePicker value={range} onChange={setRange} />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="h-11 w-full sm:w-52" aria-label={t("billing.expenses.category")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("billing.expenses.allCategories")}</SelectItem>
                {(categories.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {categoryLabel(t, c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SearchField value={search} onChange={setSearch} placeholder={t("billing.expenses.search")} className="sm:max-w-xs sm:flex-1" />
            <Label className="flex items-center gap-2 text-sm font-normal sm:ml-auto">
              <Switch checked={withCancelled} onCheckedChange={setWithCancelled} /> {t("billing.expenses.showCancelled")}
            </Label>
          </div>
        </Card>

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

        {list.isError && !list.data ? (
          <TabError error={list.error} onRetry={() => void list.refetch()} />
        ) : list.isPending ? (
          <TableSkeleton />
        ) : !items.length ? (
          filters.categoryId || filters.q ? (
            <PeriodEmpty title={t("billing.expenses.noMatch")} />
          ) : (
            <EmptyState illustration={<ChartIllustration />} title={t("billing.expenses.emptyTitle")} description={t("billing.expenses.emptyBody")} action={addButton} />
          )
        ) : (
          <TableCard
            title={t("billing.expenses.listTitle")}
            description={t("billing.expenses.entries", { count: list.data.total })}
            icon={ReceiptIndianRupeeIcon}
            actions={<DownloadCsvButton path="/expenses" params={{ ...filters }} fileName={`expenses-${range.from}-to-${range.to}.csv`} />}
          >
            <div className="hidden sm:block">
              <ReportTable columns={columns} rows={items} rowKey={(e) => e.id} caption={t("billing.expenses.listTitle")} />
            </div>
            <ul className="divide-y sm:hidden">
              {items.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => setDialog({ expense: e })} className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-accent/40 focus-visible:bg-accent/40">
                    <ReceiptThumb url={e.receiptUrl} link={false} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{e.vendorName || categoryLabel(t, { name: e.categoryName })}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {dShort(e.date)} · {categoryLabel(t, { name: e.categoryName })} · {t(`billing.payment.methods.${e.paymentMethod}`)}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className={cn("block font-semibold tabular-nums", e.status === "cancelled" && "text-muted-foreground line-through")}>{money(e.amount)}</span>
                      {e.status === "cancelled" ? (
                        <StatusPill tone="neutral">{t("billing.expenses.cancelledBadge")}</StatusPill>
                      ) : e.itc ? (
                        <span className="text-[0.6875rem] text-success-ink">{t("billing.expenses.itcShort", { amount: money(e.itc) })}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </TableCard>
        )}
      </div>

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
