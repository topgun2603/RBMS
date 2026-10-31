import * as React from "react";
import type { Metadata } from "next";
import { CalendarClockIcon, CheckIcon, SearchXIcon, WrenchIcon } from "lucide-react";
import { cn } from "@rbms/ui/lib/utils";
import { BookingWizard, CancelBookingButton, type BookableService, type BookableStaff } from "../client/booking-wizard";
import { Container, Empty } from "../components/bits";
import { money } from "../lib/format";
import { apiGetOrNull, apiGetSafe, getRequestInfo, hasFeature } from "../server/api";

// ------------------------------------------------------------------ online booking (/book)

export async function bookMetadata(): Promise<Metadata> {
  const { t } = await getRequestInfo();
  return { title: t("book.title") };
}

/** Online booking for salons, spas, opticals, trainers (feature `bookings.online`). */
export async function BookPage() {
  const { t } = await getRequestInfo();
  if (!(await hasFeature("bookings.online"))) {
    return <Empty icon={<CalendarClockIcon />} title={t("book.off")} body={t("book.offBody")} className="mx-auto my-16 max-w-md" />;
  }
  const [services, staff] = await Promise.all([
    apiGetSafe<{ items: BookableService[] }>("/bookings/public/services", { items: [] }, { revalidate: 30 }),
    apiGetSafe<{ items: BookableStaff[] }>("/bookings/public/staff", { items: [] }, { revalidate: 30 }),
  ]);
  return (
    <Container className="max-w-3xl py-8 pb-28">
      <h1 className="sf-heading font-display text-h1 font-semibold">{t("book.title")}</h1>
      <p className="mt-2 mb-8 text-muted-foreground">{t("book.subtitle")}</p>
      {services.items.length === 0 ? (
        <Empty icon={<CalendarClockIcon />} title={t("book.off")} body={t("book.offBody")} />
      ) : (
        <BookingWizard services={services.items} staff={staff.items} />
      )}
    </Container>
  );
}

// ------------------------------------------------------------------ the shopper's booking (/booking/<token>)

interface PublicAppointment {
  number: number;
  date: string;
  start: string;
  end: string;
  status: string;
  staffName: string | null;
  services: { name: string; durationMin: number; price: number }[];
  total: number;
  customerName: string;
  canCancel: boolean;
  cancelUntil: string;
}

const getBooking = (token: string) => apiGetOrNull<PublicAppointment>(`/bookings/public/appointments/${encodeURIComponent(token)}`, { revalidate: 0 }).catch(() => null);

export async function bookingMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const { t } = await getRequestInfo();
  const b = await getBooking(token);
  return { title: b ? t("booking.title", { number: b.number }) : t("booking.notFound"), robots: { index: false, follow: false } };
}

export async function BookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t, locale } = await getRequestInfo();
  const b = await getBooking(token);
  if (!b) return <Empty icon={<SearchXIcon />} title={t("booking.notFound")} className="mx-auto my-16 max-w-md" />;
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString(locale === "ta" ? "ta-IN" : "en-IN", { timeZone: "Asia/Kolkata", ...opts });
  const when = `${fmt(b.start, { weekday: "long", day: "numeric", month: "long" })}, ${fmt(b.start, { hour: "numeric", minute: "2-digit" })}`;
  return (
    <Container className="max-w-xl py-10">
      <h1 className="sf-heading font-display text-h1 font-semibold">{t("booking.title", { number: b.number })}</h1>
      <dl className="mt-6 grid gap-4 rounded-[var(--sf-radius-card)] border bg-card p-5">
        <Row label={t("booking.when")} value={when} />
        {b.staffName && <Row label={t("booking.with")} value={b.staffName} />}
        <Row label={t("booking.services")} value={b.services.map((s) => s.name).join(", ")} />
        <Row label={t("book.total")} value={money(b.total)} />
        <Row label={t("booking.status")} value={t(`booking.status.${b.status}`)} />
      </dl>
      <div className="mt-6">
        {b.status === "cancelled" ? (
          <p className="text-muted-foreground">{t("booking.cancelled")}</p>
        ) : b.canCancel ? (
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">{t("booking.cancelUntil", { time: fmt(b.cancelUntil, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })}</p>
            <CancelBookingButton token={token} />
          </div>
        ) : (
          ["booked", "confirmed"].includes(b.status) && <p className="text-sm text-muted-foreground">{t("booking.tooLate")}</p>
        )}
      </div>
    </Container>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[8rem_1fr]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ job tracking (/job/<token>)

interface JobTrack {
  label: string;
  template: "device" | "garment" | "eyewear" | "vehicle" | "laundry" | "appliance" | "general";
  status: string;
  dueDate: string | null;
  total: number;
  createdAt: string;
  timeline: { status: string; at: string }[];
}

const FLOW = ["received", "diagnosed", "awaiting_approval", "in_progress", "trial", "ready", "delivered"] as const;
const getJob = (token: string) => apiGetOrNull<JobTrack>(`/jobcards/public/track/${encodeURIComponent(token)}`, { revalidate: 0 }).catch(() => null);

export async function jobMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const { t } = await getRequestInfo();
  const j = await getJob(token);
  return { title: j ? t("job.title", { label: j.label }) : t("job.notFound"), robots: { index: false, follow: false } };
}

