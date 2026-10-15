"use client";

import * as React from "react";
import { describeError, ModuleLink, QueryError, tOr, useFeature, useI18n, useMe, useShop } from "@srirealtime/web";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BanknoteIcon,
  BarChart3Icon,
  BookOpenIcon,
  BoxesIcon,
  CheckCircle2Icon,
  CircleSlashIcon,
  CreditCardIcon,
  FileTextIcon,
  HandCoinsIcon,
  Loader2Icon,
  MessageCircleIcon,
  PackageIcon,
  PlusIcon,
  ReceiptIcon,
  SmartphoneIcon,
  WalletIcon,
} from "lucide-react";
import {
  AnimatedNumber,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  InitialsAvatar,
  Skeleton,
  Stagger,
  StaggerItem,
  StatusPill,
  toast,
} from "@srirealtime/ui";
import { BarList } from "../components/charts/bar-list";
import { ChartCard } from "../components/charts/chart-card";
import { Sparkline } from "../components/charts/sparkline";
import { StatTile } from "../components/charts/stat-tile";
import { TrendChart } from "../components/charts/trend-chart";
import { BillsIllustration } from "../components/illustrations";
import { InvoiceRow, InvoiceRowSkeleton } from "../components/invoice-row";
import { compactINR, formatQty, money, pctChange, rangeFor } from "../lib/format";
import { useInvoiceSummary } from "../lib/queries";
import { useCreditBook, usePaymentsReport, useRemindCustomer, useSalesTrend, useStockSummary } from "../lib/queries-v2";
import type { InvoiceSummaryResponse } from "../lib/types";

const METHOD_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  cash: BanknoteIcon,
  upi: SmartphoneIcon,
  card: CreditCardIcon,
  bank: WalletIcon,
  online: SmartphoneIcon,
};

/*
 * Dashboard widgets of the billing module. The host shell lays them out (WidgetDef.size) and hides the ones whose
 * feature is off; inside, links and buttons that belong to other optional features check them too.
 */

export function SalesHeroWidget() {
  const summary = useInvoiceSummary();
  if (summary.isError) return <QueryError error={summary.error} onRetry={() => void summary.refetch()} />;
  return <Hero summary={summary.data} loading={summary.isPending} />;
}

export function SalesTrendWidget() {
  return <SalesTrendCard />;
}

export function PaymentMethodsWidget() {
  return <PaymentMethodsCard />;
}

export function RecentBillsWidget() {
  const summary = useInvoiceSummary();
  if (summary.isError) return <QueryError error={summary.error} onRetry={() => void summary.refetch()} />;
  return <RecentBills summary={summary.data} loading={summary.isPending} />;
}

export function TopDuesWidget() {
  return <TopDuesCard />;
}

export function LowStockWidget() {
  return <LowStockCard />;
}

// ---------------------------------------------------------------- hero

