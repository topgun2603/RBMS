"use client";

import * as React from "react";
import { ActivityIcon, AlertTriangleIcon, CheckCircle2Icon, InfoIcon, ChevronDownIcon, ChevronUpIcon, ClipboardCopyIcon, Loader2Icon, PrinterIcon, SparklesIcon, UsersRoundIcon, CalendarRangeIcon } from "lucide-react";
import { Button, Card, CardContent, ChipGroup, cn, EmptyState, Field, FieldControl, FieldHint, FieldLabel, Input, Skeleton, StatusPill, Switch, toast } from "@srirealtime/ui";
import { describeError, Page, PageHeading, SettingsNav, useI18n } from "@srirealtime/web";
import {
  useAlerts,
  useCoaching,
  useCounterSettings,
  useDrill,
  useGenerateCoaching,
  useReviewAlert,
  useSaveCounterSettings,
  useShifts,
  type AlertView,
  type CoachingView,
  type ShiftPlanView,
} from "../lib/queries-counter";

/**
 * Settings > Counter insights: unusual-activity alerts, weekly team notes and a suggested shift plan (docs/ai.md, Phase 5 part A).
 * Owners and managers only (the server checks `reports.manage` / `staff.manage` again). Everything is worked out from the shop's own
 * bills; AI only words the team notes.
 */
type Tab = "alerts" | "coaching" | "shifts";

const rupees = (paise: number) => {
  const r = Math.round(paise) / 100;
  return `₹${r.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 })}`;
};
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_TA = ["ஞா", "திங்", "செவ்", "புத", "வியா", "வெள்", "சனி"];
const hourLabel = (h: number, ta: boolean) => {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return ta ? `${h12}${h < 12 ? "கா" : "மா"}` : `${h12}${h < 12 ? "a" : "p"}`;
};
const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export default function CounterInsightsPage() {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<Tab>("alerts");
  return (
    <Page width="narrow">
      <SettingsNav />
      <PageHeading icon={ActivityIcon} title={t("workspace.nav.counter")} description={t("workspace.counter.subtitle")} />
      <p className="mb-3 text-xs text-muted-foreground">{t("workspace.counter.privacy")}</p>
      <ChipGroup
        aria-label={t("workspace.counter.tab")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "alerts", label: t("workspace.counter.tab.alerts") },
          { value: "coaching", label: t("workspace.counter.tab.coaching") },
          { value: "shifts", label: t("workspace.counter.tab.shifts") },
        ]}
      />
      <div className="mt-4 grid gap-4">
        {tab === "alerts" && <AlertsTab />}
        {tab === "coaching" && <CoachingTab />}
        {tab === "shifts" && <ShiftsTab />}
      </div>
    </Page>
  );
}

// ------------------------------------------------------------------ alerts

