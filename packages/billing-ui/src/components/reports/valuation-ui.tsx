"use client";

import * as React from "react";
import { FileDownIcon, Loader2Icon, ScaleIcon } from "lucide-react";
import { Button, Card, ChipGroup, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, toast } from "@srirealtime/ui";
import { describeError, useI18n, useOptionalSession, type QueryParams } from "@srirealtime/web";
import { usePdf } from "../../lib/pdf";
import { useSetValuationMethod, useValuationSettings, type ValuationMethod } from "../../lib/valuation";
import { DownloadCsvButton } from "./report-ui";

/** CSV and PDF downloads of a report (the same query for both). */
export function DownloadBar({ csvPath, pdfPath, params, name }: { csvPath: string; pdfPath: string; params: QueryParams; name: string }) {
  const { t } = useI18n();
  const pdf = usePdf();
  const query = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Record<string, string>;
  return (
    <div className="flex flex-wrap gap-2" data-print-hide>
      <DownloadCsvButton path={csvPath} params={query} fileName={`${name}.csv`} size="sm" />
      <Button type="button" variant="outline" size="sm" className="h-9" disabled={pdf.busy === name} onClick={() => void pdf.run(name, pdfPath, { query, mode: "download", fallbackName: `${name}.pdf` })}>
        {pdf.busy === name ? <Loader2Icon className="animate-spin" /> : <FileDownIcon />}
        {t("billing.valuation.pdf")}
      </Button>
    </div>
  );
}

/** The shop's valuation method, its history, and (owner / admin) the switch from the start of a financial year. */
export function MethodCard() {
  const { t, formatDate } = useI18n();
  const session = useOptionalSession();
  const canManage = Boolean(session?.canManage);
  const q = useValuationSettings();
  const [open, setOpen] = React.useState(false);
  const s = q.data;
  const dLong = (d: string) => formatDate(d, { day: "numeric", month: "short", year: "numeric" });
  return (
    <Card className="px-card gap-2 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="icon-chip size-8 text-primary">
          <ScaleIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          {s ? (
            <p className="text-sm font-medium">{t("billing.valuation.methodNow", { method: t(`billing.valuation.method.${s.methodToday}`) })}</p>
          ) : (
            <Skeleton className="h-4 w-48" />
          )}
          <p className="text-meta text-muted-foreground">
            {s?.history.length
              ? s.history.map((h) => t("billing.valuation.methodFrom", { method: t(`billing.valuation.method.${h.method}`), date: dLong(h.from) })).join(" · ")
              : t("billing.valuation.methodHint")}
          </p>
        </div>
        {canManage && s && (
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setOpen(true)} disabled={s.allowedFrom.length === 0}>
            {t("billing.valuation.change")}
          </Button>
        )}
      </div>
      {s && open && <MethodDialog open={open} onOpenChange={setOpen} current={s.methodToday} allowedFrom={s.allowedFrom} />}
    </Card>
  );
}

function MethodDialog({ open, onOpenChange, current, allowedFrom }: { open: boolean; onOpenChange: (o: boolean) => void; current: ValuationMethod; allowedFrom: string[] }) {
  const { t, formatDate } = useI18n();
  const set = useSetValuationMethod();
  const [method, setMethod] = React.useState<ValuationMethod>(current === "fifo" ? "average" : "fifo");
  const [from, setFrom] = React.useState(allowedFrom[0] ?? "");
  const save = async () => {
    try {
      await set.mutateAsync({ method, from });
      toast.success(t("billing.valuation.changed"));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !set.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.valuation.changeTitle")}</DialogTitle>
          <DialogDescription>{t("billing.valuation.changeBody")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>{t("billing.valuation.methodLabel")}</Label>
            <ChipGroup
              size="sm"
              aria-label={t("billing.valuation.methodLabel")}
              value={method}
              onChange={(v) => setMethod(v as ValuationMethod)}
              options={[
                { value: "average", label: t("billing.valuation.method.average") },
                { value: "fifo", label: t("billing.valuation.method.fifo") },
              ]}
            />
            <p className="text-meta text-muted-foreground">{t(`billing.valuation.methodAbout.${method}`)}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="val-from">{t("billing.valuation.fromLabel")}</Label>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger id="val-from" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allowedFrom.map((d) => (
                  <SelectItem key={d} value={d}>
                    {formatDate(d, { day: "numeric", month: "long", year: "numeric" })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="rounded-xl bg-warning/12 px-3 py-2.5 text-sm text-warning-ink">{t("billing.valuation.warning")}</p>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={set.isPending}>
            {t("billing.common.cancel")}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={set.isPending || !from || method === current}>
            {set.isPending && <Loader2Icon className="animate-spin" />}
            {t("billing.valuation.confirmChange")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