/** The customer's job (repair, stitching, spectacles): where it is, when it's due (feature `jobcards.tracking`). */
export async function JobPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t, locale } = await getRequestInfo();
  const [on, j] = await Promise.all([hasFeature("jobcards.tracking"), getJob(token)]);
  if (!on || !j) return <Empty icon={<SearchXIcon />} title={t("job.notFound")} body={t("job.notFoundBody")} className="mx-auto my-16 max-w-md" />;
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale === "ta" ? "ta-IN" : "en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const reached = new Map(j.timeline.map((e) => [e.status, e.at]));
  // Steps shown: every step the job went through, plus the ones still ahead (trial only for stitching).
  const steps = FLOW.filter((s) => reached.has(s) || (s !== "trial" || j.template === "garment") && FLOW.indexOf(s) > FLOW.indexOf(j.status as (typeof FLOW)[number]));
  const cancelled = j.status === "cancelled";
  return (
    <Container className="max-w-xl py-10">
      <p className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
        <WrenchIcon className="size-4" /> {t(`job.template.${j.template}`)}
      </p>
      <h1 className="sf-heading mt-3 font-display text-h1 font-semibold">{t("job.title", { label: j.label })}</h1>
      <p className="mt-2 text-muted-foreground">{t("job.subtitle")}</p>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {j.dueDate && !cancelled && <span>{t("job.due", { date: new Date(`${j.dueDate}T00:00:00+05:30`).toLocaleDateString(locale === "ta" ? "ta-IN" : "en-IN", { day: "numeric", month: "long" }) })}</span>}
        {j.total > 0 && (
          <span>
            {t("job.total")}: <strong className="tabular-nums">{money(j.total)}</strong>
          </span>
        )}
      </div>
      {cancelled ? (
        <p className="mt-8 rounded-[var(--sf-radius-card)] border border-destructive/40 bg-destructive/5 p-4 font-medium text-destructive">{t("job.status.cancelled")}</p>
      ) : (
        <ol className="mt-8 grid gap-0">
          {steps.map((s, i) => {
            const at = reached.get(s);
            const current = s === j.status;
            return (
              <li key={s} className="relative grid grid-cols-[2rem_1fr] gap-3 pb-6 last:pb-0">
                {i < steps.length - 1 && <span aria-hidden className={cn("absolute top-8 bottom-0 left-[0.95rem] w-0.5", at ? "bg-primary" : "bg-border")} />}
                <span className={cn("relative grid size-8 place-items-center rounded-full border-2", at ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background", current && "ring-4 ring-primary/20")}>
                  {at ? <CheckIcon className="size-4" /> : <span className="size-2 rounded-full bg-border" />}
                </span>
                <span className="pt-1">
                  <span className={cn("block font-medium", !at && "text-muted-foreground")}>{t(`job.status.${s}`)}</span>
                  {at && <span className="text-sm text-muted-foreground">{fmt(at)}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Container>
  );
}
