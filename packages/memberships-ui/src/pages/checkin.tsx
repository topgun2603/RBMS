"use client";

import * as React from "react";
import { ArrowLeftIcon, CheckCircle2Icon, Loader2Icon, ScanLineIcon, SearchIcon, XCircleIcon } from "lucide-react";
import { Button, cn, InitialsAvatar, Input, Skeleton } from "@srirealtime/ui";
import { describeError, ModuleLink, useI18n } from "@srirealtime/web";
import { phoneLabel } from "../lib/format";
import { useCheckIn, useTodayCheckins } from "../lib/queries";
import type { CheckinResult } from "../lib/types";

/** Seconds the result card stays before the screen clears for the next member. */
const CLEAR_AFTER_MS = 8_000;

/**
 * The front-desk check-in screen: full screen, one big box for the mobile number or member code (a barcode scanner
 * typing into it works too). Green card = come in (sessions / days left), red card = the reason. Today's visits below.
 */
export default function CheckinPage() {
  const { t } = useI18n();
  const checkIn = useCheckIn();
  const today = useTodayCheckins();
  const [code, setCode] = React.useState("");
  const [result, setResult] = React.useState<CheckinResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const input = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!result && !error) return;
    const id = window.setTimeout(() => {
      setResult(null);
      setError(null);
    }, CLEAR_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [result, error]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = code.trim();
    if (!v || checkIn.isPending) return;
    setError(null);
    setResult(null);
    try {
      setResult(await checkIn.mutateAsync({ code: v }));
      setCode("");
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      input.current?.focus();
    }
  };

  const visits = today.data?.items ?? [];
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <Button asChild variant="ghost" size="sm">
          <ModuleLink to="">
            <ArrowLeftIcon /> {t("memberships.nav.members")}
          </ModuleLink>
        </Button>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <ScanLineIcon className="size-5 text-primary" /> {t("memberships.checkin.title")}
        </h1>
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">{t("memberships.checkin.todayCount", { count: visits.length })}</span>
      </header>
      <main className="mx-auto grid min-h-0 w-full max-w-3xl flex-1 content-start gap-6 overflow-auto px-4 py-6">
        <form onSubmit={submit} className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={input}
              autoFocus
              autoComplete="off"
              aria-label={t("memberships.checkin.placeholder")}
              className="h-16 pl-14 text-2xl md:text-2xl"
              placeholder={t("memberships.checkin.placeholder")}
              value={code}
              maxLength={30}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <Button type="submit" size="lg" className="h-16 px-6 text-lg" disabled={!code.trim() || checkIn.isPending}>
            {checkIn.isPending ? <Loader2Icon className="animate-spin" /> : <CheckCircle2Icon />} {t("memberships.checkin.cta")}
          </Button>
        </form>

        {error && (
          <div role="alert" className="flex items-center gap-4 rounded-2xl border-2 border-destructive bg-destructive/10 p-6">
            <XCircleIcon className="size-12 shrink-0 text-destructive" />
            <p className="text-xl font-semibold">{error}</p>
          </div>
        )}
        {result && <ResultCard r={result} />}

        <section className="grid gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{t("memberships.checkin.recent")}</h2>
          {today.isPending ? (
            <Skeleton className="h-40" />
          ) : visits.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("memberships.checkin.none")}</p>
          ) : (
            <ul className="grid gap-1">
              {visits.slice(0, 50).map((v) => (
                <li key={v.id}>
                  <ModuleLink to={`m/${v.memberId}`} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/60">
                    <InitialsAvatar name={v.name} className="size-9" />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-medium">{v.name}</span>
                      <span className="truncate text-meta text-muted-foreground">{[v.memberCode, v.planName].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="text-sm tabular-nums text-muted-foreground">{new Date(v.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</span>
                  </ModuleLink>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function ResultCard({ r }: { r: CheckinResult }) {
  const { t, formatDate } = useI18n();
  const sub = r.subscription;
  const facts = [
    sub?.planName,
    r.sessionsLeft !== null ? t("memberships.sessions.leftN", { count: r.sessionsLeft }) : sub ? t("memberships.sessions.unlimited") : null,
    sub && r.daysLeft !== null ? (r.daysLeft >= 0 ? t("memberships.days.left", { days: r.daysLeft }) : t("memberships.days.endedAgo", { days: -r.daysLeft })) : null,
    sub ? t("memberships.checkin.until", { date: formatDate(sub.endDate) }) : null,
  ].filter(Boolean);
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("grid gap-4 rounded-2xl border-2 p-6", r.ok ? "border-success bg-success/10" : "border-destructive bg-destructive/10")}
    >
      <div className="flex items-center gap-4">
        {r.ok ? <CheckCircle2Icon className="size-14 shrink-0 text-success" /> : <XCircleIcon className="size-14 shrink-0 text-destructive" />}
        <div className="grid min-w-0 gap-1">
          <p className="text-3xl font-bold">{r.ok ? t("memberships.checkin.welcome", { name: r.member.name }) : t(`memberships.checkin.reason.${r.reason ?? "no_active_plan"}`)}</p>
          <p className="text-lg text-muted-foreground">
            {r.ok ? null : `${r.member.name} · `}
            <span className="font-mono">{r.member.memberCode}</span>
            {r.member.phone ? ` · ${phoneLabel(r.member.phone)}` : ""}
          </p>
        </div>
        {r.member.photoUrl && <img src={r.member.photoUrl} alt="" className="ml-auto size-20 rounded-xl object-cover" />}
      </div>
      {facts.length > 0 && <p className="text-xl font-medium tabular-nums">{facts.join(" · ")}</p>}
      {!r.ok && r.reason === "already_checked_in" && r.lastCheckinAt && (
        <p className="text-base">{t("memberships.checkin.cameAt", { time: new Date(r.lastCheckinAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) })}</p>
      )}
      <ModuleLink to={`m/${r.member.id}`} className="justify-self-start text-sm text-primary hover:underline">
        {t("memberships.checkin.openMember")}
      </ModuleLink>
    </div>
  );
}
