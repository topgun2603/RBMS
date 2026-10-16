"use client";

import * as React from "react";
import { apiDownload, describeError, useFeature, useI18n } from "@srirealtime/web";
import { AlertTriangleIcon, ChevronDownIcon, FileJson2Icon, Loader2Icon } from "lucide-react";
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
} from "@srirealtime/ui";
import { useHasPermission } from "../../lib/access";
import { defaultGstr1Period, gstr1Periods } from "../../lib/einvoice";
import { useGstr1Summary } from "../../lib/queries-growth";

const FEATURE = "gst-einvoice";
const PERMISSION = "einvoice.manage";

/** GSTR-1 JSON download for a month (feature `gst-einvoice`, permission `einvoice.manage`). Renders nothing otherwise. */
export function Gstr1Card() {
  const on = useFeature(FEATURE);
  const allowed = useHasPermission(PERMISSION);
  if (!on || !allowed) return null;
  return <Gstr1CardInner />;
}

function Gstr1CardInner() {
  const { t, formatDate } = useI18n();
  const periods = React.useMemo(() => gstr1Periods(new Date(), 18), []);
  const [period, setPeriod] = React.useState(() => defaultGstr1Period(new Date()));
  const [busy, setBusy] = React.useState(false);
  const [showWarnings, setShowWarnings] = React.useState(false);
  const summary = useGstr1Summary(period);
  const label = (p: { year: number; month: number }) => formatDate(new Date(Date.UTC(p.year, p.month - 1, 15)), { month: "long", year: "numeric" });

  const download = async () => {
    setBusy(true);
    try {
      await apiDownload("/einvoice/gstr1.json", { period }, `GSTR1_${period}.json`);
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
    </Card>
  );
}
