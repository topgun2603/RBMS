"use client";

import * as React from "react";
import { CalendarOffIcon, ClockIcon, Loader2Icon, PlusIcon, ScissorsIcon, SearchIcon, Trash2Icon, UsersIcon, XIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  ColorInput,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  toast,
} from "@rbms/ui";
import { describeError, useDebounced, useI18n } from "@rbms/web";
import { StaffDot } from "../components/bits";
import { duration, istIso, istMinute, istDate, money, parseHHMM, time12 } from "../lib/format";
import { useHours, useServices, useSetupActions, useShopItems, useStaff, useTimeoff } from "../lib/queries";
import type { BookingService, BookingStaff, DayRow, ShopItem } from "../lib/types";

const SHOP = "__shop";
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const PALETTE = ["#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#8b5cf6", "#ef4444", "#22c55e", "#0ea5e9"];
const DEFAULT_DAY: DayRow = { weekday: 1, opens: "10:00", closes: "20:00", breaks: [] };

/** Settings → Appointments: bookable services, staff, weekly hours (shop and per person) and time off. */
export default function BookingsSettingsPage() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-section">
      <ServicesCard />
      <StaffCard />
      <HoursCard />
      <TimeoffCard />
    </div>
  );
}

function useRun() {
  const { t } = useI18n();
  return async (p: Promise<unknown>, ok?: string) => {
    try {
      await p;
      if (ok) toast.success(ok);
      return true;
    } catch (err) {
      toast.error(describeError(err, t));
      return false;
    }
  };
}

/** Whole minutes from a text box; empty / invalid → null. */
const mins = (s: string) => (/^\d{1,3}$/.test(s.trim()) ? Number(s) : null);

// ---------------------------------------------------------------- services

