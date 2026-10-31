"use client";

import * as React from "react";
import { cn } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { gridRange, hhmm, istMinute, layoutLanes, time12, todayIST } from "../lib/format";
import { CLOSED_STATUSES, type Appointment, type AppointmentStatus, type DayView, type Interval } from "../lib/types";
import { SourceMark } from "./bits";

/** Height of one 15-minute row, px. */
export const ROW_PX = 18;
const STEP = 15;

const BLOCK_TONE: Record<AppointmentStatus, string> = {
  booked: "bg-info/10 hover:bg-info/15",
  confirmed: "bg-primary/10 hover:bg-primary/15",
  arrived: "bg-warning/15 hover:bg-warning/20",
  in_service: "bg-warning/25 hover:bg-warning/30 ring-1 ring-warning/50",
  completed: "bg-success/15 hover:bg-success/20",
  cancelled: "bg-muted text-muted-foreground line-through opacity-70",
  no_show: "bg-muted text-muted-foreground opacity-70",
};

interface Column {
  key: string;
  staffId: string | null;
  name: string;
  color: string | null;
  windows: Interval[];
  off: Interval[];
  appointments: Appointment[];
}

/**
 * The day view: a time column, then one column per staff member plus "Unassigned". Closed time is shaded, time off
 * striped, appointments are blocks (staff colour on the left edge, status in the tint). Click empty space to book there.
 */
export function DayGrid({
  day,
  showClosed,
  onSlot,
  onOpen,
  canBook,
}: {
  day: DayView;
  showClosed: boolean;
  onSlot: (staffId: string | null, minute: number) => void;
  onOpen: (a: Appointment) => void;
  canBook: boolean;
}) {
  const { t } = useI18n();
  const visible = day.appointments.filter((a) => showClosed || !CLOSED_STATUSES.includes(a.status));
  const shopOff = day.timeoff.shop ?? [];
  const columns: Column[] = [
    ...day.staff.map((s) => ({
      key: s.id,
      staffId: s.id,
      name: s.name,
      color: s.color,
      windows: day.windows.staff[s.id] ?? [],
      off: [...shopOff, ...(day.timeoff[s.id] ?? [])],
      appointments: visible.filter((a) => a.staffId === s.id),
    })),
    {
      key: "unassigned",
      staffId: null,
      name: t("bookings.calendar.unassigned"),
      color: null,
      windows: day.windows.shop,
      off: shopOff,
      appointments: visible.filter((a) => !a.staffId || !day.staff.some((s) => s.id === a.staffId)),
    },
  ];
  const blocks = (list: Appointment[]) => list.map((a) => ({ from: istMinute(a.start), to: istMinute(a.start) + Math.max(STEP, a.durationMin), a }));
  const range = gridRange([...day.windows.shop, ...Object.values(day.windows.staff).flat(), ...blocks(visible)]);
  const height = ((range.to - range.from) / STEP) * ROW_PX;
  const y = (min: number) => ((min - range.from) / STEP) * ROW_PX;
  const hours = Array.from({ length: (range.to - range.from) / 60 }, (_, i) => range.from + i * 60);

  // The "now" line, moved every minute.
  const [nowMin, setNowMin] = React.useState(() => istMinute(new Date()));
  React.useEffect(() => {
    const id = window.setInterval(() => setNowMin(istMinute(new Date())), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const isToday = day.date === todayIST();

  return (
    <div className="overflow-auto rounded-xl border bg-card" style={{ maxHeight: "calc(100dvh - 14rem)" }}>
      <div className="grid min-w-max" style={{ gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(10rem, 1fr))` }}>
        <div className="sticky top-0 left-0 z-30 border-b bg-card" />
        {columns.map((c) => (
          <div key={c.key} className="sticky top-0 z-20 flex items-center gap-2 border-b border-l bg-card px-2 py-2 text-sm font-semibold">
            {c.color && <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />}
            <span className="truncate">{c.name}</span>
            <span className="ml-auto text-meta font-normal text-muted-foreground tabular-nums">{c.appointments.length || ""}</span>
          </div>
        ))}

        <div className="sticky left-0 z-10 bg-card" style={{ height }}>
          {hours.map((h) => (
            <span key={h} className="absolute right-1.5 -translate-y-1/2 text-meta text-muted-foreground tabular-nums" style={{ top: y(h) || 6 }}>
              {hhmm(h)}
            </span>
          ))}
        </div>

        {columns.map((c) => (
          <div
            key={c.key}
            className={cn("relative border-l bg-muted/50", canBook && "cursor-pointer")}
            style={{ height }}
            onClick={(e) => {
              if (!canBook) return;
              const top = e.currentTarget.getBoundingClientRect().top;
              const min = range.from + Math.floor((e.clientY - top) / ROW_PX) * STEP;
              onSlot(c.staffId, Math.min(range.to - STEP, Math.max(range.from, min)));
            }}
            aria-label={t("bookings.calendar.columnLabel", { name: c.name })}
          >
            {c.windows.map((w) => (
              <div key={`w${w.from}`} className="absolute inset-x-0 bg-background" style={{ top: y(w.from), height: y(w.to) - y(w.from) }} />
            ))}
            {c.off.map((o, i) => (
              <div
                key={`o${i}`}
                className="absolute inset-x-0 flex items-start justify-center pt-1 text-meta text-muted-foreground"
                style={{
                  top: y(Math.max(o.from, range.from)),
                  height: Math.max(0, y(Math.min(o.to, range.to)) - y(Math.max(o.from, range.from))),
                  backgroundImage: "repeating-linear-gradient(135deg, color-mix(in oklch, var(--muted-foreground) 14%, transparent) 0 6px, transparent 6px 12px)",
                }}
              >
                {t("bookings.calendar.timeOff")}
              </div>
            ))}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${ROW_PX * 4}px)` }}
            />
            {layoutLanes(blocks(c.appointments)).map(({ block, lane, lanes }) => {
              const a = block.a;
              const h = Math.max(ROW_PX, y(block.to) - y(block.from) - 2);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(a);
                  }}
                  className={cn("absolute z-10 overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-xs shadow-xs transition-colors", BLOCK_TONE[a.status])}
                  style={{
                    top: y(block.from) + 1,
                    height: h,
                    left: `calc(${(lane / lanes) * 100}% + 2px)`,
                    width: `calc(${100 / lanes}% - 4px)`,
                    borderLeftColor: a.staffColor ?? "var(--muted-foreground)",
                  }}
                  title={`${time12(block.from)} · ${a.customerName}`}
                >
                  <span className="flex items-center gap-1 font-semibold">
                    <span className="truncate">{a.customerName}</span>
                    <SourceMark source={a.source} />
                  </span>
                  {h > ROW_PX * 1.5 && (
                    <span className="block truncate text-muted-foreground">
                      {time12(block.from)} · {a.items.map((i) => i.name).join(", ")}
                    </span>
                  )}
                  {h > ROW_PX * 2.6 && <span className="block truncate text-muted-foreground">{t(`bookings.status.${a.status}`)}</span>}
                </button>
              );
            })}
            {isToday && nowMin >= range.from && nowMin < range.to && (
              <div aria-hidden className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-destructive" style={{ top: y(nowMin) }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
