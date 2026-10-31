"use client";

import * as React from "react";
import { Loader2Icon, Trash2Icon } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { istTime, isHm } from "../lib/format";
import { useClearMark, useMark } from "../lib/queries";
import { ATTENDANCE_STATUSES, type AttendanceMark, type AttendanceStatus } from "../lib/types";
import { InlineError, LeaveTypeSelect } from "./bits";

export interface MarkTarget {
  employee: { id: string; name: string; code?: string };
  date: string;
  mark: AttendanceMark | null;
}

/**
 * Marks or corrects one person's day: status, leave type, check-in / check-out times, overtime. Changing a day that was
 * already marked asks for a reason (the API keeps every change in the corrections log). "Clear" removes the mark.
 */
export function MarkDialog({ target, onOpenChange }: { target: MarkTarget | null; onOpenChange: (o: boolean) => void }) {
  const { t, formatDate } = useI18n();
  const mark = useMark();
  const clear = useClearMark();
  const [status, setStatus] = React.useState<AttendanceStatus>("present");
  const [leaveTypeId, setLeaveTypeId] = React.useState("");
  const [checkIn, setCheckIn] = React.useState("");
  const [checkOut, setCheckOut] = React.useState("");
  const [ot, setOt] = React.useState("");
  const [note, setNote] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const existing = target?.mark ?? null;

  React.useEffect(() => {
    if (!target) return;
    const m = target.mark;
    setStatus(m?.status ?? "present");
    setLeaveTypeId(m?.leaveTypeId ?? "");
    setCheckIn(istTime(m?.checkIn));
    setCheckOut(istTime(m?.checkOut));
    setOt(m?.overtimeMinutes ? String(m.overtimeMinutes) : "");
    setNote(m?.note ?? "");
    setReason("");
    setSubmitted(false);
    setError(null);
  }, [target]);

  const worked = status === "present" || status === "half_day";
  const errors = {
    leaveType: status === "leave" && !leaveTypeId ? t("payroll.common.required") : null,
    checkIn: worked && checkIn && !isHm(checkIn) ? t("payroll.mark.timeInvalid") : null,
    checkOut: worked && checkOut && (!isHm(checkOut) || !checkIn) ? t("payroll.mark.timeInvalid") : null,
    ot: ot && !/^\d{1,4}$/.test(ot) ? t("payroll.mark.minutesInvalid") : null,
    reason: existing && reason.trim().length < 2 ? t("payroll.mark.reasonRequired") : null,
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    setSubmitted(true);
    setError(null);
    if (Object.values(errors).some(Boolean)) return;
    try {
      await mark.mutateAsync({
        employeeId: target.employee.id,
        date: target.date,
        status,
        leaveTypeId: status === "leave" || status === "half_day" ? leaveTypeId || null : null,
        checkIn: worked ? checkIn || null : null,
        checkOut: worked ? checkOut || null : null,
        overtimeMinutes: worked && ot ? Number(ot) : null,
        note: note.trim() || null,
        reason: existing ? reason.trim() : null,
      });
      toast.success(t("payroll.mark.saved"));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  const remove = async () => {
    if (!target) return;
    setSubmitted(true);
    if (reason.trim().length < 2) return;
    try {
      await clear.mutateAsync({ employeeId: target.employee.id, date: target.date, reason: reason.trim() });
      toast.success(t("payroll.mark.cleared"));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  const err = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("payroll.common.close")} className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{existing ? t("payroll.mark.editTitle") : t("payroll.mark.title")}</DialogTitle>
            <DialogDescription>
              {target?.employee.name} · {target ? formatDate(target.date) : ""}
            </DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>{t("payroll.mark.status")}</FieldLabel>
              <FieldControl>
                <Select value={status} onValueChange={(v) => setStatus(v as AttendanceStatus)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ATTENDANCE_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`payroll.status.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldControl>
            </Field>
            {(status === "leave" || status === "half_day") && (
              <Field invalid={!!err("leaveType")}>
                <FieldLabel optional={status === "half_day"}>{t("payroll.mark.leaveType")}</FieldLabel>
                <FieldControl>
                  <LeaveTypeSelect value={leaveTypeId} onChange={setLeaveTypeId} />
                </FieldControl>
                {status === "half_day" && <FieldHint>{t("payroll.mark.halfDayHint")}</FieldHint>}
                <FieldError>{err("leaveType")}</FieldError>
              </Field>
            )}
          </div>
          {worked && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field invalid={!!err("checkIn")}>
                <FieldLabel optional>{t("payroll.mark.checkIn")}</FieldLabel>
                <FieldControl>
                  <Input type="time" className="min-w-32" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
                </FieldControl>
                <FieldError>{err("checkIn")}</FieldError>
              </Field>
              <Field invalid={!!err("checkOut")}>
                <FieldLabel optional>{t("payroll.mark.checkOut")}</FieldLabel>
                <FieldControl>
                  <Input type="time" className="min-w-32" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
                </FieldControl>
                <FieldError>{err("checkOut")}</FieldError>
              </Field>
              <Field invalid={!!err("ot")}>
                <FieldLabel optional>{t("payroll.mark.overtime")}</FieldLabel>
                <FieldControl>
                  <Input inputMode="numeric" value={ot} placeholder={t("payroll.mark.otAuto")} onChange={(e) => setOt(e.target.value.replace(/\D/g, ""))} />
                </FieldControl>
                <FieldError>{err("ot")}</FieldError>
              </Field>
            </div>
          )}
          <Field>
            <FieldLabel optional>{t("payroll.mark.note")}</FieldLabel>
            <FieldControl>
              <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
            </FieldControl>
          </Field>
          {existing && (
            <Field invalid={!!err("reason") || (submitted && reason.trim().length < 2)}>
              <FieldLabel>{t("payroll.mark.reason")}</FieldLabel>
              <FieldControl>
                <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
              </FieldControl>
              <FieldHint>{t("payroll.mark.reasonHint")}</FieldHint>
              <FieldError>{err("reason")}</FieldError>
            </Field>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            {existing ? (
              <Button type="button" variant="ghost" className="text-destructive" onClick={remove} disabled={clear.isPending}>
                {clear.isPending ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />} {t("payroll.mark.clear")}
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={mark.isPending}>
              {mark.isPending && <Loader2Icon className="animate-spin" />}
              {t("payroll.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
