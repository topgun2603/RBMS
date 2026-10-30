"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, LockIcon, MonitorSmartphoneIcon, MoreVerticalIcon, ScaleIcon, ScanBarcodeIcon, TimerIcon, UnplugIcon, WifiOffIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  InitialsAvatar,
  Skeleton,
} from "@rbms/ui";
import { ConfirmDialog, LocaleSwitcher, ThemeToggle, useI18n } from "@rbms/web";
import { formatCountdown, lockSecondsLeft, padDisabled, pinPadReducer, unlockProblemOf, type PinPadAction, type UnlockProblem } from "../../lib/pin";
import { getStaff, openPinSession } from "../../lib/terminal-api";
import type { DeviceInfo, PinSession } from "../../lib/terminal-types";
import { PinPad } from "./pin-pad";

export interface LockScreenProps {
  device: DeviceInfo;
  notice?: "idle" | "expired" | "locked";
  onUnlock: (s: PinSession) => void;
  onUnpaired: () => void;
  onForget: () => Promise<void>;
}

/** Ticks every second while `on`. */
function useNow(on: boolean) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

/**
 * The terminal's lock screen: shop and terminal, who can unlock here (GET /pos/staff), a big PIN pad. Wrong PIN shows
 * the attempts left; five in a row lock the terminal with a countdown; members without POS access are told so.
 */