function ServicesCard() {
  const { t } = useI18n();
  const services = useServices(true);
  const a = useSetupActions();
  const run = useRun();
  const [item, setItem] = React.useState<ShopItem | null>(null);
  const [dur, setDur] = React.useState("30");
  const [buf, setBuf] = React.useState("0");
  const [online, setOnline] = React.useState(true);
  const list = services.data?.items ?? [];
  const taken = new Set(list.map((s) => s.itemId));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScissorsIcon className="size-4 text-primary" /> {t("bookings.settings.servicesTitle")}
        </CardTitle>
        <CardDescription>{t("bookings.settings.servicesBody")}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = mins(dur);
            const b = mins(buf) ?? 0;
            if (!item || !d || d < 5) return;
            const ok = await run(a.createService.mutateAsync({ itemId: item.id, durationMin: d, bufferMin: b, onlineBookable: online }), t("bookings.settings.serviceAdded"));
            if (ok) setItem(null);
          }}
        >
          <div className="min-w-60 flex-1">
            <ItemPicker value={item} onChange={setItem} exclude={taken} />
          </div>
          <label className="grid gap-1 text-meta text-muted-foreground">
            {t("bookings.settings.duration")}
            <Input className="w-20" inputMode="numeric" value={dur} onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="grid gap-1 text-meta text-muted-foreground">
            {t("bookings.settings.buffer")}
            <Input className="w-20" inputMode="numeric" value={buf} onChange={(e) => setBuf(e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="flex h-9 items-center gap-2 text-sm">
            <Switch checked={online} onCheckedChange={setOnline} /> {t("bookings.settings.online")}
          </label>
          <Button type="submit" disabled={!item || !(Number(dur) >= 5) || a.createService.isPending}>
            {a.createService.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} {t("bookings.settings.addService")}
          </Button>
        </form>

        {services.isPending ? (
          <Skeleton className="h-32" />
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("bookings.settings.noServices")}</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
            {list.map((s) => (
              <ServiceRow key={s.id} s={s} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ServiceRow({ s }: { s: BookingService }) {
  const { t } = useI18n();
  const a = useSetupActions();
  const run = useRun();
  const [dur, setDur] = React.useState(String(s.durationMin));
  const [buf, setBuf] = React.useState(String(s.bufferMin));
  React.useEffect(() => {
    setDur(String(s.durationMin));
    setBuf(String(s.bufferMin));
  }, [s.durationMin, s.bufferMin]);
  const save = (patch: Parameters<typeof a.updateService.mutateAsync>[0]) => run(a.updateService.mutateAsync(patch));
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 odd:bg-muted/40">
      <span className="min-w-0">
        <span className={s.active ? "font-medium" : "font-medium text-muted-foreground line-through"}>{s.name}</span>
        <span className="block text-meta text-muted-foreground tabular-nums">
          {s.rate === null ? t("bookings.settings.itemGone") : money(s.rate)} · {duration(s.durationMin)}
          {s.bufferMin ? ` + ${t("bookings.settings.bufferN", { min: s.bufferMin })}` : ""}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-16"
          inputMode="numeric"
          aria-label={t("bookings.settings.duration")}
          value={dur}
          onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))}
          onBlur={() => {
            const d = mins(dur);
            if (d && d >= 5 && d !== s.durationMin) void save({ id: s.id, durationMin: d });
            else setDur(String(s.durationMin));
          }}
        />
        <Input
          className="h-8 w-16"
          inputMode="numeric"
          aria-label={t("bookings.settings.buffer")}
          value={buf}
          onChange={(e) => setBuf(e.target.value.replace(/\D/g, ""))}
          onBlur={() => {
            const b = mins(buf);
            if (b !== null && b !== s.bufferMin) void save({ id: s.id, bufferMin: b });
            else setBuf(String(s.bufferMin));
          }}
        />
        <label className="flex items-center gap-1.5 text-meta">
          <Switch checked={s.onlineBookable} onCheckedChange={(v) => save({ id: s.id, onlineBookable: v })} aria-label={t("bookings.settings.online")} />
          {t("bookings.settings.online")}
        </label>
        <label className="flex items-center gap-1.5 text-meta">
          <Switch checked={s.active} onCheckedChange={(v) => save({ id: s.id, active: v })} aria-label={t("bookings.settings.active")} />
          {t("bookings.settings.active")}
        </label>
        <Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label={t("bookings.common.remove")} onClick={() => run(a.deleteService.mutateAsync(s.id))}>
          <Trash2Icon />
        </Button>
      </span>
    </li>
  );
}

/** Search the shop's billing items (what the service is billed as). */
function ItemPicker({ value, onChange, exclude }: { value: ShopItem | null; onChange: (v: ShopItem | null) => void; exclude: Set<string> }) {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const term = useDebounced(q, 250);
  const items = useShopItems(term, open && !value);
  const list = (items.data?.items ?? []).filter((i) => !exclude.has(i.id));
  if (value) {
    return (
      <div className="flex h-9 items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 text-sm">
        <span className="truncate">
          {value.name} <span className="text-muted-foreground">· {money(value.rate)}</span>
        </span>
        <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={t("bookings.common.change")} onClick={() => onChange(null)}>
          <XIcon />
        </Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="pl-9"
        placeholder={t("bookings.settings.pickItem")}
        value={q}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <ul className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {items.isPending ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">{t("bookings.common.loading")}</li>
          ) : list.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">{t("bookings.settings.noItems")}</li>
          ) : (
            list.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  className="flex w-full justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(i);
                    setQ("");
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{i.name}</span>
                  <span className="text-muted-foreground tabular-nums">{money(i.rate)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- staff

function StaffCard() {
  const { t } = useI18n();
  const staff = useStaff(true);
  const services = useServices(true);
  const a = useSetupActions();
  const run = useRun();
  const [name, setName] = React.useState("");
  const list = staff.data?.items ?? [];
  const nextColor = PALETTE[list.length % PALETTE.length]!;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UsersIcon className="size-4 text-primary" /> {t("bookings.settings.staffTitle")}
        </CardTitle>
        <CardDescription>{t("bookings.settings.staffBody")}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            if (await run(a.createStaff.mutateAsync({ name: name.trim(), color: nextColor }), t("bookings.settings.staffAdded"))) setName("");
          }}
        >
          <Input className="max-w-xs" placeholder={t("bookings.settings.staffName")} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={!name.trim() || a.createStaff.isPending}>
            {a.createStaff.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} {t("bookings.settings.addStaff")}
          </Button>
        </form>
        {staff.isPending ? (
          <Skeleton className="h-24" />
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("bookings.settings.noStaff")}</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
            {list.map((s) => (
              <StaffRow key={s.id} s={s} services={services.data?.items ?? []} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function StaffRow({ s, services }: { s: BookingStaff; services: BookingService[] }) {
  const { t } = useI18n();
  const a = useSetupActions();
  const run = useRun();
  const [name, setName] = React.useState(s.name);
  React.useEffect(() => setName(s.name), [s.name]);
  const save = (patch: Omit<Parameters<typeof a.updateStaff.mutateAsync>[0], "id">) => run(a.updateStaff.mutateAsync({ id: s.id, ...patch }));
  const all = s.serviceItemIds.length === 0;
  const toggle = (itemId: string, on: boolean) => {
    const current = all ? services.map((x) => x.itemId) : s.serviceItemIds;
    const next = on ? [...new Set([...current, itemId])] : current.filter((x) => x !== itemId);
    // Every service ticked = "all services" (also covers ones added later).
    void save({ serviceItemIds: next.length === services.length ? [] : next });
  };
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 odd:bg-muted/40">
      <span className="flex min-w-0 items-center gap-2">
        <ColorInput size="sm" className="w-32" value={s.color} onChange={(hex) => hex !== s.color && void save({ color: hex })} />
        <Input
          className="h-8 w-44"
          value={name}
          maxLength={80}
          aria-label={t("bookings.settings.staffName")}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => (name.trim() && name.trim() !== s.name ? void save({ name: name.trim() }) : setName(s.name))}
        />
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline">
              {all ? t("bookings.settings.allServices") : t("bookings.settings.nServices", { count: s.serviceItemIds.length })}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="grid max-h-72 w-64 gap-1 overflow-auto p-2">
            {services.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("bookings.settings.noServices")}</p>
            ) : (
              services.map((x) => (
                <label key={x.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
                  <Checkbox checked={all || s.serviceItemIds.includes(x.itemId)} onCheckedChange={(v) => toggle(x.itemId, v === true)} />
                  {x.name}
                </label>
              ))
            )}
          </PopoverContent>
        </Popover>
        <label className="flex items-center gap-1.5 text-meta">
          <Switch checked={s.active} onCheckedChange={(v) => save({ active: v })} aria-label={t("bookings.settings.active")} />
          {t("bookings.settings.active")}
        </label>
        <Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label={t("bookings.common.remove")} onClick={() => run(a.deleteStaff.mutateAsync(s.id))}>
          <Trash2Icon />
        </Button>
      </span>
    </li>
  );
}

// ---------------------------------------------------------------- hours

function HoursCard() {
  const { t } = useI18n();
  const hours = useHours();
  const staff = useStaff();
  const a = useSetupActions();
  const run = useRun();
  const [who, setWho] = React.useState(SHOP);
  const saved = who === SHOP ? hours.data?.shop : hours.data?.staff[who];
  const [days, setDays] = React.useState<Record<number, DayRow | null>>({});
  const [followShop, setFollowShop] = React.useState(false);

  React.useEffect(() => {
    if (!hours.data) return;
    const rows = who === SHOP ? hours.data.shop : (hours.data.staff[who] ?? []);
    setFollowShop(who !== SHOP && rows.length === 0);
    // A person who follows the shop starts editing from the shop's week.
    const base = who !== SHOP && rows.length === 0 ? hours.data.shop : rows;
    setDays(Object.fromEntries(WEEK.map((d) => [d, base.find((r) => r.weekday === d) ?? null])));
  }, [hours.data, who]);

  const setDay = (wd: number, row: DayRow | null) => setDays((x) => ({ ...x, [wd]: row }));
  const rows = WEEK.map((wd) => days[wd]).filter((r): r is DayRow => !!r);
  const invalid = rows.some((r) => {
    const o = parseHHMM(r.opens);
    const c = parseHHMM(r.closes);
    return o === null || c === null || c <= o || r.breaks.some((b) => !(parseHHMM(b.from)! < parseHHMM(b.to)!) || parseHHMM(b.from)! < o || parseHHMM(b.to)! > c);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClockIcon className="size-4 text-primary" /> {t("bookings.settings.hoursTitle")}
        </CardTitle>
        <CardDescription>{t("bookings.settings.hoursBody")}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={who} onValueChange={setWho}>
            <SelectTrigger className="w-56" aria-label={t("bookings.settings.hoursFor")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SHOP}>{t("bookings.settings.shopHours")}</SelectItem>
              {(staff.data?.items ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <span className="flex items-center gap-2">
                    <StaffDot color={s.color} /> {s.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {who !== SHOP && (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={followShop} onCheckedChange={setFollowShop} /> {t("bookings.settings.sameAsShop")}
            </label>
          )}
        </div>
        {hours.isPending ? (
          <Skeleton className="h-64" />
        ) : (
          <ul className={followShop ? "pointer-events-none grid gap-1 opacity-50" : "grid gap-1"} aria-disabled={followShop}>
            {WEEK.map((wd) => (
              <DayEditor key={wd} weekday={wd} row={days[wd] ?? null} onChange={(r) => setDay(wd, r)} />
            ))}
          </ul>
        )}
        <div className="flex items-center gap-3">
          <Button
            disabled={a.saveHours.isPending || (!followShop && invalid) || !hours.data}
            onClick={() =>
              run(a.saveHours.mutateAsync({ staffId: who === SHOP ? null : who, days: followShop ? [] : rows }), t("bookings.settings.hoursSaved"))
            }
          >
            {a.saveHours.isPending && <Loader2Icon className="animate-spin" />}
            {t("bookings.settings.saveHours")}
          </Button>
          {!followShop && invalid && <span className="text-sm text-destructive">{t("bookings.settings.hoursInvalid")}</span>}
          {who === SHOP && !saved?.length && hours.data && <span className="text-sm text-muted-foreground">{t("bookings.settings.noHours")}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function DayEditor({ weekday, row, onChange }: { weekday: number; row: DayRow | null; onChange: (r: DayRow | null) => void }) {
  const { t } = useI18n();
  const label = t(`bookings.weekday.${weekday}`);
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 odd:bg-muted/40">
      <label className="flex w-36 items-center gap-2 text-sm font-medium">
        <Switch checked={!!row} onCheckedChange={(v) => onChange(v ? { ...DEFAULT_DAY, weekday } : null)} aria-label={label} />
        {label}
      </label>
      {row ? (
        <>
          <span className="flex items-center gap-1.5">
            <Input type="time" step={900} className="h-8 w-32" aria-label={t("bookings.settings.opens")} value={row.opens} onChange={(e) => onChange({ ...row, opens: e.target.value })} />
            <span className="text-muted-foreground">–</span>
            <Input type="time" step={900} className="h-8 w-32" aria-label={t("bookings.settings.closes")} value={row.closes} onChange={(e) => onChange({ ...row, closes: e.target.value })} />
          </span>
          {row.breaks.map((b, i) => (
            <span key={i} className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-meta">
              {t("bookings.settings.break")}
              <Input type="time" step={900} className="h-7 w-32" value={b.from} onChange={(e) => onChange({ ...row, breaks: row.breaks.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) })} />
              –
              <Input type="time" step={900} className="h-7 w-32" value={b.to} onChange={(e) => onChange({ ...row, breaks: row.breaks.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })} />
              <Button type="button" size="icon" variant="ghost" className="size-6" aria-label={t("bookings.common.remove")} onClick={() => onChange({ ...row, breaks: row.breaks.filter((_, j) => j !== i) })}>
                <XIcon />
              </Button>
            </span>
          ))}
          {row.breaks.length < 6 && (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...row, breaks: [...row.breaks, { from: "13:00", to: "14:00" }] })}>
              <PlusIcon /> {t("bookings.settings.addBreak")}
            </Button>
          )}
        </>
      ) : (
        <span className="text-sm text-muted-foreground">{t("bookings.settings.closed")}</span>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- time off

function TimeoffCard() {
  const { t, formatDate } = useI18n();
  const off = useTimeoff();
  const staff = useStaff(true);
  const a = useSetupActions();
  const run = useRun();
  const [who, setWho] = React.useState(SHOP);
  const [fromDate, setFromDate] = React.useState("");
  const [fromTime, setFromTime] = React.useState("00:00");
  const [toDate, setToDate] = React.useState("");
  const [toTime, setToTime] = React.useState("23:59");
  const [reason, setReason] = React.useState("");
  const names = new Map((staff.data?.items ?? []).map((s) => [s.id, s]));
  const fromMin = parseHHMM(fromTime);
  const toMin = parseHHMM(toTime);
  const ready = !!fromDate && !!toDate && fromMin !== null && toMin !== null && istIso(toDate, toMin) > istIso(fromDate, fromMin);
  const when = (iso: string) => `${formatDate(istDate(iso), { day: "numeric", month: "short" })} ${time12(istMinute(iso))}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarOffIcon className="size-4 text-primary" /> {t("bookings.settings.timeoffTitle")}
        </CardTitle>
        <CardDescription>{t("bookings.settings.timeoffBody")}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!ready) return;
            const ok = await run(
              a.createTimeoff.mutateAsync({ staffId: who === SHOP ? null : who, from: istIso(fromDate, fromMin!), to: istIso(toDate, toMin!), reason: reason.trim() || null }),
              t("bookings.settings.timeoffAdded"),
            );
            if (ok) setReason("");
          }}
        >
          <Select value={who} onValueChange={setWho}>
            <SelectTrigger className="w-48" aria-label={t("bookings.settings.who")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SHOP}>{t("bookings.settings.wholeShop")}</SelectItem>
              {(staff.data?.items ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="grid gap-1 text-meta text-muted-foreground">
            {t("bookings.settings.from")}
            <span className="flex gap-1">
              <Input type="date" className="w-38" value={fromDate} onChange={(e) => (setFromDate(e.target.value), !toDate && setToDate(e.target.value))} />
              <Input type="time" className="w-32" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
            </span>
          </label>
          <label className="grid gap-1 text-meta text-muted-foreground">
            {t("bookings.settings.to")}
            <span className="flex gap-1">
              <Input type="date" className="w-38" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              <Input type="time" className="w-32" value={toTime} onChange={(e) => setToTime(e.target.value)} />
            </span>
          </label>
          <Input className="w-48" placeholder={t("bookings.settings.reasonPlaceholder")} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          <Button type="submit" disabled={!ready || a.createTimeoff.isPending}>
            {a.createTimeoff.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} {t("bookings.settings.addTimeoff")}
          </Button>
        </form>
        {off.isPending ? (
          <Skeleton className="h-16" />
        ) : (off.data?.items ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("bookings.settings.noTimeoff")}</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
            {(off.data?.items ?? []).map((o) => {
              const s = o.staffId ? names.get(o.staffId) : undefined;
              return (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 odd:bg-muted/40">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    {s ? <StaffDot color={s.color} /> : null}
                    <span className="font-medium">{s?.name ?? t("bookings.settings.wholeShop")}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {when(o.from)} – {when(o.to)}
                    </span>
                    {o.reason && <span className="truncate text-muted-foreground">· {o.reason}</span>}
                  </span>
                  <Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label={t("bookings.common.remove")} onClick={() => run(a.deleteTimeoff.mutateAsync(o.id))}>
                    <Trash2Icon />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
