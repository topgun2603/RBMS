"use client";

import * as React from "react";
import { ArrowLeftIcon, BellIcon, BellOffIcon, BikeIcon, CheckIcon, FlameIcon, GlobeIcon, QrCodeIcon, ShoppingBagIcon, Undo2Icon, UtensilsIcon } from "lucide-react";
import { Button, ChipGroup, cn, Skeleton } from "@rbms/ui";
import { describeError, ModuleLink, useI18n, useStored, writeStored } from "@rbms/web";
import { DueChip, PlatformBadge } from "../components/platform";
import { elapsed, minutesSince, qty } from "../lib/format";
import { minutesUntil } from "../lib/online";
import { useKitchen, useMoveKot } from "../lib/queries";
import type { KitchenTicket, KotStatus } from "../lib/types";

const COLUMNS: { status: KotStatus; next: KotStatus; back?: KotStatus }[] = [
  { status: "new", next: "preparing" },
  { status: "preparing", next: "ready", back: "new" },
  { status: "ready", next: "served", back: "preparing" },
];

/** Minutes after which a ticket turns amber, then red. */
const WARN_MIN = 10;
const LATE_MIN = 20;

/**
 * The kitchen display: full screen, one column per stage, oldest ticket first. Tap the big button to move a ticket on;
 * a beep sounds when new tickets arrive. Station chips filter (remembered on this screen).
 */
export default function KitchenPage() {
  const { t } = useI18n();
  const stationPref = useStored("sr_kds_station") ?? "";
  const sound = useStored("sr_kds_sound") ?? "on";
  const setStationPref = (v: string) => writeStored("sr_kds_station", v || null);
  const setSound = (v: string) => writeStored("sr_kds_sound", v);
  const stations = stationPref ? stationPref.split(",") : [];
  const k = useKitchen(stations);
  const move = useMoveKot();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const tickets = k.data?.tickets ?? [];
  const newIds = tickets.filter((x) => x.status === "new").map((x) => x.id);
  useBeepOnNew(newIds, sound === "on");

  const served = tickets.filter((x) => x.status === "served").reverse();
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <Button asChild variant="ghost" size="sm">
          <ModuleLink to="">
            <ArrowLeftIcon /> {t("restaurant.nav.floor")}
          </ModuleLink>
        </Button>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <FlameIcon className="size-5 text-primary" /> {t("restaurant.kitchen.title")}
        </h1>
        {(k.data?.stations.length ?? 0) > 1 && (
          <ChipGroup
            size="sm"
            aria-label={t("restaurant.kitchen.station")}
            value={stationPref || "all"}
            onChange={(v) => setStationPref(v === "all" ? "" : v)}
            options={[{ value: "all", label: t("restaurant.common.all") }, ...(k.data?.stations ?? []).map((s) => ({ value: s, label: stationLabel(s, t) }))]}
          />
        )}
        <span className="ml-auto flex items-center gap-2">
          {k.isError && <span className="text-sm text-destructive">{describeError(k.error, t)}</span>}
          <Button variant="ghost" size="icon" aria-label={sound === "on" ? t("restaurant.kitchen.soundOff") : t("restaurant.kitchen.soundOn")} onClick={() => setSound(sound === "on" ? "off" : "on")}>
            {sound === "on" ? <BellIcon /> : <BellOffIcon />}
          </Button>
        </span>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const list = tickets.filter((x) => x.status === col.status);
          return (
            <section key={col.status} className="flex min-h-0 flex-col rounded-xl bg-muted/40">
              <h2 className="flex items-center justify-between px-3 pt-3 pb-2 text-sm font-semibold">
                {t(`restaurant.kitchen.col.${col.status}`)}
                <span className="rounded-full bg-background px-2 py-0.5 text-meta tabular-nums">{list.length}</span>
              </h2>
              <div className="grid content-start gap-3 overflow-auto px-3 pb-3">
                {k.isPending
                  ? [0, 1].map((i) => <Skeleton key={i} className="h-40" />)
                  : list.map((x) => (
                      <Ticket
                        key={x.id}
                        ticket={x}
                        now={now}
                        busy={move.isPending && move.variables?.id === x.id}
                        onNext={() => move.mutate({ id: x.id, status: col.next })}
                        onBack={col.back ? () => move.mutate({ id: x.id, status: col.back! }) : undefined}
                        nextLabel={t(`restaurant.kitchen.to.${col.next}`)}
                      />
                    ))}
                {!k.isPending && list.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{t("restaurant.kitchen.none")}</p>}
              </div>
            </section>
          );
        })}
      </main>
      {served.length > 0 && (
        <footer className="flex items-center gap-2 overflow-x-auto border-t px-4 py-2 text-meta">
          <span className="shrink-0 font-semibold text-muted-foreground">{t("restaurant.kitchen.recall")}</span>
          {served.map((x) => (
            <Button key={x.id} size="sm" variant="outline" className="h-7 shrink-0" onClick={() => move.mutate({ id: x.id, status: "ready" })}>
              <Undo2Icon /> KOT {x.number}
            </Button>
          ))}
        </footer>
      )}
    </div>
  );
}

