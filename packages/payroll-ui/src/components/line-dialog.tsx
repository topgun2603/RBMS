"use client";

import * as React from "react";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Label,
  Separator,
  toast,
} from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { hours, money, paiseToRupees, parseHalfDays, rupeesToPaise } from "../lib/format";
import { useAdvances, useRunActions } from "../lib/queries";
import type { Money, RunLine } from "../lib/types";
import { InlineError } from "./bits";

interface Row {
  label: string;
  amount: string;
}

function MoneyRows({ title, rows, onChange, addLabel }: { title: string; rows: Row[]; onChange: (r: Row[]) => void; addLabel: string }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-2">
      <Label>{title}</Label>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <Input aria-label={t("payroll.line.label")} placeholder={t("payroll.line.label")} value={r.label} maxLength={60} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <Input aria-label={t("payroll.line.amount")} className="w-36" inputMode="decimal" placeholder="0" value={r.amount} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          <Button type="button" size="icon" variant="ghost" aria-label={t("payroll.common.delete")} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2Icon />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="justify-self-start" disabled={rows.length >= 10} onClick={() => onChange([...rows, { label: "", amount: "" }])}>
        <PlusIcon /> {addLabel}
      </Button>
    </div>
  );
}

function Breakdown({ title, items, total }: { title: string; items: Money[]; total?: number }) {
  return (
    <div className="grid content-start gap-1 text-sm">
      <span className="font-semibold">{title}</span>
      {items.map((m) => (
        <span key={m.key} className="flex justify-between gap-2">
          <span className="truncate text-muted-foreground">{m.label}</span>
          <span className="tabular-nums">{money(m.amount)}</span>
        </span>
      ))}
      {total !== undefined && (
        <span className="flex justify-between gap-2 border-t pt-1 font-medium">
          <span />
          <span className="tabular-nums">{money(total)}</span>
        </span>
      )}
    </div>
  );
}

