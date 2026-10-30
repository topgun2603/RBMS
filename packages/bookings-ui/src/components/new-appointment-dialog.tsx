"use client";

import * as React from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";
import {
  Button,
  cn,
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
  FieldRow,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { duration, istIso, money, todayIST } from "../lib/format";
import { useCreateAppointment, useServices, useStaff } from "../lib/queries";
import type { Appointment, Slot } from "../lib/types";
import { InlineError, StaffDot } from "./bits";
import { SlotPicker } from "./slot-picker";

export const ANY = "any";
export const UNASSIGNED = "__none";

export interface NewAppointmentPrefill {
  date?: string;
  /** A staff id, ANY or UNASSIGNED. */
  staffId?: string;
  /** Minutes since IST midnight. */
  minute?: number | null;
}

/**
 * Books an appointment at the desk: services (one or more), a person / any / unassigned, the day and a free slot (or a
 * typed time), and the customer. A slot taken a moment ago comes back as "just taken" and the slots refresh.
 */
export function NewAppointmentDialog({
  open,
  onOpenChange,
  prefill,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prefill?: NewAppointmentPrefill;
  onCreated?: (a: Appointment) => void;
}) {
  const { t } = useI18n();
  const services = useServices();
  const staff = useStaff();
  const create = useCreateAppointment();
  const [serviceIds, setServiceIds] = React.useState<string[]>([]);
  const [staffId, setStaffId] = React.useState<string>(ANY);
  const [date, setDate] = React.useState(todayIST());
  const [minute, setMinute] = React.useState<number | null>(null);
  const [slot, setSlot] = React.useState<Slot | null>(null);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setServiceIds([]);
    setStaffId(prefill?.staffId ?? ANY);
    setDate(prefill?.date ?? todayIST());
    setMinute(prefill?.minute ?? null);
    setSlot(null);
    setName("");
    setPhone("");
    setNotes("");
    setError(null);
    setSubmitted(false);
  }, [open, prefill]);

  const list = services.data?.items ?? [];
  const chosen = list.filter((s) => serviceIds.includes(s.id));
  const totalMin = chosen.reduce((s, x) => s + x.durationMin, 0);
  const totalRate = chosen.reduce((s, x) => s + (x.rate ?? 0), 0);
  const itemIds = chosen.map((s) => s.itemId);
  const people = (staff.data?.items ?? []).filter((p) => p.serviceItemIds.length === 0 || itemIds.every((id) => p.serviceItemIds.includes(id)));
  const toggle = (id: string) => setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const nameMissing = !name.trim();
  const noTime = minute === null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!serviceIds.length || nameMissing || noTime) return;
    setError(null);
    try {
      const a = await create.mutateAsync({
        serviceIds,
        // "Any" with a picked slot goes to the person the slot was offered for.
        staffId: staffId === UNASSIGNED ? null : staffId === ANY ? (slot?.staffId ?? ANY) : staffId,
        start: istIso(date, minute!),
        customerName: name.trim(),
        customerPhone: phone.trim() || null,
        notes: notes.trim() || null,
      });
      onOpenChange(false);
      onCreated?.(a);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("bookings.common.close")} className="sm:max-w-xl">
        <form onSubmit={submit} className="grid max-h-[80vh] gap-5 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("bookings.new.title")}</DialogTitle>
            <DialogDescription>{t("bookings.new.body")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}

          <Field invalid={submitted && !serviceIds.length}>
            <FieldLabel htmlFor={null}>{t("bookings.new.services")}</FieldLabel>
            {services.isPending ? (
              <Skeleton className="h-16" />
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("bookings.new.noServices")}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {list.map((s) => {
                  const on = serviceIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(s.id)}
                      className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm", on ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
                    >
                      {on && <CheckIcon className="size-3.5" />}
                      {s.name}
                      <span className="text-meta text-muted-foreground">{duration(s.durationMin)}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {chosen.length > 0 && (
              <p className="text-meta text-muted-foreground">{t("bookings.new.totals", { duration: duration(totalMin), amount: money(totalRate) })}</p>
            )}
            <FieldError>{submitted && !serviceIds.length ? t("bookings.new.servicesRequired") : null}</FieldError>
          </Field>

          <FieldRow>
            <Field>
              <FieldLabel>{t("bookings.new.staff")}</FieldLabel>
              <Select
                value={staffId}
                onValueChange={(v) => {
                  setStaffId(v);
                  setSlot(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t("bookings.new.anyStaff")}</SelectItem>
                  {people.map((p) => (
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
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setDate(e.target.value);
                    setMinute(null);
                    setSlot(null);
                  }}
                />
              </FieldControl>
            </Field>
          </FieldRow>

          <Field invalid={submitted && noTime}>
            <FieldLabel htmlFor={null}>{t("bookings.new.time")}</FieldLabel>
            <SlotPicker
              date={date}
              serviceIds={serviceIds}
              staffId={staffId === UNASSIGNED ? ANY : staffId}
              value={minute}
              onChange={setMinute}
              onSlot={setSlot}
            />
            <FieldError>{submitted && noTime ? t("bookings.new.timeRequired") : null}</FieldError>
          </Field>

          <FieldRow>
            <Field invalid={submitted && nameMissing}>
              <FieldLabel>{t("bookings.new.customer")}</FieldLabel>
              <FieldControl>
                <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              </FieldControl>
              <FieldError>{submitted && nameMissing ? t("bookings.new.customerRequired") : null}</FieldError>
            </Field>
            <Field>
              <FieldLabel optional={t("bookings.common.optional")}>{t("bookings.new.phone")}</FieldLabel>
              <FieldControl>
                <Input inputMode="tel" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} />
              </FieldControl>
            </Field>
          </FieldRow>
          <Field>
            <FieldLabel optional={t("bookings.common.optional")}>{t("bookings.new.notes")}</FieldLabel>
            <FieldControl>
              <Textarea rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
            </FieldControl>
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("bookings.common.cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2Icon className="animate-spin" />}
              {t("bookings.new.cta")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
