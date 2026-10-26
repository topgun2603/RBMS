"use client";

import * as React from "react";
import { AlertTriangleIcon, BanknoteIcon, CalendarClockIcon, Loader2Icon, SettingsIcon, SparklesIcon, TrendingUpIcon } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Skeleton, Slider, StatCard, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@srirealtime/ui";
import { describeError, Page, PageHeading, QueryError, useFeature, useI18n } from "@srirealtime/web";
import { useHasPermission } from "../lib/access";
import { ChartTooltipBox } from "../components/charts/chart-card";
import { compactINR, money, paiseToInput, rupeesToPaise, tickINR } from "../lib/format";
import { projectBalances, useCashflow, useCashflowExplain, useCashflowSettings, useSaveCashflowSettings, type Cashflow, type CashflowWords, type FlowItem } from "../lib/ai-money";

const KIND_KEY: Record<FlowItem["kind"], string> = { collection: "billing.cash.kind.collection", supplier: "billing.cash.kind.supplier", recurring: "billing.cash.kind.recurring", po: "billing.cash.kind.po" };

/** Cash flow, next 30 days: worked out in code from the shop's own records; the sliders recompute the curve in the browser. */
export default function CashFlowPage() {
  const { t } = useI18n();
  const q = useCashflow();
  return (
    <Page>
      <PageHeading icon={TrendingUpIcon} title={t("billing.cash.title")} description={t("billing.cash.subtitle")} />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <div className="grid gap-4">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : (
        <Forecast f={q.data} />
      )}
    </Page>
  );
}

