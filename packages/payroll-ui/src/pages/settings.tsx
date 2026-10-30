"use client";

import * as React from "react";
import { CalendarDaysIcon, ClockIcon, Loader2Icon, PencilIcon, PlusIcon, RotateCcwIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusPill,
  Switch,
  toast,
} from "@rbms/ui";
import { describeError, useFeature, useI18n } from "@rbms/web";
import { AuditorBadge, InlineError } from "../components/bits";
import { WeekdayPicker } from "../components/employee-dialog";
import { PAYROLL_FEATURES } from "../lib/access";
import { bpToPercent, isHm, money, monthOfYear, paiseToRupees, parseHalfDays, percentToBp, rupeesToPaise } from "../lib/format";
import { useAddHoliday, useHolidays, useLeaveTypes, useRemoveHoliday, useSaveLeaveType, useSaveSettings, useSettings, type DeepPartialConfig } from "../lib/queries";
import { MONTHLY_BASES, PT_MODES, type LeaveType, type PayrollConfig, type PtMode } from "../lib/types";

/** Settings → Staff and payroll: attendance rules, salary rules, PF / ESI / professional tax, leave types and holidays. */
export default function PayrollSettingsPage() {
  const { t } = useI18n();
  const s = useSettings();
  const salaryOn = useFeature(PAYROLL_FEATURES.salary);
  if (s.isError) return <InlineError title={describeError(s.error, t)} />;
  if (!s.data) return <Skeleton className="h-96" />;
  const { config, defaults } = s.data;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-section">
      <RulesCard config={config} />
      {salaryOn && <PfCard config={config} defaults={defaults} />}
      {salaryOn && <EsiCard config={config} defaults={defaults} />}
      {salaryOn && <PtCard config={config} defaults={defaults} />}
      <LeaveTypesCard />
      <HolidaysCard />
    </div>
  );
}

function useSave() {
  const { t } = useI18n();
  const save = useSaveSettings();
  const [error, setError] = React.useState<string | null>(null);
  const run = async (patch: DeepPartialConfig) => {
    setError(null);
    try {
      await save.mutateAsync(patch);
      toast.success(t("payroll.settings.saved"));
    } catch (err) {
      setError(describeError(err, t));
    }
  };
  return { run, busy: save.isPending, error };
}

function SaveButton({ busy }: { busy: boolean }) {
  const { t } = useI18n();
  return (
    <Button type="submit" className="justify-self-start" disabled={busy}>
      {busy && <Loader2Icon className="animate-spin" />}
      {t("payroll.common.save")}
    </Button>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <Label className="flex items-start gap-3 font-normal">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span className="grid gap-0.5">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-meta text-muted-foreground">{hint}</span>}
      </span>
    </Label>
  );
}

const intOk = (v: string, min: number, max: number) => /^\d{1,4}$/.test(v) && Number(v) >= min && Number(v) <= max;

