"use client";

import * as React from "react";
import { CalendarClockIcon, CheckIcon, Loader2Icon, PhoneIcon, ReceiptIcon, UserXIcon, XIcon } from "lucide-react";
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
  FieldLabel,
  FieldRow,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  toast,
} from "@rbms/ui";
import { describeError, ModuleLink, useAppNavigate, useI18n, usePermission } from "@rbms/web";
import { BOOKINGS_PERMISSIONS } from "../lib/access";
import { bookingsConfig } from "../lib/config";
import { duration, istIso, istMinute, money, time12 } from "../lib/format";
import { useAppointment, useAppointmentActions, useStaff } from "../lib/queries";
import type { Appointment, AppointmentStatus } from "../lib/types";
import { AppointmentStatusPill, InlineError, ReasonDialog, SourceMark, StaffDot } from "./bits";
import { UNASSIGNED } from "./new-appointment-dialog";
import { SlotPicker } from "./slot-picker";

/** Forward moves shown as buttons (cancel and no-show have their own). */
const FORWARD: readonly AppointmentStatus[] = ["confirmed", "arrived", "in_service", "completed"];

/** Side sheet of one appointment: details, the next status moves, reschedule, cancel / no-show and the bill. */
export function AppointmentSheet({ id, seed, onOpenChange }: { id: string | null; seed?: Appointment | null; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const q = useAppointment(id);
  const a = q.data ?? (seed && seed.id === id ? seed : undefined);
  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent closeLabel={t("bookings.common.close")} className="w-full overflow-y-auto sm:max-w-md">
        {q.isError && !a ? (
          <div className="p-4">
            <InlineError title={describeError(q.error, t)} />
          </div>
        ) : !a ? (
          <div className="grid gap-3 p-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <Details a={a} onClose={() => onOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Details({ a, onClose }: { a: Appointment; onClose: () => void }) {
  const { t, formatDate } = useI18n();
  const actions = useAppointmentActions(a.id);
  const appNavigate = useAppNavigate();
  const canDesk = usePermission(BOOKINGS_PERMISSIONS.desk);
  const canBill = usePermission(BOOKINGS_PERMISSIONS.bill);
  const [cancelling, setCancelling] = React.useState(false);
  const [moving, setMoving] = React.useState(false);
  const run = async (p: Promise<unknown>, ok?: string) => {
    try {
      await p;
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const start = istMinute(a.start);
  const forward = a.nextStatuses.filter((s) => FORWARD.includes(s));
  const billable = (a.status === "in_service" || a.status === "completed") && !a.invoiceId;
  const movable = a.status === "booked" || a.status === "confirmed";
  const busy = actions.status.isPending;

  return (
    <div className="grid gap-5 px-4 pb-6">
      <SheetHeader className="px-0">
        <SheetTitle className="flex items-center gap-2">
          #{a.number} · {a.customerName} <SourceMark source={a.source} />
        </SheetTitle>
        <SheetDescription>
          {formatDate(a.businessDate, { weekday: "short", day: "numeric", month: "short" })} · {time12(start)} – {time12(start + a.durationMin)}
        </SheetDescription>
        <div>
          <AppointmentStatusPill status={a.status} />
        </div>
      </SheetHeader>

      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("bookings.sheet.staff")}</dt>
          <dd className="flex items-center gap-2 font-medium">
            {a.staffName ? (
              <>
                <StaffDot color={a.staffColor} /> {a.staffName}
              </>
            ) : (
              t("bookings.calendar.unassigned")
            )}
          </dd>
        </div>
        {a.customerPhone && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("bookings.sheet.phone")}</dt>
            <dd>
              <a href={`tel:${a.customerPhone.replace(/\s/g, "")}`} className="flex items-center gap-1 font-medium hover:underline">
                <PhoneIcon className="size-3.5" /> {a.customerPhone}
              </a>
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("bookings.sheet.source")}</dt>
          <dd>{t(`bookings.source.${a.source}`)}</dd>
        </div>
        {a.notes && (
          <div className="grid gap-1">
            <dt className="text-muted-foreground">{t("bookings.sheet.notes")}</dt>
            <dd className="rounded-md bg-muted px-2 py-1.5 whitespace-pre-wrap">{a.notes}</dd>
          </div>
        )}
        {a.cancelReason && (
          <div className="grid gap-1">
            <dt className="text-muted-foreground">{t("bookings.sheet.cancelReason")}</dt>
            <dd>{a.cancelReason}</dd>
          </div>
        )}
      </dl>

      <Separator />
      <ul className="grid gap-1.5 text-sm">
        {a.items.map((i) => (
          <li key={i.id} className="flex justify-between gap-3">
            <span>
              {i.name} <span className="text-meta text-muted-foreground">· {duration(i.durationMin)}</span>
            </span>
            <span className="tabular-nums">{money(i.rate)}</span>
          </li>
        ))}
        <li className="flex justify-between gap-3 border-t pt-1.5 font-semibold">
          <span>{t("bookings.sheet.total")}</span>
          <span className="tabular-nums">{money(a.amount)}</span>
        </li>
      </ul>

      {canDesk && (forward.length > 0 || movable) && (
        <div className="grid gap-2">
          {forward.map((s, i) => (
            <Button key={s} variant={i === 0 ? "default" : "outline"} disabled={busy} onClick={() => run(actions.status.mutateAsync({ status: s }), t(`bookings.to.${s}Done`))}>
              {busy && actions.status.variables?.status === s ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} {t(`bookings.to.${s}`)}
            </Button>
          ))}
          {movable && (
            <Button variant="outline" onClick={() => setMoving(true)}>
              <CalendarClockIcon /> {t("bookings.sheet.reschedule")}
            </Button>
          )}
        </div>
      )}

      {(billable || a.invoiceId) && (
        <div className="grid gap-2">
          {a.invoiceId ? (
            <Button variant="outline" asChild>
              <ModuleLink href={bookingsConfig().invoiceHref(a.invoiceId)}>
                <ReceiptIcon /> {t("bookings.sheet.openBill")}
              </ModuleLink>
            </Button>
          ) : (
            canBill && (
              <Button
                disabled={actions.bill.isPending}
                onClick={async () => {
                  try {
                    const r = await actions.bill.mutateAsync();
                    toast.success(t("bookings.sheet.billed"));
                    onClose();
                    appNavigate(bookingsConfig().invoiceHref(r.bill.id));
                  } catch (err) {
                    toast.error(describeError(err, t));
                  }
                }}
              >
                {actions.bill.isPending ? <Loader2Icon className="animate-spin" /> : <ReceiptIcon />} {t("bookings.sheet.bill")}
              </Button>
            )
          )}
        </div>
      )}

      {canDesk && (a.nextStatuses.includes("cancelled") || a.nextStatuses.includes("no_show")) && (
        <div className="flex flex-wrap gap-2">
          {a.nextStatuses.includes("no_show") && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(actions.status.mutateAsync({ status: "no_show" }), t("bookings.to.no_showDone"))}>
              <UserXIcon /> {t("bookings.to.no_show")}
            </Button>
          )}
          {a.nextStatuses.includes("cancelled") && (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setCancelling(true)}>
              <XIcon /> {t("bookings.sheet.cancel")}
            </Button>
          )}
        </div>
      )}

      <ReasonDialog
        open={cancelling}
        onOpenChange={setCancelling}
        optional
        title={t("bookings.sheet.cancelTitle", { number: a.number })}
        description={t("bookings.sheet.cancelBody")}
        confirm={t("bookings.sheet.cancel")}
        onConfirm={(reason) => actions.status.mutateAsync({ status: "cancelled", reason }).then(() => toast.success(t("bookings.to.cancelledDone")))}
      />
      <RescheduleDialog open={moving} onOpenChange={setMoving} appointment={a} />
    </div>
  );
}

