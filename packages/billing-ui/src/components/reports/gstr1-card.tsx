"use client";

import * as React from "react";
import { api, apiDownload, describeError, FiguresTables, useAiAssistAllowed, useFeature, useI18n, type AskTable } from "@rbms/web";
import { AlertTriangleIcon, ChevronDownIcon, FileJson2Icon, Loader2Icon, SparklesIcon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  Card,
  Field,
  FieldControl,
  FieldLabel,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from "@rbms/ui";
import { useHasPermission } from "../../lib/access";
import { defaultGstr1Period, gstr1Periods } from "../../lib/einvoice";
import { useGstr1Summary } from "../../lib/queries-growth";

// Every GST-registered shop files GSTR-1: same gate as the GST summary, not e-invoicing.
const FEATURE = "invoices.gst-reports";
const PERMISSION = "reports.view";

/** GSTR-1 JSON download for a month (feature `invoices.gst-reports`, permission `reports.view`). Renders nothing otherwise. */
export function Gstr1Card() {
  const on = useFeature(FEATURE);
  const allowed = useHasPermission(PERMISSION);
  if (!on || !allowed) return null;
  return <Gstr1CardInner />;
}

function saveJson(json: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(json)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface GstExplainResponse {
  monthLabel: string;
  note: { summary: string; what_changed: string[]; unusual: string[]; fix_before_filing: string[] } | null;
  fallback: boolean;
  blocks: AskTable[];
  credits: number;
}

function Gstr1CardInner() {
  const { t, formatDate, locale } = useI18n();
  const canExplain = useAiAssistAllowed(PERMISSION);
  const [explaining, setExplaining] = React.useState(false);
  const [explained, setExplained] = React.useState<GstExplainResponse | null>(null);
  const periods = React.useMemo(() => gstr1Periods(new Date(), 18), []);
  const [period, setPeriod] = React.useState(() => defaultGstr1Period(new Date()));
  const [busy, setBusy] = React.useState(false);
  const [showWarnings, setShowWarnings] = React.useState(false);
  const summary = useGstr1Summary(period);
  const label = (p: { year: number; month: number }) => formatDate(new Date(Date.UTC(p.year, p.month - 1, 15)), { month: "long", year: "numeric" });

  const explain = async () => {
    setExplaining(true);
    try {
      setExplained(await api.post<GstExplainResponse>("/ai/ask/gst", { period, language: locale === "ta" ? "ta" : "en" }));
    } catch (err) {
      setExplained(null);
      toast.error(describeError(err, t));
    } finally {
      setExplaining(false);
    }
  };

  const download = async () => {
    setBusy(true);
    try {
      // The check above already built this month's file (a busy month takes a while): save that one. Otherwise ask again.
      const ready = summary.data && !summary.isPlaceholderData && summary.data.json?.fp === period ? summary.data : null;
      if (ready?.json) saveJson(ready.json, ready.filename ?? `GSTR1_${period}.json`);
      else await apiDownload("/einvoice/gstr1.json", { period }, `GSTR1_${period}.json`);
      toast.success(t("billing.gstr1.downloaded"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const s = summary.data;
  const warnings = s?.warnings ?? [];

  return (
    <Card className="px-card">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="icon-chip size-9 shrink-0 text-primary">
            <FileJson2Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="font-heading text-sm font-semibold">{t("billing.gstr1.title")}</h2>
            <p className="text-meta text-muted-foreground">{t("billing.gstr1.body")}</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[12rem_auto] sm:items-end">
          <Field>
            <FieldLabel>{t("billing.gstr1.period")}</FieldLabel>
            <Select value={period} onValueChange={setPeriod}>
              <FieldControl>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {label(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button onClick={() => void download()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : <FileJson2Icon />}
            {t("billing.gstr1.download")}
          </Button>
          {canExplain && (
            <Button variant="outline" onClick={() => void explain()} disabled={explaining} title={t("billing.gstr1.explain.hint")}>
              {explaining ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
              {explaining ? t("billing.gstr1.explain.busy") : t("billing.gstr1.explain.button")}
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-5 text-xs text-muted-foreground" aria-live="polite">
        {summary.isPending ? (
          <span className="flex items-center gap-2">
            <Skeleton className="h-3 w-40" />
            <span className="sr-only">{t("billing.gstr1.checking")}</span>
          </span>
        ) : summary.isError && !s ? (
          <span>{t("billing.gstr1.summaryError")}</span>
        ) : s ? (
          <div className="grid gap-1.5">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
              <span>{t("billing.gstr1.counts", { b2b: s.counts.b2b, b2cl: s.counts.b2cl, b2cs: s.counts.b2cs })}</span>
              {s.counts.cancelled > 0 && <span>{t("billing.gstr1.cancelled", { count: s.counts.cancelled })}</span>}
              {s.counts.skipped > 0 && <span>{t("billing.gstr1.skipped", { count: s.counts.skipped })}</span>}
              {warnings.length > 0 && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 font-medium text-warning-ink hover:underline"
                  aria-expanded={showWarnings}
                  onClick={() => setShowWarnings((v) => !v)}
                >
                  <AlertTriangleIcon className="size-3.5" />
                  {t("billing.gstr1.warningsTitle", { count: warnings.length })}
                  <ChevronDownIcon className={showWarnings ? "size-3.5 rotate-180 transition-transform" : "size-3.5 transition-transform"} />
                </button>
              )}
            </p>
            <AnimatePresence initial={false}>
              {showWarnings && warnings.length > 0 && (
                <motion.ul
                  key="w"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="grid list-disc gap-1 overflow-hidden rounded-md bg-warning/10 py-2 pr-2 pl-6 text-foreground"
                >
                  {warnings.slice(0, 20).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        ) : null}
      </div>
      {explained && (
        <div className="grid gap-3 rounded-xl bg-primary/5 p-3 text-sm ring-1 ring-primary/20 ring-inset" aria-live="polite" lang={locale === "ta" ? "ta" : "en"}>
          <h3 className="font-heading text-sm font-semibold">{t("billing.gstr1.explain.title", { month: explained.monthLabel })}</h3>
          {explained.fallback || !explained.note ? (
            <p className="text-xs text-warning-ink">{t("billing.gstr1.explain.fallback")}</p>
          ) : (
            <>
              <p>{explained.note.summary}</p>
              {(
                [
                  ["billing.gstr1.explain.changed", explained.note.what_changed],
                  ["billing.gstr1.explain.unusual", explained.note.unusual],
                  ["billing.gstr1.explain.fix", explained.note.fix_before_filing],
                ] as const
              )
                .filter(([, items]) => items.length > 0)
                .map(([key, items]) => (
                  <div key={key} className="grid gap-1">
                    <p className="text-xs font-semibold">{t(key)}</p>
                    <ul className="grid list-disc gap-1 pl-5">
                      {items.map((x, k) => (
                        <li key={k}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </>
          )}
          <FiguresTables blocks={explained.blocks} ta={locale === "ta"} />
          <p className="text-meta text-muted-foreground">
            {t("billing.gstr1.explain.disclaimer")} {t("billing.gstr1.explain.credits", { count: explained.credits })}
          </p>
        </div>
      )}
    </Card>
  );
}
