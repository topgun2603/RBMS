"use client";

import * as React from "react";
import { HandCoinsIcon, Loader2Icon, PencilIcon, PlusIcon, XIcon } from "lucide-react";
import {
  Button,
  ChipGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Skeleton,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@rbms/ui";
import { ConfirmDialog, describeError, Page, PageHeading, useI18n } from "@rbms/web";
import { EmployeeSelect, InlineError, MethodSelect, MonthInput } from "../components/bits";
import { money, paiseToRupees, rupeesToPaise, todayIst } from "../lib/format";
import { useAdvances, useCancelAdvance, useCreateAdvance, useUpdateAdvance } from "../lib/queries";
import type { Advance, PayMethod } from "../lib/types";

/** Salary advances and loans to staff, recovered month by month from payroll. */
export default function AdvancesPage() {
  const { t, formatDate } = useI18n();
  const [status, setStatus] = React.useState<"open" | "closed" | "all">("open");
  const list = useAdvances(status);
  const cancel = useCancelAdvance();
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<Advance | null>(null);
  const [cancelling, setCancelling] = React.useState<Advance | null>(null);
  const items = list.data?.items ?? [];

  return (
    <Page>
      <PageHeading
        title={t("payroll.advances.title")}
        description={list.data ? t("payroll.advances.outstanding", { amount: money(list.data.outstanding) }) : t("payroll.advances.description")}
        actions={
          <Button onClick={() => setAdding(true)}>
            <PlusIcon /> {t("payroll.advances.new")}
          </Button>
        }
      />
      <ChipGroup
        size="sm"
        aria-label={t("payroll.col.status")}
        value={status}
        onChange={(v) => setStatus(v as typeof status)}
        options={[
          { value: "open", label: t("payroll.advances.open") },
          { value: "closed", label: t("payroll.advances.closed") },
          { value: "all", label: t("payroll.common.all") },
        ]}
      />
      {list.isError ? (
        <InlineError title={describeError(list.error, t)} />
      ) : list.isPending ? (
        <Skeleton className="h-40" />
      ) : items.length === 0 ? (
        <EmptyState icon={HandCoinsIcon} title={t("payroll.advances.emptyTitle")} description={t("payroll.advances.emptyBody")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("payroll.col.date")}</TableHead>
              <TableHead>{t("payroll.col.name")}</TableHead>
              <TableHead numeric>{t("payroll.advances.amount")}</TableHead>
              <TableHead numeric>{t("payroll.advances.instalment")}</TableHead>
              <TableHead numeric>{t("payroll.advances.recovered")}</TableHead>
              <TableHead numeric>{t("payroll.advances.left")}</TableHead>
              <TableHead>{t("payroll.leave.reason")}</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{formatDate(a.date)}</TableCell>
                <TableCell className="font-medium">{a.employeeName}</TableCell>
                <TableCell numeric>{money(a.amount)}</TableCell>
                <TableCell numeric>{money(a.instalment)}</TableCell>
                <TableCell numeric>{money(a.recovered)}</TableCell>
                <TableCell numeric>
                  {a.status === "cancelled" ? (
                    <StatusPill tone="neutral">{t("payroll.advances.cancelled")}</StatusPill>
                  ) : a.outstanding === 0 ? (
                    <StatusPill tone="success">{t("payroll.advances.cleared")}</StatusPill>
                  ) : (
                    money(a.outstanding)
                  )}
                </TableCell>
                <TableCell className="max-w-56 truncate">{a.reason ?? "—"}</TableCell>
                <TableCell className="text-right">
                  {a.status === "open" && a.outstanding > 0 && (
                    <Button size="icon" variant="ghost" className="size-8" aria-label={t("payroll.common.edit")} onClick={() => setEditing(a)}>
                      <PencilIcon />
                    </Button>
                  )}
                  {a.status === "open" && a.recovered === 0 && (
                    <Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label={t("payroll.common.cancel")} onClick={() => setCancelling(a)}>
                      <XIcon />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <AdvanceDialog open={adding} onOpenChange={setAdding} />
      <InstalmentDialog advance={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={t("payroll.advances.cancelTitle")}
        description={t("payroll.advances.cancelBody", { name: cancelling?.employeeName ?? "", amount: money(cancelling?.amount) })}
        confirmLabel={t("payroll.advances.cancelCta")}
        destructive
        onConfirm={async () => {
          if (!cancelling) return;
          try {
            await cancel.mutateAsync(cancelling.id);
            toast.success(t("payroll.advances.cancelledToast"));
            setCancelling(null);
          } catch (err) {
            toast.error(describeError(err, t));
          }
        }}
      />
    </Page>
  );
}

function AdvanceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const create = useCreateAdvance();
  const [employeeId, setEmployeeId] = React.useState("");
  const [date, setDate] = React.useState(todayIst());
  const [amount, setAmount] = React.useState("");
  const [instalment, setInstalment] = React.useState("");
  const [startMonth, setStartMonth] = React.useState(todayIst().slice(0, 7));
  const [method, setMethod] = React.useState<PayMethod>("cash");
  const [reason, setReason] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEmployeeId("");
    setDate(todayIst());
    setAmount("");
    setInstalment("");
    setStartMonth(todayIst().slice(0, 7));
    setMethod("cash");
    setReason("");
    setSubmitted(false);
    setError(null);
  }, [open]);

  const a = rupeesToPaise(amount);
  const i = rupeesToPaise(instalment);
  const errors = {
    employee: !employeeId ? t("payroll.common.required") : null,
    amount: !a ? t("payroll.common.amountInvalid") : null,
    instalment: !i ? t("payroll.common.amountInvalid") : a && i && i > a ? t("payroll.advances.instalmentTooBig") : null,
  };
  const months = a && i ? Math.ceil(a / i) : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (Object.values(errors).some(Boolean)) return;
    try {
      await create.mutateAsync({ employeeId, date, amount: a!, instalment: i!, startMonth, method, reason: reason.trim() || null });
      toast.success(t("payroll.advances.saved"));
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
            <DialogTitle>{t("payroll.advances.new")}</DialogTitle>
            <DialogDescription>{t("payroll.advances.newBody")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field invalid={!!err("employee")}>
              <FieldLabel>{t("payroll.col.name")}</FieldLabel>
              <FieldControl>
                <EmployeeSelect value={employeeId} onChange={setEmployeeId} />
              </FieldControl>
              <FieldError>{err("employee")}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("payroll.col.date")}</FieldLabel>
              <FieldControl>
                <Input type="date" value={date} max={todayIst()} onChange={(e) => e.target.value && setDate(e.target.value)} />
              </FieldControl>
            </Field>
            <Field invalid={!!err("amount")}>
              <FieldLabel>{t("payroll.advances.amount")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </FieldControl>
              <FieldError>{err("amount")}</FieldError>
            </Field>
            <Field invalid={!!err("instalment")}>
              <FieldLabel>{t("payroll.advances.instalment")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={instalment} onChange={(e) => setInstalment(e.target.value)} />
              </FieldControl>
              {months > 0 && <FieldHint>{t("payroll.advances.months", { count: months })}</FieldHint>}
              <FieldError>{err("instalment")}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("payroll.advances.startMonth")}</FieldLabel>
              <FieldControl>
                <MonthInput value={startMonth} onChange={setStartMonth} />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{t("payroll.advances.method")}</FieldLabel>
              <FieldControl>
                <MethodSelect value={method} onChange={(m) => m && setMethod(m)} />
              </FieldControl>
            </Field>
          </div>
          <Field>
            <FieldLabel optional>{t("payroll.leave.reason")}</FieldLabel>
            <FieldControl>
              <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
            </FieldControl>
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2Icon className="animate-spin" />}
              {t("payroll.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InstalmentDialog({ advance, onOpenChange }: { advance: Advance | null; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const update = useUpdateAdvance();
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (advance) {
      setValue(paiseToRupees(advance.instalment));
      setError(null);
    }
  }, [advance]);
  const v = rupeesToPaise(value);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!advance || !v) return;
    try {
      await update.mutateAsync({ id: advance.id, instalment: v });
      toast.success(t("payroll.advances.saved"));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };
  return (
    <Dialog open={!!advance} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("payroll.common.close")} className="sm:max-w-sm">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("payroll.advances.editTitle")}</DialogTitle>
            <DialogDescription>
              {advance?.employeeName} · {t("payroll.advances.left")}: {money(advance?.outstanding)}
            </DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <Field invalid={!v}>
            <FieldLabel>{t("payroll.advances.instalment")}</FieldLabel>
            <FieldControl>
              <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            </FieldControl>
            <FieldError>{!v ? t("payroll.common.amountInvalid") : null}</FieldError>
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={update.isPending || !v}>
              {update.isPending && <Loader2Icon className="animate-spin" />}
              {t("payroll.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
