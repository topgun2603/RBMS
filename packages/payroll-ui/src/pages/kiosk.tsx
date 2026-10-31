"use client";

import * as React from "react";
import { ArrowLeftIcon, CheckCircle2Icon, DeleteIcon, KeyRoundIcon, Loader2Icon, XCircleIcon } from "lucide-react";
import { Button, cn } from "@rbms/ui";
import { describeError, ModuleLink, useI18n } from "@rbms/web";
import { istTime, minutesLabel } from "../lib/format";
import { useKioskCheck } from "../lib/queries";
import type { CheckResult } from "../lib/types";

/** Seconds a result stays before the screen clears for the next person. */
const CLEAR_AFTER_MS = 6_000;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

function greeting(hour: number) {
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

/**
 * The check-in screen for the shop's counter or a tablet at the door: staff type their POS PIN; the first time in a day
 * checks them in (late minutes shown), the next time checks them out (hours worked shown).
 */
export default function KioskPage() {
  const { t, formatDate } = useI18n();
  const check = useKioskCheck();
  const [pin, setPin] = React.useState("");
  const [result, setResult] = React.useState<CheckResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  React.useEffect(() => {
    if (!result && !error) return;
    const id = window.setTimeout(() => {
      setResult(null);
      setError(null);
    }, CLEAR_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [result, error]);

  const submit = React.useCallback(
    async (value: string) => {
      if (value.length < 4 || check.isPending) return;
      setError(null);
      setResult(null);
      try {
        setResult(await check.mutateAsync(value));
      } catch (err) {
        setError(describeError(err, t));
      } finally {
        setPin("");
      }
    },
    [check, t],
  );

  const press = (k: (typeof KEYS)[number]) => {
    if (k === "clear") return setPin("");
    if (k === "back") return setPin((p) => p.slice(0, -1));
    setPin((p) => (p.length >= 8 ? p : p + k));
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length >= 8 ? p : p + e.key));
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Escape") setPin("");
      else if (e.key === "Enter") void submit(pin);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pin, submit]);

  const ist = new Date(now.getTime() + 330 * 60_000);
  const hour = ist.getUTCHours();
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <Button asChild variant="ghost" size="sm">
          <ModuleLink to="">
            <ArrowLeftIcon /> {t("payroll.nav.attendance")}
          </ModuleLink>
        </Button>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <KeyRoundIcon className="size-5 text-primary" /> {t("payroll.kiosk.title")}
        </h1>
      </header>
      <main className="mx-auto grid w-full max-w-md flex-1 content-start gap-6 overflow-auto px-4 py-6 text-center">
        <div>
          <p className="text-6xl font-bold tabular-nums">{istTime(now.toISOString())}</p>
          <p className="text-muted-foreground">{formatDate(now)}</p>
        </div>
        {result ? (
          <div role="status" aria-live="polite" className="grid gap-2 rounded-2xl border-2 border-success bg-success/10 p-6">
            <CheckCircle2Icon className="mx-auto size-14 text-success" />
            <p className="text-2xl font-bold">
              {result.action === "in" ? t(`payroll.kiosk.hello.${greeting(hour)}`, { name: result.employee.name }) : t("payroll.kiosk.bye", { name: result.employee.name })}
            </p>
            <p className="text-lg">
              {result.action === "in" ? t("payroll.kiosk.inAt", { time: istTime(result.at) }) : t("payroll.kiosk.outAt", { time: istTime(result.at), worked: minutesLabel(result.workedMinutes) })}
            </p>
            {result.action === "in" && result.lateMinutes > 0 && <p className="text-warning-foreground">{t("payroll.kiosk.late", { minutes: result.lateMinutes })}</p>}
            {result.action === "out" && result.overtimeMinutes > 0 && <p>{t("payroll.kiosk.overtime", { time: minutesLabel(result.overtimeMinutes) })}</p>}
          </div>
        ) : error ? (
          <div role="alert" className="grid gap-2 rounded-2xl border-2 border-destructive bg-destructive/10 p-6">
            <XCircleIcon className="mx-auto size-12 text-destructive" />
            <p className="text-xl font-semibold">{error}</p>
          </div>
        ) : (
          <p className="text-lg text-muted-foreground">{t("payroll.kiosk.prompt")}</p>
        )}
        <div aria-label={t("payroll.kiosk.pin")} className="flex h-10 items-center justify-center gap-3">
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
            <span key={i} className={cn("size-4 rounded-full border-2 border-primary", i < pin.length && "bg-primary")} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {KEYS.map((k) => (
            <Button key={k} type="button" variant="outline" className="h-16 text-2xl" aria-label={k === "back" ? t("payroll.kiosk.back") : k === "clear" ? t("payroll.kiosk.clear") : k} onClick={() => press(k)}>
              {k === "back" ? <DeleteIcon /> : k === "clear" ? t("payroll.kiosk.clear") : k}
            </Button>
          ))}
        </div>
        <Button size="lg" className="h-14 text-lg" disabled={pin.length < 4 || check.isPending} onClick={() => submit(pin)}>
          {check.isPending && <Loader2Icon className="animate-spin" />}
          {t("payroll.kiosk.go")}
        </Button>
      </main>
    </div>
  );
}