function AlertsTab() {
  const { t } = useI18n();
  const [days, setDays] = React.useState<"7" | "14" | "30">("7");
  const q = useAlerts(Number(days));
  const settings = useCounterSettings();
  const save = useSaveCounterSettings();
  return (
    <>
      <Card>
        <CardContent className="grid gap-3 p-4">
          <h2 className="text-base font-semibold">{t("workspace.counter.alerts.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("workspace.counter.alerts.help")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">{t("workspace.counter.alerts.days")}</span>
            <ChipGroup
              size="sm"
              aria-label={t("workspace.counter.alerts.days")}
              value={days}
              onChange={setDays}
              options={(["7", "14", "30"] as const).map((d) => ({ value: d, label: t(`workspace.counter.alerts.days.${d}`) }))}
            />
            {q.data && <StatusPill tone={q.data.open ? "warning" : "success"} icon={q.data.open ? AlertTriangleIcon : CheckCircle2Icon}>{t("workspace.counter.alerts.open", { count: q.data.open })}</StatusPill>}
          </div>
        </CardContent>
      </Card>

      {q.isLoading && <Skeleton className="h-28 rounded-xl" />}
      {q.isError && <p className="text-sm text-destructive" role="alert">{describeError(q.error, t)}</p>}
      {q.data && q.data.alerts.length === 0 && <EmptyState icon={CheckCircle2Icon} title={t("workspace.counter.alerts.none")} description={t("workspace.counter.alerts.noneHint")} />}
      {q.data?.alerts.map((a) => <AlertCard key={a.key} a={a} />)}

      <Card>
        <CardContent className="flex items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("workspace.counter.alerts.summary")}</p>
            <p className="text-xs text-muted-foreground">{t("workspace.counter.alerts.summaryHint")}</p>
          </div>
          <Switch
            checked={settings.data?.alertsInSummary === true}
            disabled={settings.isLoading || save.isPending}
            onCheckedChange={(v) => save.mutate({ alertsInSummary: v }, { onSuccess: () => toast.success(t("workspace.counter.alerts.saved")), onError: (e) => toast.error(describeError(e, t)) })}
            aria-label={t("workspace.counter.alerts.summary")}
          />
        </CardContent>
      </Card>
    </>
  );
}

function AlertCard({ a }: { a: AlertView }) {
  const { t, locale } = useI18n();
  const ta = locale === "ta";
  const [open, setOpen] = React.useState(false);
  const drill = useDrill(a.drill, open);
  const review = useReviewAlert();
  const tone = a.severity === "high" ? "danger" : a.severity === "watch" ? "warning" : "neutral";
  return (
    <Card className={cn(a.reviewed && "opacity-70")} data-testid="counter-alert" data-severity={a.severity} data-type={a.type}>
      <CardContent className="grid gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={tone} icon={a.severity === "info" ? InfoIcon : AlertTriangleIcon}>{t(`workspace.counter.alerts.severity.${a.severity}`)}</StatusPill>
          <span className="text-xs text-muted-foreground tabular-nums">{a.date}</span>
        </div>
        <p className="text-sm font-semibold">{ta ? a.title.ta : a.title.en}</p>
        <p className="text-sm text-muted-foreground">{ta ? a.detail.ta : a.detail.en}</p>
        {a.reviewed && <p className="text-xs text-muted-foreground">{t("workspace.counter.alerts.reviewed", { when: new Date(a.reviewed.at).toLocaleDateString(), who: a.reviewed.by ?? "" })}</p>}
        <div className="flex flex-wrap gap-2">
          {a.drill && (
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? <ChevronUpIcon /> : <ChevronDownIcon />} {t(open ? "workspace.counter.alerts.hide" : "workspace.counter.alerts.show")}
            </Button>
          )}
          <Button type="button" size="sm" variant={a.reviewed ? "ghost" : "secondary"} disabled={review.isPending} onClick={() => review.mutate({ key: a.key, undo: !!a.reviewed })}>
            {a.reviewed ? t("workspace.counter.alerts.undo") : t("workspace.counter.alerts.review")}
          </Button>
        </div>
        {open && (
          <div className="rounded-lg border bg-muted/30 p-2 text-sm" data-testid="counter-drill">
            {drill.isLoading && <p className="text-muted-foreground">{t("workspace.counter.alerts.loading")}</p>}
            {drill.isError && <p className="text-destructive">{describeError(drill.error, t)}</p>}
            {drill.data && drill.data.items.length === 0 && <p className="text-muted-foreground">{t("workspace.counter.alerts.noRows")}</p>}
            <ul className="grid gap-1">
              {drill.data?.items.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border/50 pb-1 last:border-0">
                  <span className="font-medium">{r.number ?? "—"}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{new Date(r.at).toLocaleString(ta ? "ta-IN" : "en-IN", { dateStyle: "short", timeStyle: "short" })}</span>
                  <span className="tabular-nums">{rupees(r.total)}</span>
                  {r.discount > 0 && <span className="text-xs text-muted-foreground">{t("workspace.counter.alerts.row.discount", { amount: rupees(r.discount) })}</span>}
                  {r.reason && <span className="basis-full text-xs text-muted-foreground">{t("workspace.counter.alerts.row.cancelled", { reason: r.reason })}</span>}
                  {r.label && <span className="basis-full truncate text-xs text-muted-foreground">{r.label}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ coaching

function lastMondays(): string[] {
  const now = new Date(Date.now() + 5.5 * 3_600_000);
  const dow = (now.getUTCDay() + 6) % 7;
  const out: string[] = [];
  for (let i = 1; i <= 4; i++) out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow - 7 * i)).toISOString().slice(0, 10));
  return out;
}

function CoachingTab() {
  const { t, locale } = useI18n();
  const weeks = React.useMemo(lastMondays, []);
  const [week, setWeek] = React.useState(weeks[0]!);
  const [lang, setLang] = React.useState<"en" | "ta">(locale === "ta" ? "ta" : "en");
  const q = useCoaching(week);
  const gen = useGenerateCoaching();
  const run = (staff?: string[]) =>
    gen.mutate(
      { week, lang, ...(staff ? { staff } : {}) },
      { onSuccess: (r) => toast.success(t("workspace.counter.coaching.done", { credits: r.credits })), onError: (e) => toast.error(describeError(e, t)) },
    );
  return (
    <>
      <Card>
        <CardContent className="grid gap-3 p-4">
          <h2 className="text-base font-semibold">{t("workspace.counter.coaching.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("workspace.counter.coaching.help")}</p>
          <ChipGroup size="sm" aria-label={t("workspace.counter.coaching.title")} value={week} onChange={setWeek} options={weeks.map((w) => ({ value: w, label: t("workspace.counter.coaching.week", { date: shortDate(w) }) }))} />
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">{t("workspace.counter.coaching.lang")}</span>
            <ChipGroup size="sm" aria-label={t("workspace.counter.coaching.lang")} value={lang} onChange={setLang} options={[{ value: "en", label: t("workspace.counter.coaching.lang.en") }, { value: "ta", label: t("workspace.counter.coaching.lang.ta") }]} />
            <Button type="button" size="sm" onClick={() => run()} disabled={gen.isPending || !q.data?.people.length} data-testid="coaching-write-all">
              {gen.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} {gen.isPending ? t("workspace.counter.coaching.writing") : t("workspace.counter.coaching.writeAll")}
            </Button>
          </div>
        </CardContent>
      </Card>
      {q.isLoading && <Skeleton className="h-28 rounded-xl" />}
      {q.isError && <p className="text-sm text-destructive" role="alert">{describeError(q.error, t)}</p>}
      {q.data && q.data.people.length === 0 && <EmptyState icon={UsersRoundIcon} title={t("workspace.counter.coaching.none")} />}
      {q.data?.people.map((p) => <PersonCard key={p.staff} p={p} lang={lang} busy={gen.isPending} onWrite={() => run([p.staff])} />)}
    </>
  );
}

function PersonCard({ p, lang, busy, onWrite }: { p: CoachingView["people"][number]; lang: "en" | "ta"; busy: boolean; onWrite: () => void }) {
  const { t } = useI18n();
  const ta = lang === "ta";
  const m = p.metrics;
  const note = p.notes[lang];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${p.name}\n${note!.notes.join("\n")}`);
      toast.success(t("workspace.counter.coaching.copied"));
    } catch {
      toast.error("Copy failed");
    }
  };
  const Metric = ({ label, value, shop }: { label: string; value: string; shop?: string }) => (
    <div className="min-w-0 rounded-lg bg-muted/40 p-2">
      <p className="text-[0.6875rem] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
      {shop && <p className="truncate text-[0.6875rem] text-muted-foreground">{t("workspace.counter.coaching.m.shop", { value: shop })}</p>}
    </div>
  );
  return (
    <Card data-testid="coaching-person">
      <CardContent className="grid gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-semibold">{p.name}</h3>
          <Button type="button" size="sm" variant="outline" disabled={busy || !m.enough} onClick={onWrite}>
            <SparklesIcon /> {t(note ? "workspace.counter.coaching.rewrite" : "workspace.counter.coaching.write")}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label={t("workspace.counter.coaching.m.bills")} value={`${m.bills}`} />
          <Metric label={t("workspace.counter.coaching.m.perDay")} value={`${m.billsPerDay}`} />
          <Metric label={t("workspace.counter.coaching.m.avgBill")} value={rupees(m.avgBill)} shop={rupees(m.shop.avgBill)} />
          <Metric label={t("workspace.counter.coaching.m.items")} value={`${m.itemsPerBill}`} shop={`${m.shop.itemsPerBill}`} />
        </div>
        {m.busiest.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("workspace.counter.coaching.m.busiest")}: {m.busiest.map((h) => hourLabel(h, ta)).join(", ")}
          </p>
        )}
        {!m.enough && <p className="text-xs text-muted-foreground">{t("workspace.counter.coaching.fewBills")}</p>}
        {note ? (
          <div className="grid gap-1.5 rounded-lg border bg-background p-3" data-testid="coaching-note">
            {note.notes.map((n, i) => (
              <p key={i} className="text-sm">{n}</p>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-xs text-muted-foreground">{note.source === "ai" ? t("workspace.counter.coaching.ai") : t("workspace.counter.coaching.template")}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => void copy()}>
                <ClipboardCopyIcon /> {t("workspace.counter.coaching.copy")}
              </Button>
            </div>
          </div>
        ) : (
          m.enough && <p className="text-xs text-muted-foreground">{t("workspace.counter.coaching.noNote", { lang: ta ? "தமிழ்" : "English" })}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ shifts

function planText(plan: ShiftPlanView, ta: boolean): string {
  const names = ta ? WEEKDAYS_TA : WEEKDAYS_EN;
  const lines = [`${names.length ? "" : ""}${ta ? "ஷிப்ட் பரிந்துரை" : "Suggested shifts"} ${shortDate(plan.weekStart)}`];
  for (const d of plan.days) {
    const cells = d.cells.map((c) => `${hourLabel(c.hour, ta)}:${c.staff}`).join(" ");
    lines.push(`${names[d.weekday]} ${shortDate(d.date)}  ${cells || "-"}`);
  }
  return lines.join("\n");
}

function ShiftsTab() {
  const { t, locale } = useI18n();
  const ta = locale === "ta";
  const [which, setWhich] = React.useState<"next" | "this">("next");
  const q = useShifts(which);
  const save = useSaveCounterSettings();
  const [target, setTarget] = React.useState("");
  const plan = q.data?.plan;
  React.useEffect(() => {
    if (plan) setTarget(String(plan.target.billsPerStaffHour));
  }, [plan?.target.billsPerStaffHour]); // eslint-disable-line react-hooks/exhaustive-deps -- follow the saved value
  const names = ta ? WEEKDAYS_TA : WEEKDAYS_EN;
  const hours = plan ? Array.from({ length: plan.toHour - plan.fromHour + 1 }, (_, i) => plan.fromHour + i) : [];
  const max = plan ? Math.max(1, ...plan.days.flatMap((d) => d.cells.map((c) => c.staff))) : 1;
  const saveTarget = (v: number | null) =>
    save.mutate({ billsPerStaffHour: v }, { onSuccess: () => toast.success(t("workspace.counter.alerts.saved")), onError: (e) => toast.error(describeError(e, t)) });
  const num = Number(target);
  return (
    <>
      <Card>
        <CardContent className="grid gap-3 p-4">
          <h2 className="text-base font-semibold">{t("workspace.counter.shifts.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("workspace.counter.shifts.help")}</p>
          <ChipGroup
            size="sm"
            aria-label={t("workspace.counter.shifts.week")}
            value={which}
            onChange={setWhich}
            options={[{ value: "next", label: t("workspace.counter.shifts.week.next") }, { value: "this", label: t("workspace.counter.shifts.week.this") }]}
          />
          {plan && (
            <Field>
              <FieldLabel>{t("workspace.counter.shifts.target")}</FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <FieldControl>
                  <Input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} className="h-10 w-24 tabular-nums" data-testid="shift-target" />
                </FieldControl>
                <Button type="button" size="sm" variant="outline" disabled={save.isPending || !(num >= 1 && num <= 200) || num === plan.target.billsPerStaffHour} onClick={() => saveTarget(num)}>
                  {t("workspace.counter.shifts.targetSave")}
                </Button>
                {plan.target.source === "setting" && (
                  <Button type="button" size="sm" variant="ghost" disabled={save.isPending} onClick={() => saveTarget(null)}>
                    {t("workspace.counter.shifts.targetReset")}
                  </Button>
                )}
              </div>
              <FieldHint>
                {t(`workspace.counter.shifts.targetSource.${plan.target.source}`)} · {t("workspace.counter.shifts.weeksUsed", { count: plan.weeksUsed })}
              </FieldHint>
            </Field>
          )}
        </CardContent>
      </Card>

      {q.isLoading && <Skeleton className="h-48 rounded-xl" />}
      {q.isError && <p className="text-sm text-destructive" role="alert">{describeError(q.error, t)}</p>}
      {plan && plan.totals.staffHours === 0 && <EmptyState icon={CalendarRangeIcon} title={t("workspace.counter.shifts.empty")} />}
      {plan && plan.totals.staffHours > 0 && q.data && (
        <Card className="print:border-0 print:shadow-none" data-testid="shift-grid">
          <CardContent className="grid gap-3 p-3 sm:p-4">
            <p className="hidden text-base font-semibold print:block">{t("workspace.counter.shifts.printTitle", { date: shortDate(plan.weekStart) })}</p>
            <p className="text-sm">{ta ? q.data.summary.ta : q.data.summary.en}</p>
            {plan.days.filter((d, i, all) => d.uplift && all.findIndex((x) => x.uplift?.festival.id === d.uplift!.festival.id) === i).map((d) => (
              <p key={d.date} className="text-xs text-muted-foreground">
                {d.uplift!.source === "history"
                  ? t("workspace.counter.shifts.festival", { name: ta ? d.uplift!.festival.nameTa : d.uplift!.festival.name, factor: d.uplift!.factor })
                  : t("workspace.counter.shifts.festivalDefault", { name: ta ? d.uplift!.festival.nameTa : d.uplift!.festival.name, factor: d.uplift!.factor })}
                {" · "}
                {shortDate(d.date)}
              </p>
            ))}
            <div className="overflow-x-auto">
              <table className="w-full table-fixed border-separate border-spacing-1 text-center text-xs" aria-label={t("workspace.counter.shifts.title")}>
                <thead>
                  <tr>
                    <th className="w-9 text-muted-foreground">{t("workspace.counter.shifts.hour")}</th>
                    {plan.days.map((d) => (
                      <th key={d.date} className="font-semibold">
                        <div>{names[d.weekday]}</div>
                        <div className="font-normal text-muted-foreground">{shortDate(d.date)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hours.map((h) => (
                    <tr key={h}>
                      <th scope="row" className="text-right font-normal text-muted-foreground tabular-nums">{hourLabel(h, ta)}</th>
                      {plan.days.map((d) => {
                        const c = d.cells.find((x) => x.hour === h);
                        return (
                          <td
                            key={d.date}
                            title={c ? t("workspace.counter.shifts.cell", { staff: c.staff, bills: c.expectedBills }) : undefined}
                            className={cn("h-8 rounded-md font-semibold tabular-nums", c ? "text-foreground" : "bg-muted/20 text-transparent")}
                            style={c ? { backgroundColor: `color-mix(in oklab, var(--color-primary, #4f46e5) ${Math.round(12 + (c.staff / max) * 55)}%, transparent)` } : undefined}
                            data-staff={c?.staff ?? 0}
                          >
                            {c ? c.staff : "·"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">{t("workspace.counter.shifts.legend")}</p>
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(planText(plan, ta));
                    toast.success(t("workspace.counter.shifts.copied"));
                  } catch {
                    toast.error("Copy failed");
                  }
                }}
              >
                <ClipboardCopyIcon /> {t("workspace.counter.shifts.copy")}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => window.print()}>
                <PrinterIcon /> {t("workspace.counter.shifts.print")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
