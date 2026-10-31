"use client";

import * as React from "react";
import { AlertCircleIcon, AlertTriangleIcon, DownloadIcon, InfoIcon, Loader2Icon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, cn, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusPill, toast } from "@rbms/ui";
import { apiDownload, describeError, tOr, useI18n, type QueryParams } from "@rbms/web";
import { useHasPermission } from "../../lib/access";
import { money, todayIST } from "../../lib/format";
import { GST_MANAGE, isQuarterKey, monthOptions, parseQuarter, quarterOptions, type CellId, type FilingIssue, type RcmCategory } from "../../lib/gst";

/** A plain amount in rupees, a dash when zero. */
export const Amt = ({ v, bold }: { v: number; bold?: boolean }) =>
  v === 0 ? <span className="text-muted-foreground">-</span> : <span className={cn("tabular-nums", bold && "font-semibold")}>{money(v)}</span>;

export const useCanManage = () => useHasPermission(GST_MANAGE);

/** "September 2026" or "Q2 (Jul-Sep 2026)". */
export function usePeriodLabel() {
  const { t, formatDate } = useI18n();
  return React.useCallback(
    (key: string): string => {
      const m = (month: string, opts: Intl.DateTimeFormatOptions) => formatDate(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 15)), opts);
      if (isQuarterKey(key)) {
        const q = parseQuarter(key);
        if (!q) return key;
        return t("billing.gst.quarterLabel", { q: q.q, from: m(q.months[0], { month: "short" }), to: m(q.months[2], { month: "short", year: "numeric" }) });
      }
      if (/^\d{4}-\d{2}$/.test(key)) return m(key, { month: "long", year: "numeric" });
      if (/^FY\d{4}-\d{2}$/.test(key)) return t("billing.gst.fyLabel", { fy: key.slice(2) });
      return key;
    },
    [t, formatDate],
  );
}

/** All the translated words of the GST centre that depend on a code from the server. */
export function useGstText() {
  const { t, formatDate, locale } = useI18n();
  const label = usePeriodLabel();
  const returnName = (type: string) => tOr(t, `billing.gst.return.${type}`, type.toUpperCase());
  const dateText = (d: string) => formatDate(d, { day: "numeric", month: "short", year: "numeric" });
  return {
    returnName,
    dateText,
    label,
    /** Plain sentence for a "fix before filing" or profile issue. */
    issue(i: Pick<FilingIssue, "code" | "params" | "count">): string {
      const p = i.params ?? {};
      const vars: Record<string, string | number> = { count: i.count ?? 0 };
      for (const [k, v] of Object.entries(p)) vars[k] = v;
      if (typeof p.amount === "number") vars.amount = money(p.amount);
      if (typeof p.period === "string") vars.period = label(p.period);
      if (typeof p.due === "string") vars.due = dateText(p.due);
      if (typeof p.returnType === "string") vars.returnType = returnName(p.returnType);
      const k = `billing.gst.issue.${i.code}`;
      return t.has(k) ? t(k, vars) : i.code;
    },
    /** One line about one document in the GSTR-1 check. */
    g1Problem: (code: string) => tOr(t, `billing.gst.g1.problem.${code}`, code),
    reason: (code: string) => tOr(t, `billing.gst.itc.reason.${code}`, code),
    cell: (id: CellId | string) => tOr(t, `billing.gst.cell.${id}`, id),
    rcmName: (c: Pick<RcmCategory, "name" | "nameTa">) => (locale === "ta" && c.nameTa ? c.nameTa : c.name),
    rcmKey(cats: RcmCategory[] | undefined, key: string | null) {
      if (!key) return "";
      const c = cats?.find((x) => x.key === key);
      return c ? (locale === "ta" && c.nameTa ? c.nameTa : c.name) : key;
    },
  };
}

export function SeverityPill({ severity }: { severity: "error" | "warning" | "info" }) {
  const { t } = useI18n();
  const Icon = severity === "error" ? AlertCircleIcon : severity === "warning" ? AlertTriangleIcon : InfoIcon;
  return (
    <StatusPill tone={severity === "error" ? "danger" : severity === "warning" ? "warning" : "info"} icon={Icon}>
      {t(`billing.gst.severity.${severity}`)}
    </StatusPill>
  );
}

/** Card with a title, a one-line explanation and optional actions. */
export function Section({
  title,
  hint,
  actions,
  children,
  className,
  flush,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Table inside: no side padding. */
  flush?: boolean;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">{title}</CardTitle>
            {hint && <p className="mt-1 text-meta text-muted-foreground">{hint}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      </CardHeader>
      <CardContent className={flush ? "px-0 sm:px-2" : undefined}>{children}</CardContent>
    </Card>
  );
}

/** Month or quarter picker. */
export function PeriodPicker({
  value,
  onChange,
  kind,
  label,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  kind: "month" | "quarter";
  label?: string;
  id?: string;
}) {
  const { t } = useI18n();
  const text = usePeriodLabel();
  const options = React.useMemo(() => {
    const list = kind === "month" ? monthOptions(todayIST(), 30) : quarterOptions(todayIST(), 12);
    return list.includes(value) ? list : [value, ...list];
  }, [kind, value]);
  const pid = id ?? `gst-period-${kind}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={pid}>{label ?? t(kind === "month" ? "billing.gst.month" : "billing.gst.quarter")}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={pid} className="w-full min-w-48 sm:w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {text(o)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Downloads a file the API builds (CSV or the portal JSON); errors become a toast. */
export function FileButton({
  path,
  params,
  fileName,
  label,
  icon,
  variant = "outline",
  disabled,
  beforeRun,
}: {
  path: string;
  params: QueryParams;
  fileName: string;
  label: string;
  icon?: React.ReactNode;
  variant?: "outline" | "default";
  disabled?: boolean;
  /** Return false to stop (for example after a "download anyway?" question). */
  beforeRun?: () => boolean;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    if (beforeRun && !beforeRun()) return;
    setBusy(true);
    try {
      await apiDownload(path, params, fileName);
      toast.success(t("billing.common.downloaded"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" variant={variant} className="h-11 sm:h-9" onClick={() => void run()} disabled={busy || disabled} aria-busy={busy} data-print-hide>
      {busy ? <Loader2Icon className="animate-spin" /> : (icon ?? <DownloadIcon />)}
      {busy ? t("billing.common.downloading") : label}
    </Button>
  );
}

/** Shown to people who can look but not change. */
export function ViewOnlyNote() {
  const { t } = useI18n();
  return (
    <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
      <InfoIcon className="size-4 shrink-0" />
      {t("billing.gst.viewOnly")}
    </p>
  );
}

/** Rupees typed in a box to paise; empty is 0. Returns null for something that is not a number. */
export function rupeesToPaiseOrNull(input: string): number | null {
  const s = input.replace(/[,\s₹]/g, "");
  if (s === "") return 0;
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