/** One person's payroll line: the breakdown, and the owner's changes for a draft (overtime, loss of pay, extras, TDS, advance recovery). */
export function LineDialog({ runId, line, draft, onOpenChange }: { runId: string; line: RunLine | null; draft: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const actions = useRunActions(runId);
  const advances = useAdvances("open");
  const [ot, setOt] = React.useState("");
  const [lop, setLop] = React.useState("");
  const [earnings, setEarnings] = React.useState<Row[]>([]);
  const [deductions, setDeductions] = React.useState<Row[]>([]);
  const [tds, setTds] = React.useState("");
  const [recovery, setRecovery] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!line) return;
    const a = line.adjustments;
    setOt(a.overtimeMinutes !== undefined && a.overtimeMinutes !== null ? String(a.overtimeMinutes) : "");
    setLop(a.extraLopDays ? String(a.extraLopDays) : "");
    setEarnings((a.earnings ?? []).map((x) => ({ label: x.label, amount: paiseToRupees(x.amount) })));
    setDeductions((a.deductions ?? []).map((x) => ({ label: x.label, amount: paiseToRupees(x.amount) })));
    setTds(a.tds ? paiseToRupees(a.tds) : "");
    setRecovery(Object.fromEntries(Object.entries(a.advanceRecovery ?? {}).map(([k, v]) => [k, paiseToRupees(v)])));
    setError(null);
  }, [line]);

  const mine = (advances.data?.items ?? []).filter((x) => line && x.employeeId === line.employeeId);
  const rowsOk = (rows: Row[]) => rows.every((r) => r.label.trim() && rupeesToPaise(r.amount) !== null);
  const errors = {
    ot: ot && !/^\d{1,6}$/.test(ot) ? t("payroll.mark.minutesInvalid") : null,
    lop: lop && parseHalfDays(lop, true) === null ? t("payroll.common.halfDaysInvalid") : null,
    rows: !rowsOk(earnings) || !rowsOk(deductions) ? t("payroll.line.rowsInvalid") : null,
    tds: tds && rupeesToPaise(tds) === null ? t("payroll.common.amountInvalid") : null,
    recovery: Object.values(recovery).some((v) => v.trim() && rupeesToPaise(v) === null) ? t("payroll.common.amountInvalid") : null,
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!line || Object.values(errors).some(Boolean)) return;
    setError(null);
    const adv: Record<string, number> = {};
    for (const [k, v] of Object.entries(recovery)) if (v.trim()) adv[k] = rupeesToPaise(v) ?? 0;
    try {
      await actions.adjust.mutateAsync({
        lineId: line.id,
        overtimeMinutes: ot ? Number(ot) : null,
        extraLopDays: lop ? parseHalfDays(lop, true) : null,
        earnings: earnings.map((r) => ({ label: r.label.trim(), amount: rupeesToPaise(r.amount) ?? 0 })),
        deductions: deductions.map((r) => ({ label: r.label.trim(), amount: rupeesToPaise(r.amount) ?? 0 })),
        tds: tds ? rupeesToPaise(tds) : null,
        advanceRecovery: adv,
      });
      toast.success(t("payroll.line.saved"));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  const d = line?.days;
  return (
    <Dialog open={!!line} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("payroll.common.close")} className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{line?.snapshot.name}</DialogTitle>
            <DialogDescription>
              {line ? t("payroll.line.daysSummary", { paid: line.paidDays, basis: line.basisDays, lop: d?.lopDays ?? 0, ot: hours(d?.overtimeMinutes ?? 0) }) : ""}
            </DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          {line && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Breakdown title={t("payroll.line.earnings")} items={line.earnings} total={line.gross} />
              <Breakdown title={t("payroll.line.deductions")} items={line.deductions} total={line.totalDeductions} />
              <div className="grid content-start gap-1 text-sm">
                {line.employer.length > 0 && <Breakdown title={t("payroll.line.employer")} items={line.employer} />}
                {line.roundOff !== 0 && (
                  <span className="flex justify-between">
                    <span className="text-muted-foreground">{t("payroll.line.roundOff")}</span>
                    <span className="tabular-nums">{money(line.roundOff)}</span>
                  </span>
                )}
                <span className="mt-2 flex justify-between text-base font-semibold">
                  <span>{t("payroll.col.net")}</span>
                  <span className="tabular-nums">{money(line.net)}</span>
                </span>
              </div>
            </div>
          )}
          {draft && line && (
            <>
              <Separator />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field invalid={!!errors.ot}>
                  <FieldLabel optional>{t("payroll.line.otMinutes")}</FieldLabel>
                  <FieldControl>
                    <Input inputMode="numeric" value={ot} placeholder={String(line.days.overtimeMinutes)} onChange={(e) => setOt(e.target.value.replace(/\D/g, ""))} />
                  </FieldControl>
                  <FieldHint>{t("payroll.line.otHint")}</FieldHint>
                  <FieldError>{errors.ot}</FieldError>
                </Field>
                <Field invalid={!!errors.lop}>
                  <FieldLabel optional>{t("payroll.line.extraLop")}</FieldLabel>
                  <FieldControl>
                    <Input inputMode="decimal" value={lop} placeholder="0" onChange={(e) => setLop(e.target.value)} />
                  </FieldControl>
                  <FieldHint>{t("payroll.line.extraLopHint")}</FieldHint>
                  <FieldError>{errors.lop}</FieldError>
                </Field>
                <Field invalid={!!errors.tds}>
                  <FieldLabel optional>{t("payroll.line.tds")}</FieldLabel>
                  <FieldControl>
                    <Input inputMode="decimal" value={tds} placeholder="0" onChange={(e) => setTds(e.target.value)} />
                  </FieldControl>
                  <FieldHint>{t("payroll.line.tdsHint")}</FieldHint>
                  <FieldError>{errors.tds}</FieldError>
                </Field>
              </div>
              <MoneyRows title={t("payroll.line.extraEarnings")} rows={earnings} onChange={setEarnings} addLabel={t("payroll.line.addEarning")} />
              <MoneyRows title={t("payroll.line.extraDeductions")} rows={deductions} onChange={setDeductions} addLabel={t("payroll.line.addDeduction")} />
              {errors.rows && <p className="text-sm text-destructive">{errors.rows}</p>}
              {mine.length > 0 && (
                <div className="grid gap-2">
                  <Label>{t("payroll.line.recovery")}</Label>
                  {mine.map((a) => (
                    <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="min-w-48 flex-1 text-muted-foreground">{t("payroll.line.advanceInfo", { date: a.date, outstanding: money(a.outstanding), instalment: money(a.instalment) })}</span>
                      <Input
                        aria-label={t("payroll.line.recovery")}
                        className="w-36"
                        inputMode="decimal"
                        placeholder={paiseToRupees(Math.min(a.instalment, a.outstanding))}
                        value={recovery[a.id] ?? ""}
                        onChange={(e) => setRecovery((r) => ({ ...r, [a.id]: e.target.value }))}
                      />
                    </div>
                  ))}
                  {errors.recovery && <p className="text-sm text-destructive">{errors.recovery}</p>}
                </div>
              )}
              <DialogFooter>
                <Button type="submit" disabled={actions.adjust.isPending}>
                  {actions.adjust.isPending && <Loader2Icon className="animate-spin" />}
                  {t("payroll.line.recompute")}
                </Button>
              </DialogFooter>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
