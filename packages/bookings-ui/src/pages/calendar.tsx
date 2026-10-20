"use client";

import * as React from "react";
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, ListIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { Button, ChipGroup, EmptyState, Input, Skeleton, Switch } from "@srirealtime/ui";
import { describeError, ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, usePermission, useQueryParams, useSettingsHref } from "@srirealtime/web";
import { AppointmentList } from "../components/appointment-list";
import { AppointmentSheet } from "../components/appointment-sheet";
import { InlineError } from "../components/bits";
import { DayGrid } from "../components/day-grid";
import { ANY, NewAppointmentDialog, UNASSIGNED, type NewAppointmentPrefill } from "../components/new-appointment-dialog";
import { BOOKINGS_PERMISSIONS } from "../lib/access";
import { addDays, todayIST } from "../lib/format";
import { useDay } from "../lib/queries";
import { CLOSED_STATUSES, type Appointment } from "../lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function CalendarPage() {
  // The page reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <Calendar />
    </React.Suspense>
  );
}

/**
 * Appointments: the day calendar (a column per staff member, `?date=`) or the list (`?view=list`). `?open=<id>` opens an
 * appointment, `?new=1` the new-appointment dialog (the quick action).
 */
function Calendar() {
  const { t, formatDate } = useI18n();
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const canDesk = usePermission(BOOKINGS_PERMISSIONS.desk);
  const view = params.get("view") === "list" ? "list" : "day";
  const rawDate = params.get("date");
  const date = rawDate && DATE_RE.test(rawDate) ? rawDate : todayIST();
  const openId = params.get("open");
  const [prefill, setPrefill] = React.useState<NewAppointmentPrefill | null>(null);
  const [seed, setSeed] = React.useState<Appointment | null>(null);

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      navigate(qs ? `?${qs}` : "?", { replace: true, scroll: false });
    },
    [params, navigate],
  );

  // Quick action "New appointment" lands here with ?new=1.
  React.useEffect(() => {
    if (params.get("new") !== "1") return;
    setPrefill({ date, staffId: ANY, minute: null });
    setParams({ new: null });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (a: Appointment) => {
    setSeed(a);
    setParams({ open: a.id });
  };

  return (
    <Page width="full">
      <PageHeading
        title={t("bookings.calendar.title")}
        description={view === "day" ? formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : t("bookings.list.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ChipGroup
              size="sm"
              aria-label={t("bookings.calendar.view")}
              value={view}
              onChange={(v) => setParams({ view: v === "list" ? "list" : null })}
              options={[
                { value: "day", label: t("bookings.calendar.dayView") },
                { value: "list", label: t("bookings.calendar.listView") },
              ]}
            />
            {canDesk && (
              <Button onClick={() => setPrefill({ date, staffId: ANY, minute: null })}>
                <PlusIcon /> {t("bookings.nav.new")}
              </Button>
            )}
          </div>
        }
      />

      {view === "day" ? (
        <DayView
          date={date}
          setDate={(d) => setParams({ date: d === todayIST() ? null : d })}
          canBook={canDesk}
          onSlot={(staffId, minute) => setPrefill({ date, staffId: staffId ?? UNASSIGNED, minute })}
          onOpen={open}
        />
      ) : (
        <AppointmentList onOpen={(id) => setParams({ open: id })} />
      )}

      <NewAppointmentDialog
        open={!!prefill}
        onOpenChange={(o) => !o && setPrefill(null)}
        prefill={prefill ?? undefined}
        onCreated={(a) => {
          setSeed(a);
          setParams({ open: a.id, ...(view === "day" ? { date: a.businessDate === todayIST() ? null : a.businessDate } : {}) });
        }}
      />
      <AppointmentSheet id={openId} seed={seed} onOpenChange={(o) => !o && setParams({ open: null })} />
    </Page>
  );
}

function DayView({
  date,
  setDate,
  canBook,
  onSlot,
  onOpen,
}: {
  date: string;
  setDate: (d: string) => void;
  canBook: boolean;
  onSlot: (staffId: string | null, minute: number) => void;
  onOpen: (a: Appointment) => void;
}) {
  const { t } = useI18n();
  const settingsHref = useSettingsHref();
  const canSetup = usePermission(BOOKINGS_PERMISSIONS.manage);
  const day = useDay(date);
  const [showClosed, setShowClosed] = React.useState(false);
  const d = day.data;
  const active = d?.appointments.filter((a) => !CLOSED_STATUSES.includes(a.status)).length ?? 0;
  const closed = (d?.appointments.length ?? 0) - active;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label={t("bookings.calendar.prev")} onClick={() => setDate(addDays(date, -1))}>
          <ChevronLeftIcon />
        </Button>
        <Button variant="outline" onClick={() => setDate(todayIST())} disabled={date === todayIST()}>
          {t("bookings.calendar.today")}
        </Button>
        <Button variant="outline" size="icon" aria-label={t("bookings.calendar.next")} onClick={() => setDate(addDays(date, 1))}>
          <ChevronRightIcon />
        </Button>
        <Input type="date" className="w-40" aria-label={t("bookings.calendar.pickDate")} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <span className="text-sm text-muted-foreground">{d && t("bookings.calendar.count", { count: active })}</span>
        {closed > 0 && (
          <label className="ml-auto flex items-center gap-2 text-sm">
            <Switch checked={showClosed} onCheckedChange={setShowClosed} />
            {t("bookings.calendar.showCancelled", { count: closed })}
          </label>
        )}
      </div>

      {day.isError ? (
        <InlineError title={describeError(day.error, t)} />
      ) : !d ? (
        <Skeleton className="h-[32rem]" />
      ) : d.staff.length === 0 && d.appointments.length === 0 && d.windows.shop.length === 0 ? (
        <EmptyState
          icon={CalendarDaysIcon}
          title={t("bookings.calendar.emptyTitle")}
          description={t("bookings.calendar.emptyBody")}
          action={
            canSetup ? (
              <Button asChild>
                <ModuleLink href={settingsHref("appointments")}>
                  <SettingsIcon /> {t("bookings.calendar.setUp")}
                </ModuleLink>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={day.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
          {d.windows.shop.length === 0 && <p className="mb-2 text-sm text-muted-foreground">{t("bookings.calendar.closedDay")}</p>}
          <DayGrid day={d} showClosed={showClosed} canBook={canBook} onSlot={onSlot} onOpen={onOpen} />
        </div>
      )}
      <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
        <ListIcon className="size-3.5" /> {t("bookings.calendar.hint")}
      </p>
    </div>
  );
}