function RulesCard({ config }: { config: PayrollConfig }) {
  const { t, locale } = useI18n();
  const salaryOn = useFeature(PAYROLL_FEATURES.salary);
  const save = useSave();
  const [c, setC] = React.useState(config);
  const [grace, setGrace] = React.useState(String(config.graceMinutes));
  const [half, setHalf] = React.useState(String(config.halfDayBelowMinutes));
  const [otAfter, setOtAfter] = React.useState(String(config.otAfterMinutes));
  const [otMul, setOtMul] = React.useState(String(config.otMultiplier));
  const [fixed, setFixed] = React.useState(String(config.fixedDays));
  React.useEffect(() => {
    setC(config);
    setGrace(String(config.graceMinutes));
    setHalf(String(config.halfDayBelowMinutes));
    setOtAfter(String(config.otAfterMinutes));
    setOtMul(String(config.otMultiplier));
    setFixed(String(config.fixedDays));
  }, [config]);
  const set = <K extends keyof PayrollConfig>(k: K, v: PayrollConfig[K]) => setC((x) => ({ ...x, [k]: v }));
  const errors = {
    shift: !isHm(c.shiftStart) || !isHm(c.shiftEnd) ? t("payroll.mark.timeInvalid") : null,
    grace: !intOk(grace, 0, 240) ? t("payroll.settings.minutesRange", { max: 240 }) : null,
    half: !intOk(half, 0, 1440) ? t("payroll.settings.minutesRange", { max: 1440 }) : null,
    otAfter: !intOk(otAfter, 0, 600) ? t("payroll.settings.minutesRange", { max: 600 }) : null,
    otMul: !/^\d(\.\d{1,2})?$/.test(otMul) || Number(otMul) > 5 ? t("payroll.settings.multiplierInvalid") : null,
    fixed: !intOk(fixed, 20, 31) ? t("payroll.settings.fixedInvalid") : null,
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (Object.values(errors).some(Boolean)) return;
    void save.run({
      weekOffs: c.weekOffs,
      shiftStart: c.shiftStart,
      shiftEnd: c.shiftEnd,
      graceMinutes: Number(grace),
      halfDayBelowMinutes: Number(half),
      otAfterMinutes: Number(otAfter),
      otMultiplier: Number(otMul),
      unmarkedAs: c.unmarkedAs,
      monthlyBasis: c.monthlyBasis,
      fixedDays: Number(fixed),
      paidHolidaysForDaily: c.paidHolidaysForDaily,
      paidWeekOffsForDaily: c.paidWeekOffsForDaily,
      offDayWorkPaid: c.offDayWorkPaid,
      roundNet: c.roundNet,
      selfCheckIn: c.selfCheckIn,
      leaveYearStartMonth: c.leaveYearStartMonth,
    });
  };
  const num = (label: string, value: string, set: (v: string) => void, error: string | null, hint?: string) => (
    <Field invalid={!!error}>
      <FieldLabel>{label}</FieldLabel>
      <FieldControl>
        <Input inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} />
      </FieldControl>
      {hint && <FieldHint>{hint}</FieldHint>}
      <FieldError>{error}</FieldError>
    </Field>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClockIcon className="size-4 text-primary" /> {t("payroll.settings.rulesTitle")}
        </CardTitle>
        <CardDescription>{t("payroll.settings.rulesBody")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-2xl gap-5">
          {save.error && <InlineError title={save.error} />}
          <div className="grid gap-2">
            <Label>{t("payroll.settings.weekOffs")}</Label>
            <WeekdayPicker value={c.weekOffs} onChange={(v) => set("weekOffs", v)} locale={locale} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field invalid={!!errors.shift}>
              <FieldLabel>{t("payroll.settings.shiftStart")}</FieldLabel>
              <FieldControl>
                <Input type="time" className="min-w-32" value={c.shiftStart} onChange={(e) => set("shiftStart", e.target.value)} />
              </FieldControl>
              <FieldError>{errors.shift}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("payroll.settings.shiftEnd")}</FieldLabel>
              <FieldControl>
                <Input type="time" className="min-w-32" value={c.shiftEnd} onChange={(e) => set("shiftEnd", e.target.value)} />
              </FieldControl>
            </Field>
            {num(t("payroll.settings.grace"), grace, setGrace, errors.grace, t("payroll.settings.graceHint"))}
            {num(t("payroll.settings.halfDay"), half, setHalf, errors.half, t("payroll.settings.halfDayHint"))}
            {num(t("payroll.settings.otAfter"), otAfter, setOtAfter, errors.otAfter, t("payroll.settings.otAfterHint"))}
            {salaryOn && num(t("payroll.settings.otMultiplier"), otMul, setOtMul, errors.otMul, t("payroll.settings.otMultiplierHint"))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>{t("payroll.settings.unmarked")}</FieldLabel>
              <FieldControl>
                <Select value={c.unmarkedAs} onValueChange={(v) => set("unmarkedAs", v as PayrollConfig["unmarkedAs"])}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="present">{t("payroll.settings.unmarkedPresent")}</SelectItem>
                    <SelectItem value="absent">{t("payroll.settings.unmarkedAbsent")}</SelectItem>
                  </SelectContent>
                </Select>
              </FieldControl>
              <FieldHint>{t("payroll.settings.unmarkedHint")}</FieldHint>
            </Field>
            <Field>
              <FieldLabel>{t("payroll.settings.leaveYear")}</FieldLabel>
              <FieldControl>
                <Select value={String(c.leaveYearStartMonth)} onValueChange={(v) => set("leaveYearStartMonth", Number(v))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>
                        {monthOfYear(i + 1, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldControl>
            </Field>
            {salaryOn && (
              <Field>
                <FieldLabel>{t("payroll.settings.basis")}</FieldLabel>
                <FieldControl>
                  <Select value={c.monthlyBasis} onValueChange={(v) => set("monthlyBasis", v as PayrollConfig["monthlyBasis"])}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHLY_BASES.map((b) => (
                        <SelectItem key={b} value={b}>
                          {t(`payroll.settings.basisOpt.${b}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldControl>
                <FieldHint>{t("payroll.settings.basisHint")}</FieldHint>
              </Field>
            )}
            {salaryOn && c.monthlyBasis === "fixed" && num(t("payroll.settings.fixedDays"), fixed, setFixed, errors.fixed)}
          </div>
          <div className="grid gap-4">
            <Toggle checked={c.selfCheckIn} onChange={(v) => set("selfCheckIn", v)} label={t("payroll.settings.selfCheckIn")} hint={t("payroll.settings.selfCheckInHint")} />
            {salaryOn && (
              <>
                <Toggle checked={c.offDayWorkPaid} onChange={(v) => set("offDayWorkPaid", v)} label={t("payroll.settings.offDayPaid")} hint={t("payroll.settings.offDayPaidHint")} />
                <Toggle checked={c.paidHolidaysForDaily} onChange={(v) => set("paidHolidaysForDaily", v)} label={t("payroll.settings.dailyHolidays")} />
                <Toggle checked={c.paidWeekOffsForDaily} onChange={(v) => set("paidWeekOffsForDaily", v)} label={t("payroll.settings.dailyWeekOffs")} />
                <Toggle checked={c.roundNet} onChange={(v) => set("roundNet", v)} label={t("payroll.settings.roundNet")} />
              </>
            )}
          </div>
          <SaveButton busy={save.busy} />
        </form>
      </CardContent>
    </Card>
  );
}

/** Shows the default next to a statutory card and resets the card to it. */
function DefaultsLine({ text, onReset }: { text: string; onReset: () => void }) {
  const { t } = useI18n();
  return (
    <p className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
      {t("payroll.settings.defaultsAre", { text })}
      <Button type="button" size="sm" variant="ghost" onClick={onReset}>
        <RotateCcwIcon /> {t("payroll.settings.reset")}
      </Button>
    </p>
  );
}

function PfCard({ config, defaults }: { config: PayrollConfig; defaults: PayrollConfig }) {
  const { t } = useI18n();
  const save = useSave();
  const [on, setOn] = React.useState(config.pf.enabled);
  const [emp, setEmp] = React.useState(bpToPercent(config.pf.employeeRateBp));
  const [er, setEr] = React.useState(bpToPercent(config.pf.employerRateBp));
  const [ceiling, setCeiling] = React.useState(paiseToRupees(config.pf.wageCeiling));
  const [cap, setCap] = React.useState(config.pf.capAtCeiling);
  const load = (p: PayrollConfig["pf"], keepOn: boolean) => {
    if (!keepOn) setOn(p.enabled);
    setEmp(bpToPercent(p.employeeRateBp));
    setEr(bpToPercent(p.employerRateBp));
    setCeiling(paiseToRupees(p.wageCeiling));
    setCap(p.capAtCeiling);
  };
  React.useEffect(() => load(config.pf, false), [config.pf]);
  const e1 = percentToBp(emp);
  const e2 = percentToBp(er);
  const c = rupeesToPaise(ceiling);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (e1 === null || e2 === null || c === null) return;
    void save.run({ pf: { enabled: on, employeeRateBp: e1, employerRateBp: e2, wageCeiling: c, capAtCeiling: cap } });
  };
  const d = defaults.pf;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4 text-primary" /> {t("payroll.settings.pfTitle")}
        </CardTitle>
        <CardDescription>{t("payroll.settings.pfBody")}</CardDescription>
        <CardAction>
          <AuditorBadge />
        </CardAction>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-2xl gap-5">
          {save.error && <InlineError title={save.error} />}
          <Toggle checked={on} onChange={setOn} label={t("payroll.settings.pfOn")} hint={t("payroll.settings.pfOnHint")} />
          <div className="grid gap-4 sm:grid-cols-3">
            <PercentField label={t("payroll.settings.employeeRate")} value={emp} onChange={setEmp} />
            <PercentField label={t("payroll.settings.employerRate")} value={er} onChange={setEr} hint={t("payroll.settings.pfEmployerHint")} />
            <Field invalid={c === null}>
              <FieldLabel>{t("payroll.settings.pfCeiling")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={ceiling} onChange={(e) => setCeiling(e.target.value)} />
              </FieldControl>
              <FieldError>{c === null ? t("payroll.common.amountInvalid") : null}</FieldError>
            </Field>
          </div>
          <Toggle checked={cap} onChange={setCap} label={t("payroll.settings.pfCap")} hint={t("payroll.settings.pfCapHint")} />
          <DefaultsLine
            text={t("payroll.settings.pfDefaults", { emp: bpToPercent(d.employeeRateBp), er: bpToPercent(d.employerRateBp), ceiling: money(d.wageCeiling) })}
            onReset={() => load(d, true)}
          />
          <SaveButton busy={save.busy} />
        </form>
      </CardContent>
    </Card>
  );
}

function PercentField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const { t } = useI18n();
  const bad = percentToBp(value) === null;
  return (
    <Field invalid={bad}>
      <FieldLabel>{label}</FieldLabel>
      <FieldControl>
        <Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
      </FieldControl>
      {hint && <FieldHint>{hint}</FieldHint>}
      <FieldError>{bad ? t("payroll.settings.percentInvalid") : null}</FieldError>
    </Field>
  );
}

function EsiCard({ config, defaults }: { config: PayrollConfig; defaults: PayrollConfig }) {
  const { t } = useI18n();
  const save = useSave();
  const [on, setOn] = React.useState(config.esi.enabled);
  const [emp, setEmp] = React.useState(bpToPercent(config.esi.employeeRateBp));
  const [er, setEr] = React.useState(bpToPercent(config.esi.employerRateBp));
  const [ceiling, setCeiling] = React.useState(paiseToRupees(config.esi.grossCeiling));
  const load = (p: PayrollConfig["esi"], keepOn: boolean) => {
    if (!keepOn) setOn(p.enabled);
    setEmp(bpToPercent(p.employeeRateBp));
    setEr(bpToPercent(p.employerRateBp));
    setCeiling(paiseToRupees(p.grossCeiling));
  };
  React.useEffect(() => load(config.esi, false), [config.esi]);
  const e1 = percentToBp(emp);
  const e2 = percentToBp(er);
  const c = rupeesToPaise(ceiling);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (e1 === null || e2 === null || c === null) return;
    void save.run({ esi: { enabled: on, employeeRateBp: e1, employerRateBp: e2, grossCeiling: c } });
  };
  const d = defaults.esi;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4 text-primary" /> {t("payroll.settings.esiTitle")}
        </CardTitle>
        <CardDescription>{t("payroll.settings.esiBody")}</CardDescription>
        <CardAction>
          <AuditorBadge />
        </CardAction>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-2xl gap-5">
          {save.error && <InlineError title={save.error} />}
          <Toggle checked={on} onChange={setOn} label={t("payroll.settings.esiOn")} hint={t("payroll.settings.esiOnHint")} />
          <div className="grid gap-4 sm:grid-cols-3">
            <PercentField label={t("payroll.settings.employeeRate")} value={emp} onChange={setEmp} />
            <PercentField label={t("payroll.settings.employerRate")} value={er} onChange={setEr} />
            <Field invalid={c === null}>
              <FieldLabel>{t("payroll.settings.esiCeiling")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={ceiling} onChange={(e) => setCeiling(e.target.value)} />
              </FieldControl>
              <FieldError>{c === null ? t("payroll.common.amountInvalid") : null}</FieldError>
            </Field>
          </div>
          <DefaultsLine
            text={t("payroll.settings.esiDefaults", { emp: bpToPercent(d.employeeRateBp), er: bpToPercent(d.employerRateBp), ceiling: money(d.grossCeiling) })}
            onReset={() => load(d, true)}
          />
          <SaveButton busy={save.busy} />
        </form>
      </CardContent>
    </Card>
  );
}

interface SlabRow {
  upTo: string;
  tax: string;
}

function PtCard({ config, defaults }: { config: PayrollConfig; defaults: PayrollConfig }) {
  const { t, locale } = useI18n();
  const save = useSave();
  const [on, setOn] = React.useState(config.pt.enabled);
  const [mode, setMode] = React.useState<PtMode>(config.pt.mode);
  const [months, setMonths] = React.useState<number[]>(config.pt.deductMonths);
  const [slabs, setSlabs] = React.useState<SlabRow[]>([]);
  const load = (p: PayrollConfig["pt"], keepOn: boolean) => {
    if (!keepOn) setOn(p.enabled);
    setMode(p.mode);
    setMonths(p.deductMonths);
    setSlabs(p.slabs.map((s) => ({ upTo: s.upTo === null ? "" : paiseToRupees(s.upTo), tax: paiseToRupees(s.tax) })));
  };
  React.useEffect(() => load(config.pt, false), [config.pt]);
  const parsed = slabs.map((s) => ({ upTo: s.upTo.trim() ? rupeesToPaise(s.upTo) : null, tax: rupeesToPaise(s.tax), openOk: !s.upTo.trim() }));
  const badSlab = parsed.some((s) => s.tax === null || (s.upTo === null && !s.openOk)) || parsed.filter((s) => s.upTo === null).length > 1 || parsed.length === 0;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (badSlab || (mode === "half-yearly" && months.length === 0)) return;
    const out = parsed.map((s) => ({ upTo: s.upTo, tax: s.tax ?? 0 })).sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
    void save.run({ pt: { enabled: on, mode, deductMonths: months, slabs: out } });
  };
  const d = defaults.pt;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4 text-primary" /> {t("payroll.settings.ptTitle")}
        </CardTitle>
        <CardDescription>{t("payroll.settings.ptBody")}</CardDescription>
        <CardAction>
          <AuditorBadge />
        </CardAction>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-2xl gap-5">
          {save.error && <InlineError title={save.error} />}
          <Toggle checked={on} onChange={setOn} label={t("payroll.settings.ptOn")} hint={t("payroll.settings.ptOnHint")} />
          <Field>
            <FieldLabel>{t("payroll.settings.ptMode")}</FieldLabel>
            <FieldControl>
              <Select value={mode} onValueChange={(v) => setMode(v as PtMode)}>
                <SelectTrigger className="w-full sm:w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PT_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`payroll.settings.ptModeOpt.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldControl>
          </Field>
          {mode === "half-yearly" && (
            <div className="grid gap-2">
              <Label>{t("payroll.settings.ptMonths")}</Label>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                  const sel = months.includes(m);
                  return (
                    <Button key={m} type="button" size="sm" variant={sel ? "default" : "outline"} aria-pressed={sel} onClick={() => setMonths(sel ? months.filter((x) => x !== m) : [...months, m].sort((a, b) => a - b))}>
                      {monthOfYear(m, locale).slice(0, 3)}
                    </Button>
                  );
                })}
              </div>
              <p className="text-meta text-muted-foreground">{t("payroll.settings.ptMonthsHint")}</p>
            </div>
          )}
          <div className="grid gap-2">
            <Label>{t("payroll.settings.ptSlabs")}</Label>
            <p className="text-meta text-muted-foreground">{t("payroll.settings.ptSlabsHint")}</p>
            {slabs.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-24 text-meta text-muted-foreground">{t("payroll.settings.ptUpTo")}</span>
                <Input aria-label={t("payroll.settings.ptUpTo")} className="w-40" inputMode="decimal" placeholder={t("payroll.settings.ptAbove")} value={s.upTo} onChange={(e) => setSlabs((xs) => xs.map((x, j) => (j === i ? { ...x, upTo: e.target.value } : x)))} />
                <span className="text-meta text-muted-foreground">{t("payroll.settings.ptTax")}</span>
                <Input aria-label={t("payroll.settings.ptTax")} className="w-32" inputMode="decimal" value={s.tax} onChange={(e) => setSlabs((xs) => xs.map((x, j) => (j === i ? { ...x, tax: e.target.value } : x)))} />
                <Button type="button" size="icon" variant="ghost" aria-label={t("payroll.common.delete")} onClick={() => setSlabs((xs) => xs.filter((_, j) => j !== i))}>
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            {badSlab && <p className="text-sm text-destructive">{t("payroll.settings.ptSlabsInvalid")}</p>}
            <Button type="button" size="sm" variant="outline" className="justify-self-start" disabled={slabs.length >= 20} onClick={() => setSlabs((xs) => [...xs, { upTo: "", tax: "" }])}>
              <PlusIcon /> {t("payroll.settings.ptAddSlab")}
            </Button>
          </div>
          <DefaultsLine text={t("payroll.settings.ptDefaults")} onReset={() => load(d, true)} />
          <SaveButton busy={save.busy} />
        </form>
      </CardContent>
    </Card>
  );
}

function LeaveTypesCard() {
  const { t } = useI18n();
  const types = useLeaveTypes();
  const [editing, setEditing] = React.useState<LeaveType | null>(null);
  const [creating, setCreating] = React.useState(false);
  const list = types.data?.items ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDaysIcon className="size-4 text-primary" /> {t("payroll.settings.leaveTitle")}
        </CardTitle>
        <CardDescription>{t("payroll.settings.leaveBody")}</CardDescription>
        <CardAction>
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon /> {t("payroll.settings.leaveAdd")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {types.isPending ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
            {list.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-2 odd:bg-muted/40">
                <span className="grid min-w-0 gap-0.5">
                  <span className="flex items-center gap-2 font-medium">
                    {x.name} <span className="font-mono text-meta text-muted-foreground">{x.code}</span>
                    {!x.active && <StatusPill tone="neutral">{t("payroll.settings.off")}</StatusPill>}
                  </span>
                  <span className="text-meta text-muted-foreground">
                    {x.paid ? t("payroll.settings.leavePaidN", { days: x.yearlyDays }) : t("payroll.leave.unpaid")}
                    {x.carryForward ? ` · ${t("payroll.settings.carryN", { days: x.maxCarryDays })}` : ""}
                  </span>
                </span>
                <Button size="icon" variant="ghost" className="size-8" aria-label={t("payroll.common.edit")} onClick={() => setEditing(x)}>
                  <PencilIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-meta text-muted-foreground">{t("payroll.settings.leaveDefaultsHint")}</p>
      </CardContent>
      <LeaveTypeDialog
        open={creating || !!editing}
        type={editing}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
          }
        }}
      />
    </Card>
  );
}

function LeaveTypeDialog({ open, type, onOpenChange }: { open: boolean; type: LeaveType | null; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const save = useSaveLeaveType(type?.id);
  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [paid, setPaid] = React.useState(true);
  const [yearly, setYearly] = React.useState("12");
  const [carry, setCarry] = React.useState(false);
  const [maxCarry, setMaxCarry] = React.useState("0");
  const [active, setActive] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setCode(type?.code ?? "");
    setName(type?.name ?? "");
    setPaid(type?.paid ?? true);
    setYearly(String(type?.yearlyDays ?? 12));
    setCarry(type?.carryForward ?? false);
    setMaxCarry(String(type?.maxCarryDays ?? 0));
    setActive(type?.active ?? true);
    setError(null);
  }, [open, type]);
  const y = parseHalfDays(yearly);
  const m = parseHalfDays(maxCarry);
  const errors = {
    code: !/^[A-Za-z][A-Za-z0-9]{0,5}$/.test(code.trim()) ? t("payroll.settings.codeInvalid") : null,
    name: !name.trim() ? t("payroll.common.required") : null,
    yearly: y === null ? t("payroll.common.halfDaysInvalid") : null,
    maxCarry: carry && m === null ? t("payroll.common.halfDaysInvalid") : null,
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Object.values(errors).some(Boolean)) return;
    try {
      await save.mutateAsync({ code: code.trim().toUpperCase(), name: name.trim(), paid, yearlyDays: y ?? 0, carryForward: carry, maxCarryDays: carry ? (m ?? 0) : 0, active });
      toast.success(t("payroll.settings.saved"));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("payroll.common.close")} className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{type ? t("payroll.settings.leaveEdit") : t("payroll.settings.leaveAdd")}</DialogTitle>
            <DialogDescription>{t("payroll.settings.leaveDialogBody")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <Field invalid={!!errors.code}>
              <FieldLabel>{t("payroll.settings.code")}</FieldLabel>
              <FieldControl>
                <Input value={code} maxLength={6} onChange={(e) => setCode(e.target.value.toUpperCase())} />
              </FieldControl>
              <FieldError>{errors.code}</FieldError>
            </Field>
            <Field invalid={!!errors.name}>
              <FieldLabel>{t("payroll.settings.leaveName")}</FieldLabel>
              <FieldControl>
                <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              </FieldControl>
              <FieldError>{errors.name}</FieldError>
            </Field>
          </div>
          <Toggle checked={paid} onChange={setPaid} label={t("payroll.settings.leavePaid")} />
          <Field invalid={!!errors.yearly}>
            <FieldLabel>{t("payroll.settings.yearlyDays")}</FieldLabel>
            <FieldControl>
              <Input inputMode="decimal" value={yearly} onChange={(e) => setYearly(e.target.value)} />
            </FieldControl>
            <FieldHint>{t("payroll.settings.yearlyHint")}</FieldHint>
            <FieldError>{errors.yearly}</FieldError>
          </Field>
          <Toggle checked={carry} onChange={setCarry} label={t("payroll.settings.carry")} />
          {carry && (
            <Field invalid={!!errors.maxCarry}>
              <FieldLabel>{t("payroll.settings.maxCarry")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={maxCarry} onChange={(e) => setMaxCarry(e.target.value)} />
              </FieldControl>
              <FieldError>{errors.maxCarry}</FieldError>
            </Field>
          )}
          <Toggle checked={active} onChange={setActive} label={t("payroll.settings.inUse")} />
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {t("payroll.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HolidaysCard() {
  const { t, formatDate } = useI18n();
  const [year, setYear] = React.useState(new Date().getFullYear());
  const h = useHolidays(year);
  const add = useAddHoliday();
  const remove = useRemoveHoliday();
  const [date, setDate] = React.useState("");
  const [name, setName] = React.useState("");
  const fail = (err: unknown) => toast.error(describeError(err, t));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !name.trim()) return;
    try {
      await add.mutateAsync({ date, name: name.trim() });
      setDate("");
      setName("");
    } catch (err) {
      fail(err);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDaysIcon className="size-4 text-primary" /> {t("payroll.settings.holidaysTitle", { year })}
        </CardTitle>
        <CardDescription>{t("payroll.settings.holidaysBody")}</CardDescription>
        <CardAction className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => setYear(year - 1)}>
            {year - 1}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setYear(year + 1)}>
            {year + 1}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {h.isPending ? (
          <Skeleton className="h-24" />
        ) : (
          <>
            {(h.data?.items ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("payroll.settings.noHolidays")}</p>
            ) : (
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
                {h.data!.items.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 odd:bg-muted/40">
                    <span className="text-sm">
                      <span className="tabular-nums">{formatDate(x.date)}</span> · {x.name}
                    </span>
                    <Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label={t("payroll.common.delete")} onClick={() => remove.mutateAsync(x.id).catch(fail)}>
                      <Trash2Icon />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {(h.data?.suggestions ?? []).length > 0 && (
              <div className="grid gap-2">
                <Label>{t("payroll.settings.suggestions")}</Label>
                <div className="flex flex-wrap gap-1">
                  {h.data!.suggestions.map((s) => (
                    <Button key={s.date} size="sm" variant="outline" disabled={add.isPending} onClick={() => add.mutateAsync({ date: s.date, name: s.name }).catch(fail)}>
                      <PlusIcon /> {s.name} · {formatDate(s.date)}
                    </Button>
                  ))}
                </div>
                <p className="text-meta text-muted-foreground">{t("payroll.settings.suggestionsHint")}</p>
              </div>
            )}
          </>
        )}
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <Field>
            <FieldLabel>{t("payroll.col.date")}</FieldLabel>
            <FieldControl>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </FieldControl>
          </Field>
          <Field className="min-w-48 flex-1">
            <FieldLabel>{t("payroll.settings.holidayName")}</FieldLabel>
            <FieldControl>
              <Input value={name} maxLength={80} placeholder={t("payroll.settings.holidayPlaceholder")} onChange={(e) => setName(e.target.value)} />
            </FieldControl>
          </Field>
          <Button type="submit" disabled={add.isPending || !date || !name.trim()}>
            <PlusIcon /> {t("payroll.settings.holidayAdd")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