const stationLabel = (s: string, t: (k: string) => string) => (s === "kitchen" ? t("restaurant.kitchen.mainKitchen") : s.charAt(0).toUpperCase() + s.slice(1));

const SOURCE_ICON = { qr: QrCodeIcon, online: GlobeIcon, staff: UtensilsIcon, aggregator: BikeIcon } as const;

function Ticket({
  ticket: x,
  now,
  busy,
  onNext,
  onBack,
  nextLabel,
}: {
  ticket: KitchenTicket;
  now: number;
  busy: boolean;
  onNext: () => void;
  onBack?: () => void;
  nextLabel: string;
}) {
  const { t } = useI18n();
  const age = minutesSince(x.createdAt, now);
  // Platform orders are late against the promised pickup time, others against the ticket's age.
  const left = x.dueAt ? minutesUntil(x.dueAt, now) : null;
  const late = x.status !== "ready" && (left !== null ? left < 0 : age >= LATE_MIN);
  const warn = x.status !== "ready" && (left !== null ? left <= 5 : age >= WARN_MIN);
  const Icon = x.orderType === "takeaway" ? ShoppingBagIcon : x.orderType === "delivery" ? BikeIcon : SOURCE_ICON[x.orderSource];
  return (
    <article
      className={cn(
        "grid gap-2 rounded-lg border-2 bg-card p-3 shadow-sm",
        late ? "border-destructive" : warn ? "border-warning" : x.status === "ready" ? "border-success" : "border-transparent",
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="grid">
          <span className="flex items-center gap-1.5 text-lg font-bold">
            {x.platform ? <PlatformBadge platform={x.platform} /> : <Icon className="size-4 text-muted-foreground" />}
            {x.tableName ? t("restaurant.kitchen.table", { table: x.tableName }) : t(`restaurant.type.${x.orderType}`)}
          </span>
          <span className="text-meta text-muted-foreground">
            KOT {x.number} · #{x.orderNumber}
            {x.customerName ? ` · ${x.customerName}` : ""}
            {x.station !== "kitchen" ? ` · ${x.station}` : ""}
          </span>
        </div>
        {x.dueAt && x.status !== "ready" ? (
          // Platform orders count down to the rider's pickup instead of up from the ticket.
          <DueChip dueAt={x.dueAt} now={now} />
        ) : (
          <span className={cn("rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums", late ? "bg-destructive text-white dark:bg-destructive/60" : warn ? "bg-warning/20 text-warning-ink" : "bg-muted")}>
            {elapsed(age)}
          </span>
        )}
      </header>
      <ul className="grid gap-1">
        {x.items.map((i) => (
          <li key={i.id} className={cn("text-base leading-snug", i.status === "cancelled" && "text-destructive line-through")}>
            <span className="font-bold tabular-nums">{qty(i.qty)}×</span> {i.name}
            {i.note && <span className="block pl-6 text-sm font-medium text-warning-ink">↳ {i.note}</span>}
            {i.status === "cancelled" && <span className="block pl-6 text-sm no-underline">{t("restaurant.kitchen.voided")}</span>}
          </li>
        ))}
      </ul>
      {x.orderNote && <p className="rounded bg-muted px-2 py-1 text-sm">{x.orderNote}</p>}
      <div className="flex gap-2">
        {onBack && (
          <Button variant="outline" size="lg" className="shrink-0" aria-label={t("restaurant.kitchen.back")} onClick={onBack} disabled={busy}>
            <Undo2Icon />
          </Button>
        )}
        <Button size="lg" className="flex-1" onClick={onNext} disabled={busy}>
          <CheckIcon /> {nextLabel}
        </Button>
      </div>
    </article>
  );
}

/** Short two-tone beep (Web Audio, no file) when a ticket id appears that wasn't on screen before. */
function useBeepOnNew(ids: string[], enabled: boolean) {
  const seen = React.useRef<Set<string> | null>(null);
  React.useEffect(() => {
    const prev = seen.current;
    seen.current = new Set(ids);
    if (!prev || !enabled) return;
    if (!ids.some((id) => !prev.has(id))) return;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      [880, 1175].forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + i * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.16);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + i * 0.18);
        o.stop(ctx.currentTime + i * 0.18 + 0.17);
      });
      window.setTimeout(() => void ctx.close(), 600);
    } catch {
      /* no audio: the screen still updates */
    }
  }, [ids.join(","), enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
