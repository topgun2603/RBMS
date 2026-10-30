"use client";

import * as React from "react";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Input,
  Label,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@rbms/ui";
import { describeError, Page, PageHeading, Sparkline, useI18n, usePermission } from "@rbms/web";
import { InlineError, useMetalLabel } from "../components/bits";
import { JEWELLERY_PERMISSIONS } from "../lib/access";
import { money, paiseToInput, rupeesToPaise } from "../lib/format";
import { basePurity, METALS, PURITIES, rateOf, resolveRates, type Metal, type Purity } from "../lib/pricing";
import { useRates, useSaveRates } from "../lib/queries";
import type { RateEntry } from "../lib/types";

const key = (metal: Metal, purity: string) => `${metal}:${purity}`;
/** Purities typed in by default (the rest are derived unless overridden). */
const PRIMARY = new Set([key("gold", "24K"), key("gold", "22K"), key("silver", "999"), key("platinum", "950")]);
const HISTORY_COLS: { metal: Metal; purity: Purity }[] = [
  { metal: "gold", purity: "24K" },
  { metal: "gold", purity: "22K" },
  { metal: "gold", purity: "18K" },
  { metal: "silver", purity: "999" },
  { metal: "platinum", purity: "950" },
];

/** Today's rates: one card per metal, an input per purity (derived ones greyed until overridden), save & reprice, history. */
export default function RatesPage() {
  const { t, formatDate } = useI18n();
  const metalLabel = useMetalLabel();
  const canSet = usePermission(JEWELLERY_PERMISSIONS.rates);
  const rates = useRates(30);
  const save = useSaveRates();
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [lastResult, setLastResult] = React.useState<string | null>(null);

  // Start from today's entries, or the last entered rates when today's aren't in yet.
  const d = rates.data;
  React.useEffect(() => {
    if (!d) return;
    const src: RateEntry[] = d.setToday ? d.entered : d.effective.filter((r) => r.source === "entered" && r.ratePerGram !== null).map((r) => ({ metal: r.metal, purity: r.purity, ratePerGram: r.ratePerGram! }));
    setValues(Object.fromEntries(src.map((r) => [key(r.metal, r.purity), paiseToInput(r.ratePerGram)])));
  }, [d]);

  const parsed = Object.entries(values)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => {
      const [metal, purity] = k.split(":") as [Metal, Purity];
      return { metal, purity, ratePerGram: rupeesToPaise(v) };
    });
  const bad = new Set(parsed.filter((p) => p.ratePerGram === null || p.ratePerGram <= 0).map((p) => key(p.metal, p.purity)));
  const entries = parsed.filter((p): p is RateEntry => p.ratePerGram !== null && p.ratePerGram > 0);
  const card = resolveRates(entries);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (bad.size || entries.length === 0) {
      setError(t("jewellery.rates.enterOne"));
      return;
    }
    try {
      const r = await save.mutateAsync(entries);
      const msg = t("jewellery.rates.saved", { count: r.reprice.repriced });
      setLastResult(
        [msg, r.reprice.failed ? t("jewellery.rates.failed", { count: r.reprice.failed }) : null, r.reprice.noRate ? t("jewellery.rates.noRateCount", { count: r.reprice.noRate }) : null]
          .filter(Boolean)
          .join(" · "),
      );
      toast.success(msg);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  const spark = (d?.history ?? [])
    .slice()
    .reverse()
    .map((h) => rateOf(h.rates, "gold", "22K"))
    .filter((v): v is number => v !== null);

  return (
    <Page>
      <PageHeading
        title={t("jewellery.rates.title")}
        description={d ? (d.setToday ? t("jewellery.rates.setFor", { date: formatDate(d.date) }) : t("jewellery.rates.notSet")) : t("jewellery.rates.description")}
      />
      {rates.isError ? (
        <InlineError title={describeError(rates.error, t)} />
      ) : rates.isPending ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-section">
          {error && <InlineError title={error} />}
          <div className="grid gap-4 md:grid-cols-3">
            {METALS.map((metal) => (
              <Card key={metal}>
                <CardHeader>
                  <CardTitle>{metalLabel(metal)}</CardTitle>
                  <CardDescription>{t("jewellery.rates.perGram")}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {PURITIES[metal].map((purity) => {
                    const k = key(metal, purity);
                    const r = card.find((c) => c.metal === metal && c.purity === purity);
                    const typed = !!values[k]?.trim();
                    const derived = !typed && r?.source === "derived";
                    const primary = PRIMARY.has(k);
                    return (
                      <div key={k} className="grid gap-1">
                        <Label htmlFor={`rate-${k}`} className={cn("flex items-center justify-between", !primary && !typed && "text-muted-foreground")}>
                          <span className={cn(primary && "text-base font-semibold")}>{purity}</span>
                          {derived && <span className="text-meta font-normal">{t("jewellery.rates.derived", { base: basePurity(metal) })}</span>}
                        </Label>
                        <Input
                          id={`rate-${k}`}
                          inputMode="decimal"
                          disabled={!canSet}
                          aria-invalid={bad.has(k) || undefined}
                          className={cn("tabular-nums", primary ? "h-12 text-xl font-semibold" : "", derived && "bg-muted/50")}
                          value={values[k] ?? ""}
                          placeholder={r?.ratePerGram != null ? paiseToInput(r.ratePerGram) : "₹"}
                          onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                        />
                        {r?.ratePerGram != null && (
                          <span className="text-meta text-muted-foreground tabular-nums">{t("jewellery.rates.per10g", { amount: money(r.ratePerGram * 10) })}</span>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </div>
          {canSet && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="lg" disabled={save.isPending}>
                {save.isPending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                {t("jewellery.rates.saveCta")}
              </Button>
              <span className="text-sm text-muted-foreground">{lastResult ?? t("jewellery.rates.saveHint")}</span>
            </div>
          )}
        </form>
      )}

      {d && d.history.length > 0 && (
        <Card className="mt-section">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-4">
              {t("jewellery.rates.historyTitle")}
              {spark.length > 1 && (
                <span className="flex items-center gap-2 text-meta font-normal text-muted-foreground">
                  {metalLabel("gold", "22K")} <Sparkline values={spark} className="text-primary" width={120} />
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("jewellery.rates.date")}</TableHead>
                  {HISTORY_COLS.map((c) => (
                    <TableHead key={key(c.metal, c.purity)} className="text-right">
                      {metalLabel(c.metal, c.purity)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.history.map((h) => (
                  <TableRow key={h.date}>
                    <TableCell>{formatDate(h.date)}</TableCell>
                    {HISTORY_COLS.map((c) => {
                      const v = rateOf(h.rates, c.metal, c.purity);
                      return (
                        <TableCell key={key(c.metal, c.purity)} className="text-right tabular-nums">
                          {v === null ? "—" : money(v)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </Page>
  );
}
