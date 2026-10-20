"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarCheck2Icon, CheckIcon, Loader2Icon, UserRoundIcon } from "lucide-react";
import { cn } from "@srirealtime/ui/lib/utils";
import { money } from "../lib/format";
import { ApiError, call, errorMessage } from "./api";
import { useStore } from "./store-context";

export interface BookableService {
  id: string;
  name: string;
  durationMin: number;
  /** GST-inclusive paise. */
  price: number;
}

export interface BookableStaff {
  id: string;
  name: string;
  color: string;
  serviceIds: string[];
}

interface SlotRow {
  start: string;
  time: string;
}

interface Booked {
  number: number;
  manageToken: string;
  appointment: { date: string; start: string };
}

const istDate = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

/**
 * The shopper's booking: services → who (or anyone) → day + free time → name and mobile → confirmed, with a link to
 * view or cancel. Times come from the shop's hours, staff and existing appointments (GET /bookings/public/slots).
 */
export function BookingWizard({ services, staff }: { services: BookableService[]; staff: BookableStaff[] }) {
  const { t, locale } = useStore();
  const [picked, setPicked] = React.useState<string[]>([]);
  const [who, setWho] = React.useState<string>("any");
  const days = React.useMemo(() => Array.from({ length: 14 }, (_, i) => istDate(new Date(Date.now() + i * 86_400_000))), []);
  const [day, setDay] = React.useState(days[0]!);
  const [slots, setSlots] = React.useState<SlotRow[] | null>(null);
  const [slot, setSlot] = React.useState<SlotRow | null>(null);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<Booked | null>(null);

  const capable = staff.filter((s) => picked.every((id) => s.serviceIds.includes(id)));
  const chosen = services.filter((s) => picked.includes(s.id));
  const total = chosen.reduce((n, s) => n + s.price, 0);
  const minutes = chosen.reduce((n, s) => n + s.durationMin, 0);

  React.useEffect(() => {
    if (who !== "any" && !capable.some((s) => s.id === who)) setWho("any");
  }, [capable, who]);

  React.useEffect(() => {
    setSlot(null);
    if (picked.length === 0) {
      setSlots(null);
      return;
    }
    const ctl = new AbortController();
    setSlots(null);
    call<{ slots: SlotRow[] }>("/bookings/public/slots", { query: { date: day, serviceIds: picked.join(","), staffId: who }, auth: false, signal: ctl.signal })
      .then((r) => setSlots(r.slots))
      .catch((err) => {
        if (!(err instanceof DOMException)) setSlots([]);
      });
    return () => ctl.abort();
  }, [picked, who, day]);

  const book = async () => {
    setError(null);
    if (!picked.length) return setError(t("book.pickService"));
    if (!slot) return setError(t("book.pickTime"));
    setBusy(true);
    try {
      const r = await call<Booked>("/bookings/public/appointments", {
        method: "POST",
        auth: false,
        body: { serviceIds: picked, staffId: who === "any" ? null : who, start: slot.start, name: name.trim(), phone: phone.trim(), notes: notes.trim() || null },
      });
      setDone(r);
    } catch (err) {
      if (err instanceof ApiError && err.code === "slot_taken") {
        setError(t("book.taken"));
        setSlot(null);
        setDay((d) => d);
      } else setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const dayLabel = (d: string) =>
    new Date(`${d}T00:00:00+05:30`).toLocaleDateString(locale === "ta" ? "ta-IN" : "en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

  if (done) {
    return (
      <div className="grid place-items-center gap-4 rounded-[var(--sf-radius-card)] border bg-card px-6 py-12 text-center">
        <CalendarCheck2Icon className="size-14 text-success" />
        <h2 className="font-display text-h2 font-semibold">{t("book.doneTitle")}</h2>
        <p className="max-w-md text-muted-foreground">{t("book.doneBody", { number: done.number, date: dayLabel(day), time: slot?.time ?? "" })}</p>
        <Link href={`/booking/${done.manageToken}`} className="sf-btn inline-flex h-11 items-center bg-primary px-6 text-sm font-semibold text-primary-foreground">
          {t("book.manage")}
        </Link>
      </div>
    );
  }

  const chip = (on: boolean) =>
    cn("rounded-[var(--sf-radius-card)] border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring outline-none", on ? "border-primary bg-primary/10 ring-1 ring-primary" : "bg-card hover:border-primary/50");

  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <h2 className="sf-heading font-display text-h3 font-semibold">1. {t("book.step.services")}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {services.map((s) => {
            const on = picked.includes(s.id);
            return (
              <button key={s.id} type="button" aria-pressed={on} className={chip(on)} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s.id) : [...p, s.id]))}>
                <span className="flex items-start justify-between gap-2">
                  <span className="font-medium">{s.name}</span>
                  {on && <CheckIcon className="size-4 shrink-0 text-primary" />}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {t("book.minutes", { min: s.durationMin })} · <span className="font-semibold text-foreground tabular-nums">{money(s.price)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {picked.length > 0 && staff.length > 0 && (
        <section className="grid gap-3">
          <h2 className="sf-heading font-display text-h3 font-semibold">2. {t("book.step.staff")}</h2>
          <div className="flex flex-wrap gap-2">
            {[{ id: "any", name: t("book.anyone"), color: "" }, ...capable].map((s) => (
              <button key={s.id} type="button" aria-pressed={who === s.id} className={cn(chip(who === s.id), "inline-flex items-center gap-2 py-2")} onClick={() => setWho(s.id)}>
                {s.color ? <span className="size-3 rounded-full" style={{ background: s.color }} /> : <UserRoundIcon className="size-4" />}
                {s.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {picked.length > 0 && (
        <section className="grid gap-3">
          <h2 className="sf-heading font-display text-h3 font-semibold">{staff.length > 0 ? 3 : 2}. {t("book.step.time")}</h2>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {days.map((d) => (
              <button key={d} type="button" aria-pressed={day === d} className={cn(chip(day === d), "shrink-0 px-3 py-2 text-sm whitespace-nowrap")} onClick={() => setDay(d)}>
                {dayLabel(d)}
              </button>
            ))}
          </div>
          {slots === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> {t("book.loadingSlots")}
            </p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("book.noSlots")}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
              {slots.map((s) => (
                <button key={s.start} type="button" aria-pressed={slot?.start === s.start} className={cn(chip(slot?.start === s.start), "py-2 text-center text-sm font-medium tabular-nums")} onClick={() => setSlot(s)}>
                  {s.time}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {slot && (
        <section className="grid gap-3">
          <h2 className="sf-heading font-display text-h3 font-semibold">{staff.length > 0 ? 4 : 3}. {t("book.step.details")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="h-11 rounded-[var(--sf-radius-card)] border bg-background px-3" placeholder={t("book.name")} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            <input className="h-11 rounded-[var(--sf-radius-card)] border bg-background px-3" placeholder={t("book.phone")} inputMode="tel" value={phone} maxLength={15} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          </div>
          <textarea className="min-h-20 rounded-[var(--sf-radius-card)] border bg-background p-3" placeholder={t("book.notes")} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
        </section>
      )}

      {picked.length > 0 && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[var(--sf-radius-card)] border bg-background/95 p-3 shadow-lg backdrop-blur">
          <span className="text-sm">
            {t("book.total")}: <strong className="tabular-nums">{money(total)}</strong> · {t("book.minutes", { min: minutes })}
            {slot && <span className="text-muted-foreground"> · {dayLabel(day)} {slot.time}</span>}
          </span>
          <button type="button" disabled={busy || !slot || !name.trim() || phone.trim().length < 10} onClick={book} className="sf-btn inline-flex h-11 items-center gap-2 bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {busy && <Loader2Icon className="size-4 animate-spin" />}
            {busy ? t("book.booking") : t("book.confirm")}
          </button>
          {error && <p className="w-full text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

/** "Cancel booking" on the booking page (until the shop's cut-off). */
export function CancelBookingButton({ token }: { token: string }) {
  const { t } = useStore();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="grid gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await call(`/bookings/public/appointments/${encodeURIComponent(token)}/cancel`, { method: "POST", auth: false });
            window.location.reload();
          } catch (err) {
            setError(errorMessage(err, t));
            setBusy(false);
          }
        }}
        className="sf-btn inline-flex h-11 w-fit items-center gap-2 border border-destructive px-5 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
      >
        {busy && <Loader2Icon className="size-4 animate-spin" />}
        {busy ? t("booking.cancelling") : t("booking.cancel")}
      </button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