export function LockScreen({ device, notice, onUnlock, onUnpaired, onForget }: LockScreenProps) {
  const { t, formatDate } = useI18n();
  const [pad, setPad] = React.useState({ digits: "" });
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<UnlockProblem | null>(null);
  const [shake, setShake] = React.useState(0);
  const [forget, setForget] = React.useState(false);
  const staff = useQuery({ queryKey: ["pos", "terminal", "staff", device.terminal.id], queryFn: getStaff, staleTime: 60_000, retry: 1 });
  const locked = problem?.kind === "locked";
  const now = useNow(true);
  const left = locked ? lockSecondsLeft(problem.until, now) : 0;
  const disabled = padDisabled(problem, false, now);

  React.useEffect(() => {
    if (locked && left === 0) setProblem(null);
  }, [locked, left]);

  const onAction = React.useCallback((a: PinPadAction) => {
    setPad((s) => pinPadReducer(s, a));
    setProblem((p) => (p && p.kind !== "locked" ? null : p));
  }, []);

  const submit = async () => {
    const pin = pad.digits;
    if (busy || pin.length < 4 || disabled) return;
    setBusy(true);
    try {
      const s = await openPinSession(pin);
      setPad({ digits: "" });
      setProblem(null);
      onUnlock(s);
    } catch (err) {
      const p = unlockProblemOf(err);
      setProblem(p);
      setPad({ digits: "" });
      setShake((n) => n + 1);
      if (p.kind === "unpaired") onUnpaired();
    } finally {
      setBusy(false);
    }
  };

  const { terminal, shop } = device;
  // Members without a name on their profile still show up.
  const people = (staff.data?.items ?? []).map((p) => ({ ...p, name: p.name?.trim() || t("pos.lock.unnamed") }));
  const withPin = people.filter((p) => p.hasPin);
  const withoutPin = people.filter((p) => !p.hasPin);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background text-foreground" data-pos-root="" data-pos-lock="">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3">
        <span className="truncate text-sm font-semibold sm:text-base">{shop.name}</span>
        <Badge variant="muted" className="gap-1">
          {terminal.role === "weighing" ? <ScaleIcon /> : <ScanBarcodeIcon />} {terminal.name}
        </Badge>
        <div className="ml-auto flex items-center gap-1">
          <LocaleSwitcher />
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label={t("pos.lock.deviceMenu")}>
                <MoreVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem variant="destructive" onSelect={() => setForget(true)}>
                <UnplugIcon /> {t("pos.lock.forget")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="hidden flex-col justify-between gap-6 border-r bg-muted/30 p-8 md:flex">
          <div className="grid gap-2">
            <p className="text-sm font-medium text-muted-foreground">{formatDate(new Date(now), { weekday: "long", day: "numeric", month: "long" })}</p>
            <p className="font-heading text-6xl font-semibold tabular-nums">{new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
            <p className="mt-2 flex items-center gap-2 text-muted-foreground">
              <MonitorSmartphoneIcon className="size-4" /> {t(terminal.role === "weighing" ? "pos.lock.roleWeighing" : "pos.lock.rolePos", { name: terminal.name })}
            </p>
          </div>
          <div className="grid gap-3">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("pos.lock.whoCan")}</h2>
            {staff.isPending ? (
              <div className="grid gap-2">
                <Skeleton className="h-10 w-56" />
                <Skeleton className="h-10 w-48" />
              </div>
            ) : withPin.length === 0 ? (
              <p className="max-w-sm text-sm text-muted-foreground">{t("pos.lock.nobody")}</p>
            ) : (
              <ul className="flex flex-wrap gap-2" aria-label={t("pos.lock.whoCan")}>
                {withPin.map((p) => (
                  <li key={p.userId} className="flex items-center gap-2 rounded-full border bg-card py-1 pr-3 pl-1 text-sm">
                    <InitialsAvatar name={p.name} className="size-7 text-xs" /> {p.name}
                  </li>
                ))}
              </ul>
            )}
            {withoutPin.length > 0 && <p className="max-w-sm text-xs text-muted-foreground">{t("pos.lock.noPin", { names: withoutPin.map((p) => p.name).join(", ") })}</p>}
          </div>
        </section>

        <section className="grid place-items-center p-6">
          <div className="grid w-full max-w-sm justify-items-center gap-6">
            <div className="grid justify-items-center gap-2 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
                <LockIcon className="size-6" />
              </span>
              <h1 className="font-heading text-2xl font-semibold">{t("pos.lock.title")}</h1>
              <p className="text-sm text-muted-foreground">{t("pos.lock.body")}</p>
            </div>

            {notice && !problem && (
              <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground" role="status">
                <TimerIcon className="size-4" /> {t(`pos.lock.notice.${notice}`)}
              </p>
            )}

            <PinPad digits={pad.digits} onAction={onAction} onSubmit={() => void submit()} disabled={disabled} busy={busy} shake={shake} invalid={!!problem && problem.kind === "invalid"} />

            <div className="min-h-16 w-full">
              {problem && <ProblemAlert problem={problem} secondsLeft={left} />}
            </div>

            <ul className={cn("flex flex-wrap justify-center gap-2 md:hidden", withPin.length === 0 && "hidden")}>
              {withPin.map((p) => (
                <li key={p.userId} className="rounded-full border bg-card px-3 py-1 text-xs">
                  {p.name}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <ConfirmDialog
        open={forget}
        onOpenChange={setForget}
        title={t("pos.lock.forgetTitle")}
        description={t("pos.lock.forgetBody", { name: terminal.name })}
        confirmLabel={t("pos.lock.forget")}
        onConfirm={onForget}
      />
    </div>
  );
}

function ProblemAlert({ problem, secondsLeft }: { problem: UnlockProblem; secondsLeft: number }) {
  const { t } = useI18n();
  switch (problem.kind) {
    case "invalid":
      return (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{t("pos.lock.invalid")}</AlertTitle>
          {problem.remaining !== null && <AlertDescription>{t("pos.lock.remaining", { count: problem.remaining })}</AlertDescription>}
        </Alert>
      );
    case "locked":
      return (
        <Alert variant="warning">
          <TimerIcon />
          <AlertTitle>{t("pos.lock.locked")}</AlertTitle>
          <AlertDescription>
            <span>
              {t("pos.lock.lockedBody")} <strong className="font-mono tabular-nums">{formatCountdown(secondsLeft)}</strong>
            </span>
          </AlertDescription>
        </Alert>
      );
    case "notAllowed":
      return (
        <Alert variant="destructive">
          <LockIcon />
          <AlertTitle>{t("pos.lock.notAllowed")}</AlertTitle>
          <AlertDescription>{t("pos.lock.notAllowedBody")}</AlertDescription>
        </Alert>
      );
    case "network":
      return (
        <Alert variant="warning">
          <WifiOffIcon />
          <AlertTitle>{t("pos.lock.network")}</AlertTitle>
        </Alert>
      );
    case "unpaired":
      return null;
    case "other":
      return (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{problem.message || t("pos.lock.failed")}</AlertTitle>
        </Alert>
      );
  }
}