function Hero({ summary: s, loading }: { summary?: InvoiceSummaryResponse; loading: boolean }) {
  const { t, formatDate } = useI18n();
  const { shopName } = useShop();
  const me = useMe();
  const firstName = me.data?.user.name?.split(" ")[0];
  const month = formatDate(new Date(), { month: "long" });
  const delta = s?.prevMonth ? pctChange(s.month.invoiced, s.prevMonth.invoiced) : null;
  const creditBook = useFeature("invoices.credit-book");
  const purchases = useFeature("inventory.purchases");

  return (
    <section className="hero-band relative isolate overflow-hidden rounded-3xl p-5 shadow-raised sm:p-7 print:hidden" aria-labelledby="hero-title">
      <div className="hero-dots pointer-events-none absolute inset-0 -z-10" aria-hidden />
      <div className="pointer-events-none absolute -top-24 -right-16 -z-10 size-72 rounded-full bg-white/10 blur-3xl" aria-hidden />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-3">
          <div>
            <p className="text-sm font-medium opacity-80">{shopName}</p>
            <h1 id="hero-title" className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
              {firstName ? t("billing.dashboard.greetingName", { name: firstName }) : t("billing.dashboard.greeting")}
            </h1>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wider uppercase opacity-75">{t("billing.dashboard.heroLabel")}</p>
            {loading ? (
              <Skeleton className="mt-2 h-11 w-52 bg-white/20" />
            ) : (
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <p className="font-heading text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl">
                  <AnimatedNumber value={s?.month.invoiced ?? 0} from={0} duration={1.1} format={(n) => money(Math.round(n / 100) * 100).replace(/\.00$/, "")} />
                </p>
                {s?.trend && s.trend.length > 1 && (
                  <Sparkline values={s.trend.map((p) => p.invoiced)} width={110} height={34} className="mb-1.5 text-current opacity-90" />
                )}
              </div>
            )}
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm opacity-90">
              {delta !== null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold">
                  <span aria-hidden>{Math.abs(delta) < 0.5 ? "•" : delta > 0 ? "▲" : "▼"}</span>
                  {Math.abs(delta) < 0.5 ? t("billing.charts.noChange") : t(delta > 0 ? "billing.charts.up" : "billing.charts.down", { pct: Math.round(Math.abs(delta)) })}
                  <span className="font-normal">{t("billing.charts.vsLastMonth")}</span>
                </span>
              )}
              {s && <span>{t("billing.dashboard.heroCount", { count: s.month.count, month })}</span>}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild size="lg" className="h-12 rounded-xl bg-primary-foreground px-5 text-base text-primary shadow-lg shadow-black/10 hover:bg-primary-foreground/90">
            <ModuleLink to="invoices/new">
              <PlusIcon className="size-5" /> {t("billing.dashboard.newBill")}
            </ModuleLink>
          </Button>
          {creditBook && (
            <Button asChild size="lg" variant="ghost" className="h-12 rounded-xl bg-white/12 text-current ring-1 ring-white/20 ring-inset hover:bg-white/20 hover:text-current">
              <ModuleLink to="credit-book?filter=due">
                <HandCoinsIcon /> {t("billing.dashboard.quickReceive")}
              </ModuleLink>
            </Button>
          )}
          {purchases && (
            <Button asChild size="lg" variant="ghost" className="hidden h-12 rounded-xl bg-white/12 text-current ring-1 ring-white/20 ring-inset hover:bg-white/20 hover:text-current sm:inline-flex">
              <ModuleLink to="purchases/new">
                <BoxesIcon /> {t("billing.dashboard.quickPurchase")}
              </ModuleLink>
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
        <StatTile
          variant="hero"
          label={t("billing.dashboard.collected")}
          value={s?.month.collected}
          previous={s?.prevMonth?.collected}
          icon={WalletIcon}
          loading={loading}
        />
        <StatTile
          variant="hero"
          label={t("billing.dashboard.outstanding")}
          value={s?.outstanding}
          hint={t("billing.dashboard.outstandingHint")}
          icon={ReceiptIcon}
          href={creditBook ? "credit-book" : "invoices?status=issued"}
          loading={loading}
        />
        <StatTile
          variant="hero"
          className="col-span-2 sm:col-span-1"
          kind="count"
          label={t("billing.dashboard.overdue")}
          value={s?.overdueCount}
          hint={s ? t("billing.dashboard.overdueBills", { count: s.overdueCount }) : undefined}
          icon={AlertTriangleIcon}
          href="invoices?status=overdue"
          loading={loading}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- charts

function SalesTrendCard() {
  const { t } = useI18n();
  const q = useSalesTrend(30);
  const items = q.data?.items ?? [];
  const total = items.reduce((s, p) => s + p.invoiced, 0);
  const data = items.map((p) => ({ date: p.date, value: p.invoiced }));
  const { formatDate } = useI18n();

  return (
    <ChartCard
      title={t("billing.dashboard.trendTitle")}
      description={q.data ? `${t("billing.dashboard.trendDesc")} · ${money(total)}` : t("billing.dashboard.trendDesc")}
      ariaLabel={t("billing.dashboard.trendAria", { total: money(total) })}
      loading={q.isPending}
      height={230}
      empty={
        q.isError ? (
          <QueryError compact error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.isPending && total === 0 ? (
          <EmptyState compact icon={BarChart3Icon} title={t("billing.dashboard.trendEmpty")} />
        ) : undefined
      }
      table={{
        columns: [
          { label: t("billing.charts.date") },
          { label: t("billing.dashboard.salesSeries"), numeric: true },
          { label: t("billing.dashboard.collected"), numeric: true },
          { label: t("billing.charts.count"), numeric: true },
        ],
        rows: [...items].reverse().map((p) => [formatDate(p.date, { day: "numeric", month: "short" }), money(p.invoiced), money(p.collected), p.count]),
      }}
      className="h-full"
    >
      <TrendChart data={data} seriesLabel={t("billing.dashboard.salesSeries")} height={230} />
    </ChartCard>
  );
}

function PaymentMethodsCard() {
  const { t, formatDate } = useI18n();
  const range = React.useMemo(() => rangeFor("thisMonth"), []);
  const q = usePaymentsReport(range.from, range.to);
  const byMethod = q.data?.byMethod ?? [];
  const total = byMethod.reduce((s, m) => s + m.amount, 0);
  const month = formatDate(new Date(), { month: "long", year: "numeric" });
  const label = (m: string) => tOr(t, `billing.payment.methods.${m}`, m);

  return (
    <ChartCard
      title={t("billing.dashboard.methodsTitle")}
      description={q.data ? `${month} · ${money(total)}` : month}
      ariaLabel={t("billing.dashboard.methodsAria", { month, total: money(total) })}
      loading={q.isPending}
      height={180}
      empty={
        q.isError ? (
          <QueryError compact error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.isPending && byMethod.length === 0 ? (
          <EmptyState compact icon={WalletIcon} title={t("billing.dashboard.methodsEmpty")} />
        ) : undefined
      }
      table={{
        columns: [
          { label: t("billing.charts.method") },
          { label: t("billing.charts.amount"), numeric: true },
          { label: t("billing.charts.count"), numeric: true },
        ],
        rows: [...byMethod].sort((a, b) => b.amount - a.amount).map((m) => [label(m.method), money(m.amount), m.count]),
      }}
      className="h-full"
    >
      <BarList
        items={byMethod.map((m) => ({
          key: m.method,
          label: label(m.method),
          text: label(m.method),
          value: m.amount,
          meta: t("billing.dashboard.paymentsCount", { count: m.count }),
          icon: METHOD_ICONS[m.method] ?? HandCoinsIcon,
        }))}
      />
    </ChartCard>
  );
}

// ---------------------------------------------------------------- lists

function RecentBills({ summary: s, loading }: { summary?: InvoiceSummaryResponse; loading: boolean }) {
  const { t } = useI18n();
  return (
    <Card className="h-full gap-2 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4 sm:px-5">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="icon-chip size-8 text-primary">
            <FileTextIcon className="size-4" />
          </span>
          {t("billing.dashboard.recent")}
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <ModuleLink to="invoices">
            {t("billing.dashboard.viewAll")} <ArrowRightIcon />
          </ModuleLink>
        </Button>
      </CardHeader>
      <CardContent className="px-1.5 sm:px-2.5">
        {loading ? (
          Array.from({ length: 5 }, (_, i) => <InvoiceRowSkeleton key={i} />)
        ) : s && s.recent.length > 0 ? (
          <Stagger className="divide-y divide-border/60">
            {s.recent.map((inv) => (
              <StaggerItem key={inv.id}>
                <InvoiceRow inv={inv} />
              </StaggerItem>
            ))}
          </Stagger>
        ) : (
          <EmptyState
            className="mx-2 my-2"
            illustration={<BillsIllustration />}
            title={t("billing.dashboard.emptyTitle")}
            description={t("billing.dashboard.emptyBody")}
            action={
              <Button asChild size="lg">
                <ModuleLink to="invoices/new">
                  <PlusIcon /> {t("billing.dashboard.firstBill")}
                </ModuleLink>
              </Button>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

function TopDuesCard() {
  const { t } = useI18n();
  const q = useCreditBook("", "due");
  const remind = useRemindCustomer();
  const whatsapp = useFeature("invoices.whatsapp");
  const [sending, setSending] = React.useState<string | null>(null);
  const rows = [...(q.data?.items ?? [])].sort((a, b) => b.balance - a.balance).slice(0, 5);
  const max = Math.max(1, ...rows.map((r) => r.balance));

  const send = async (id: string, name: string) => {
    setSending(id);
    try {
      await remind.mutateAsync({ customerId: id, channel: "whatsapp" });
      toast.success(t("billing.dashboard.reminded", { name }));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setSending(null);
    }
  };

  return (
    <Card className="h-full gap-2 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4 sm:px-5">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="icon-chip size-8 text-warning-ink">
            <BookOpenIcon className="size-4" />
          </span>
          {t("billing.dashboard.topDues")}
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <ModuleLink to="credit-book">
            {t("billing.dashboard.openCreditBook")} <ArrowRightIcon />
          </ModuleLink>
        </Button>
      </CardHeader>
      <CardContent className="px-2 sm:px-3">
        {q.isError ? (
          <QueryError compact error={q.error} onRetry={() => void q.refetch()} />
        ) : q.isPending ? (
          <div className="grid gap-3 px-2 py-1">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-1.5 w-full" />
                </div>
                <Skeleton className="h-8 w-20" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState compact icon={CheckCircle2Icon} title={t("billing.dashboard.topDuesEmpty")} />
        ) : (
          <ul className="grid gap-1">
            {rows.map((r) => (
              <li key={r.customer.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-accent/50">
                <ModuleLink to={`customers/${r.customer.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <InitialsAvatar name={r.customer.name} size="sm" className="size-9" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium">{r.customer.name}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{compactINR(r.balance)}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-muted" aria-hidden>
                      <div className="h-full rounded-full bg-warning" style={{ width: `${(r.balance / max) * 100}%` }} />
                    </div>
                  </div>
                </ModuleLink>
                {whatsapp && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 rounded-full"
                    disabled={sending === r.customer.id}
                    aria-label={t("billing.dashboard.remindAria", { name: r.customer.name })}
                    onClick={() => void send(r.customer.id, r.customer.name)}
                  >
                    {sending === r.customer.id ? <Loader2Icon className="animate-spin" /> : <MessageCircleIcon className="text-[#1ea952]" />}
                    <span className="hidden sm:inline">{t("billing.dashboard.remind")}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function LowStockCard() {
  const { t } = useI18n();
  const q = useStockSummary();
  const s = q.data;
  return (
    <Card className="h-full gap-2 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4 sm:px-5">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="icon-chip size-8 text-info-ink">
            <PackageIcon className="size-4" />
          </span>
          {t("billing.dashboard.lowStockTitle")}
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <ModuleLink to="stock?filter=low">
            {t("billing.dashboard.viewStock")} <ArrowRightIcon />
          </ModuleLink>
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3 px-4 sm:px-5">
        {q.isError ? (
          <QueryError compact error={q.error} onRetry={() => void q.refetch()} />
        ) : q.isPending || !s ? (
          <div className="grid gap-2">
            <Skeleton className="h-4 w-40" />
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {t("billing.dashboard.lowStockSummary", { low: s.lowCount, out: s.outCount })} · {t("billing.dashboard.stockValue", { value: compactINR(s.stockValue) })}
            </p>
            {s.lowItems.length === 0 ? (
              <p className="flex items-center gap-2 rounded-xl bg-success/10 px-3 py-3 text-sm text-success-ink">
                <CheckCircle2Icon className="size-4 shrink-0" /> {t("billing.dashboard.stockAllGood")}
              </p>
            ) : (
              <ul className="grid gap-1.5">
                {s.lowItems.slice(0, 5).map((it) => (
                  <li key={it.itemId}>
                    <ModuleLink
                      to={`stock?q=${encodeURIComponent(it.name)}`}
                      className="flex items-center gap-3 rounded-xl border border-border/70 px-3 py-2 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{it.name}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {t("billing.dashboard.leftQty", { qty: `${formatQty(it.qty)} ${it.unit ?? ""}`.trim() })} ·{" "}
                          {t("billing.dashboard.reorderAt", { qty: formatQty(it.reorderLevel) })}
                        </p>
                      </div>
                      <StatusPill
                        tone={it.status === "out" ? "danger" : "warning"}
                        icon={it.status === "out" ? CircleSlashIcon : AlertTriangleIcon}
                        className={cn("shrink-0")}
                      >
                        {t(it.status === "out" ? "billing.dashboard.statusOut" : "billing.dashboard.statusLow")}
                      </StatusPill>
                    </ModuleLink>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