function Forecast({ f }: { f: Cashflow }) {
  const { t, locale, formatDate } = useI18n();
  const lang = locale === "ta" ? "ta" : "en";
  const aiOn = useFeature("ai");
  const canAi = useHasPermission("ai.use");
  const [salesPct, setSalesPct] = React.useState(0);
  const [collectionPct, setCollectionPct] = React.useState(100);
  const adj = { salesPct, collectionPct };
  const balances = React.useMemo(() => projectBalances(f, adj), [f, salesPct, collectionPct]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = React.useMemo(() => f.days.map((d, i) => ({ date: d.date, value: balances[i]!, festival: d.festival })), [f.days, balances]);
  const low = React.useMemo(() => data.reduce((a, d) => (d.value < a.value ? d : a), data[0]!), [data]);
  const dipIdx = f.balanceKnown ? balances.findIndex((b) => b < f.threshold) : -1;
  const dip = dipIdx >= 0 ? data[dipIdx]! : null;
  const changed = salesPct !== 0 || collectionPct !== 100;
  const totalIn = f.days.reduce((a, d) => a + d.salesIn * (1 + salesPct / 100) + d.collectionsIn * (collectionPct / 100), 0);
  const totalOut = f.days.reduce((a, d) => a + d.supplierOut + d.recurringOut + d.poOut, 0);
  const reasonName = f.warning && f.warning.reason.kind !== "none" ? t(KIND_KEY[f.warning.reason.kind]) : "";

  return (
    <div className="grid gap-section">
      {!f.balanceKnown && (
        <Alert>
          <BanknoteIcon />
          <AlertTitle>{t("billing.cash.noBalanceTitle")}</AlertTitle>
          <AlertDescription>{t("billing.cash.noBalanceBody")}</AlertDescription>
        </Alert>
      )}
      {dip && (
        <Alert data-testid="cash-warning" className="border-warning/40 bg-warning/10">
          <AlertTriangleIcon className="text-warning-ink" />
          <AlertTitle>{t("billing.cash.warnTitle", { date: formatDate(dip.date, { day: "numeric", month: "short" }), balance: money(dip.value) })}</AlertTitle>
          <AlertDescription>
            {changed || !f.warning
              ? t("billing.cash.warnSliders", { level: money(f.threshold) })
              : f.warning.reason.kind === "none"
                ? t("billing.cash.warnBody", { short: money(f.warning.shortBy), level: money(f.threshold) })
                : t("billing.cash.warnReason", { short: money(f.warning.shortBy), reason: reasonName, label: f.warning.reason.label, amount: money(f.warning.reason.amount), date: formatDate(f.warning.reason.date, { day: "numeric", month: "short" }) })}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title={t("billing.cash.start")} value={f.balanceKnown ? money(f.startBalance) : "-"} description={f.opening.source === "till" ? t("billing.cash.fromTill") : f.opening.source === "entered" ? t("billing.cash.fromEntered") : t("billing.cash.notEntered")} icon={BanknoteIcon} />
        <StatCard title={t("billing.cash.in")} value={compactINR(totalIn)} description={t("billing.cash.inHint")} icon={TrendingUpIcon} />
        <StatCard title={t("billing.cash.out")} value={compactINR(totalOut)} description={t("billing.cash.outHint")} icon={CalendarClockIcon} />
        <StatCard title={t("billing.cash.lowest")} value={money(low.value)} description={formatDate(low.date, { day: "numeric", month: "short" })} icon={AlertTriangleIcon} iconClassName={dip ? "text-warning-ink" : undefined} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("billing.cash.chartTitle")}</CardTitle>
          <p className="text-meta text-muted-foreground">{f.balanceKnown ? t("billing.cash.chartHint") : t("billing.cash.chartHintRelative")}</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div role="img" aria-label={t("billing.cash.chartAria", { lowest: money(low.value), end: money(balances.at(-1) ?? 0) })} className="h-60 w-full select-none [&_.recharts-surface]:overflow-visible" data-testid="cash-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={28} tickMargin={8} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} tickFormatter={(d: string) => formatDate(d, { day: "numeric", month: "short" })} />
                <YAxis width={48} tickLine={false} axisLine={false} tickCount={5} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} tickFormatter={(v: number) => tickINR(v)} />
                <Tooltip
                  cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.5 }}
                  content={(p: TooltipProps<number, string>) =>
                    p.active && p.payload?.length ? (
                      <ChartTooltipBox title={formatDate(String(p.label), { weekday: "short", day: "numeric", month: "short" })} rows={[{ label: t("billing.cash.balance"), value: money(Number(p.payload[0]?.value ?? 0)), color: "var(--primary)" }]} />
                    ) : null
                  }
                />
                {f.balanceKnown && <ReferenceLine y={f.threshold} stroke="var(--destructive)" strokeDasharray="4 4" strokeOpacity={0.7} />}
                <ReferenceLine y={0} stroke="var(--chart-axis)" strokeOpacity={0.5} />
                <Area type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} fill="var(--primary)" fillOpacity={0.1} isAnimationActive={false} dot={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="cash-sales">{t("billing.cash.salesSlider")}</Label>
                <span className="text-sm font-medium tabular-nums" data-testid="cash-sales-value">{salesPct > 0 ? `+${salesPct}` : salesPct}%</span>
              </div>
              <Slider id="cash-sales" min={-50} max={50} step={5} value={[salesPct]} onValueChange={(v) => setSalesPct(v[0] ?? 0)} thumbLabels={[t("billing.cash.salesSlider")]} />
            </div>
            <div className="grid gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="cash-collect">{t("billing.cash.collectSlider")}</Label>
                <span className="text-sm font-medium tabular-nums" data-testid="cash-collect-value">{collectionPct}%</span>
              </div>
              <Slider id="cash-collect" min={0} max={120} step={5} value={[collectionPct]} onValueChange={(v) => setCollectionPct(v[0] ?? 100)} thumbLabels={[t("billing.cash.collectSlider")]} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{t("billing.cash.slidersHint")}</p>
            {changed && (
              <Button type="button" variant="ghost" size="sm" className="h-11 sm:h-9" onClick={() => (setSalesPct(0), setCollectionPct(100))}>
                {t("billing.cash.reset")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {aiOn && canAi && <Words lang={lang} />}
      <Assumptions f={f} />
      <Upcoming f={f} />
      <Daily f={f} balances={balances} />
      <Settings f={f} />
    </div>
  );
}

function Words({ lang }: { lang: "en" | "ta" }) {
  const { t } = useI18n();
  const ex = useCashflowExplain();
  const w: CashflowWords | undefined = ex.data;
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">{t("billing.cash.wordsTitle")}</CardTitle>
          <p className="text-meta text-muted-foreground">{t("billing.cash.wordsHint")}</p>
        </div>
        <Button type="button" variant="outline" className="h-11 shrink-0 sm:h-9" disabled={ex.isPending} onClick={() => ex.mutate(lang, { onError: (e) => toast.error(describeError(e, t)) })}>
          {ex.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
          {w ? t("billing.cash.wordsAgain") : t("billing.cash.wordsButton")}
        </Button>
      </CardHeader>
      {w && (
        <CardContent className="grid gap-2 text-sm" data-testid="cash-words">
          <p>{w.explanation}</p>
          {w.suggestions.length > 0 && (
            <ul className="list-disc space-y-1 pl-5">
              {w.suggestions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{w.source === "ai" ? t("billing.cash.aiWritten", { credits: w.credits }) : t("billing.cash.standardWording")}</p>
        </CardContent>
      )}
    </Card>
  );
}

function Assumptions({ f }: { f: Cashflow }) {
  const { t, locale, formatDate } = useI18n();
  const fest = f.festivals.filter((x) => x.ratio);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("billing.cash.assumptionsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1.5 text-sm text-muted-foreground">
        <p>{f.assumptions.historyDays >= 14 ? t("billing.cash.asSalesWeekday", { days: f.assumptions.historyDays }) : t("billing.cash.asSalesThin", { days: f.assumptions.historyDays })}</p>
        {fest.map((x) => (
          <p key={x.id}>{t("billing.cash.asFestival", { name: locale === "ta" ? x.nameTa : x.name, date: formatDate(x.date, { day: "numeric", month: "short" }), ratio: x.ratio ?? 1 })}</p>
        ))}
        {f.festivals.length > 0 && fest.length === 0 && <p>{t("billing.cash.asFestivalNone")}</p>}
        <p>{t("billing.cash.asCollections")}</p>
        <p>{t("billing.cash.asSuppliers")}</p>
        {f.recurring.length > 0 ? <p>{t("billing.cash.asRecurring", { list: f.recurring.map((r) => `${r.category} ${money(r.amount)}`).join(", ") })}</p> : <p>{t("billing.cash.asRecurringNone")}</p>}
      </CardContent>
    </Card>
  );
}

function Upcoming({ f }: { f: Cashflow }) {
  const { t, formatDate } = useI18n();
  const rows = f.items.filter((i) => i.kind !== "collection" || !i.spread).slice(0, 14);
  const spread = f.items.filter((i) => i.kind === "collection" && i.spread).slice(0, 6);
  if (!rows.length && !spread.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("billing.cash.upcomingTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1">
        <ul className="grid gap-1.5 text-sm">
          {rows.map((i, n) => (
            <li key={`${i.date}-${i.label}-${n}`} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">
                <span className="tabular-nums text-muted-foreground">{formatDate(i.date, { day: "numeric", month: "short" })}</span> · {t(KIND_KEY[i.kind])} · {i.label}
              </span>
              <span className={`shrink-0 font-medium tabular-nums ${i.kind === "collection" ? "text-success-ink" : "text-danger-ink"}`}>
                {i.kind === "collection" ? "+" : "-"}
                {money(i.amount)}
              </span>
            </li>
          ))}
          {spread.map((i, n) => (
            <li key={`s-${i.label}-${n}`} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">
                {t("billing.cash.spreadLabel")} · {i.label}
              </span>
              <span className="shrink-0 font-medium tabular-nums text-success-ink">+{money(i.amount)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Daily({ f, balances }: { f: Cashflow; balances: number[] }) {
  const { t, formatDate } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("billing.cash.tableTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <div className="max-h-96 overflow-auto" tabIndex={0} aria-label={t("billing.cash.tableTitle")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("billing.cash.col.date")}</TableHead>
                <TableHead className="text-right">{t("billing.cash.col.sales")}</TableHead>
                <TableHead className="text-right">{t("billing.cash.col.collections")}</TableHead>
                <TableHead className="text-right">{t("billing.cash.col.out")}</TableHead>
                <TableHead className="text-right">{t("billing.cash.col.balance")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {f.days.map((d, i) => (
                <TableRow key={d.date}>
                  <TableCell className="whitespace-nowrap">{formatDate(d.date, { weekday: "short", day: "numeric", month: "short" })}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(d.salesIn)}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.collectionsIn ? money(d.collectionsIn) : "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.supplierOut + d.recurringOut + d.poOut ? money(d.supplierOut + d.recurringOut + d.poOut) : "-"}</TableCell>
                  <TableCell className={`text-right font-medium tabular-nums ${f.balanceKnown && balances[i]! < f.threshold ? "text-danger-ink" : ""}`}>{money(balances[i])}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function Settings({ f }: { f: Cashflow }) {
  const { t } = useI18n();
  const canSave = useHasPermission("ai.manage");
  const q = useCashflowSettings(canSave);
  const save = useSaveCashflowSettings();
  const [open, setOpen] = React.useState(false);
  const [balance, setBalance] = React.useState("");
  const [level, setLevel] = React.useState("");
  React.useEffect(() => {
    if (!q.data) return;
    setBalance(paiseToInput(q.data.openingBalance));
    setLevel(paiseToInput(q.data.minBalance));
  }, [q.data]);
  if (!canSave) return null;
  const onSave = async () => {
    const b = balance.trim() === "" ? null : rupeesToPaise(balance);
    const l = level.trim() === "" ? 0 : rupeesToPaise(level);
    if ((balance.trim() !== "" && b === null) || l === null || l < 0) {
      toast.error(t("billing.cash.settingsInvalid"));
      return;
    }
    try {
      await save.mutateAsync({ openingBalance: b, minBalance: l });
      toast.success(t("billing.cash.settingsSaved"));
      setOpen(false);
    } catch (e) {
      toast.error(describeError(e, t));
    }
  };
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">{t("billing.cash.settingsTitle")}</CardTitle>
          <p className="text-meta text-muted-foreground">{t("billing.cash.settingsHint")}</p>
        </div>
        <Button type="button" variant="outline" className="h-11 shrink-0 sm:h-9" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <SettingsIcon />
          {t("billing.cash.settingsOpen")}
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="cash-balance">{t("billing.cash.balanceLabel")}</Label>
            <Input id="cash-balance" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder={f.balanceKnown ? paiseToInput(f.startBalance) : "0"} />
            <p className="text-xs text-muted-foreground">{t("billing.cash.balanceHelp")}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cash-level">{t("billing.cash.levelLabel")}</Label>
            <Input id="cash-level" inputMode="decimal" value={level} onChange={(e) => setLevel(e.target.value)} placeholder="0" />
            <p className="text-xs text-muted-foreground">{t("billing.cash.levelHelp")}</p>
          </div>
          <div className="sm:col-span-2">
            <Button type="button" className="h-11 sm:h-9" disabled={save.isPending} onClick={() => void onSave()}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {t("billing.common.save")}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