/** New day, time and/or person for a booked or confirmed appointment; free slots for its services are offered. */
function RescheduleDialog({ open, onOpenChange, appointment: a }: { open: boolean; onOpenChange: (o: boolean) => void; appointment: Appointment }) {
  const { t } = useI18n();
  const staff = useStaff();
  const { move } = useAppointmentActions(a.id);
  const [date, setDate] = React.useState(a.businessDate);
  const [staffId, setStaffId] = React.useState(a.staffId ?? UNASSIGNED);
  const [minute, setMinute] = React.useState<number | null>(istMinute(a.start));
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setDate(a.businessDate);
    setStaffId(a.staffId ?? UNASSIGNED);
    setMinute(istMinute(a.start));
    setError(null);
  }, [open, a]);
  const serviceIds = a.items.map((i) => i.serviceId).filter((v): v is string => !!v);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (minute === null) return;
    setError(null);
    try {
      await move.mutateAsync({ start: istIso(date, minute), staffId: staffId === UNASSIGNED ? null : staffId });
      toast.success(t("bookings.sheet.moved"));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("bookings.common.close")} className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("bookings.sheet.rescheduleTitle", { number: a.number })}</DialogTitle>
            <DialogDescription>{t("bookings.sheet.rescheduleBody", { duration: duration(a.durationMin) })}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <FieldRow>
            <Field>
              <FieldLabel>{t("bookings.new.staff")}</FieldLabel>
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(staff.data?.items ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        <StaffDot color={p.color} /> {p.name}
                      </span>
                    </SelectItem>
                  ))}
                  <SelectItem value={UNASSIGNED}>{t("bookings.calendar.unassigned")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t("bookings.new.date")}</FieldLabel>
              <FieldControl>
                <Input type="date" value={date} onChange={(e) => e.target.value && (setDate(e.target.value), setMinute(null))} />
              </FieldControl>
            </Field>
          </FieldRow>
          <Field>
            <FieldLabel htmlFor={null}>{t("bookings.new.time")}</FieldLabel>
            <SlotPicker date={date} serviceIds={serviceIds} staffId={staffId === UNASSIGNED ? "any" : staffId} value={minute} onChange={setMinute} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("bookings.common.back")}
            </Button>
            <Button type="submit" disabled={move.isPending || minute === null}>
              {move.isPending && <Loader2Icon className="animate-spin" />}
              {t("bookings.sheet.moveCta")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
