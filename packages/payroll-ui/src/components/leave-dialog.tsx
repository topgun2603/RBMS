"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
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
  FieldLabel,
  Input,
  Label,
  Switch,
  toast,
} from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { todayIst } from "../lib/format";
import { useRequestLeave } from "../lib/queries";
import { EmployeeSelect, InlineError, LeaveTypeSelect } from "./bits";

/**
 * Files a leave request. `self` = the signed-in person's own (no staff picker, no "approve now"); otherwise a manager
 * files it for someone and may approve it at once.
 */
export function LeaveDialog({ open, onOpenChange, self = false }: { open: boolean; onOpenChange: (o: boolean) => void; self?: boolean }) {
  const { t } = useI18n();
  const request = useRequestLeave(self);
  const [employeeId, setEmployeeId] = React.useState("");
  const [leaveTypeId, setLeaveTypeId] = React.useState("");
  const [from, setFrom] = React.useState(todayIst());
  const [to, setTo] = React.useState(todayIst());
  const [halfDay, setHalfDay] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [approve, setApprove] = React.useState(true);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEmployeeId("");
    setLeaveTypeId("");
    setFrom(todayIst());
    setTo(todayIst());
    setHalfDay(false);
    setReason("");
    setApprove(true);
    setSubmitted(false);
    setError(null);
  }, [open]);

  const errors = {
    employee: !self && !employeeId ? t("payroll.common.required") : null,
    type: !leaveTypeId ? t("payroll.common.required") : null,
    to: to < from ? t("payroll.leave.toBeforeFrom") : null,
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (Object.values(errors).some(Boolean)) return;
    try {
      const r = await request.mutateAsync({
        employeeId: self ? undefined : employeeId,
        leaveTypeId,
        from,
        to: halfDay ? from : to,
        halfDay,
        reason: reason.trim() || null,
        approve: !self && approve,
      });
      toast.success(r.status === "approved" ? t("payroll.leave.approvedToast") : t("payroll.leave.requestedToast"));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  const err = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("payroll.common.close")} className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{self ? t("payroll.leave.requestTitle") : t("payroll.leave.newTitle")}</DialogTitle>
            <DialogDescription>{t("payroll.leave.newBody")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <div className="grid gap-4 sm:grid-cols-2">
            {!self && (
              <Field invalid={!!err("employee")}>
                <FieldLabel>{t("payroll.col.name")}</FieldLabel>
                <FieldControl>
                  <EmployeeSelect value={employeeId} onChange={setEmployeeId} />
                </FieldControl>
                <FieldError>{err("employee")}</FieldError>
              </Field>
            )}
            <Field invalid={!!err("type")}>
              <FieldLabel>{t("payroll.mark.leaveType")}</FieldLabel>
              <FieldControl>
                <LeaveTypeSelect value={leaveTypeId} onChange={setLeaveTypeId} />
              </FieldControl>
              <FieldError>{err("type")}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("payroll.leave.from")}</FieldLabel>
              <FieldControl>
                <Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
              </FieldControl>
            </Field>
            {!halfDay && (
              <Field invalid={!!err("to")}>
                <FieldLabel>{t("payroll.leave.to")}</FieldLabel>
                <FieldControl>
                  <Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
                </FieldControl>
                <FieldError>{err("to")}</FieldError>
              </Field>
            )}
          </div>
          <Label className="flex items-center gap-3 font-normal">
            <Switch checked={halfDay} onCheckedChange={setHalfDay} />
            {t("payroll.leave.halfDay")}
          </Label>
          <Field>
            <FieldLabel optional>{t("payroll.leave.reason")}</FieldLabel>
            <FieldControl>
              <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </FieldControl>
          </Field>
          {!self && (
            <Label className="flex items-center gap-3 font-normal">
              <Switch checked={approve} onCheckedChange={setApprove} />
              {t("payroll.leave.approveNow")}
            </Label>
          )}
          <DialogFooter>
            <Button type="submit" disabled={request.isPending}>
              {request.isPending && <Loader2Icon className="animate-spin" />}
              {self ? t("payroll.leave.send") : t("payroll.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
