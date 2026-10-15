"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  ChipGroup,
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
  FieldRow,
  Input,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  toast,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { describeError, useI18n, useMe } from "@srirealtime/web";
import { ChipsInput } from "./chips-input";
import { InlineError } from "../bits";
import { useSaveSchedule } from "../../lib/queries/reports";
import {
  defaultScheduleDraft,
  isEmail,
  MAX_RECIPIENTS,
  normalizeEmail,
  REPORT_FORMATS,
  SCHEDULE_PRESETS,
  scheduleBody,
  scheduleToDraft,
  validateSchedule,
  type ScheduleDraft,
} from "../../lib/report-spec";
import type { ReportFormat, ReportSchedule, SchedulePreset } from "../../lib/types";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

/** Create or edit a schedule of a saved report: daily/weekly/monthly at an IST time, emailed as CSV/XLSX. */
export function ScheduleDialog({
  open,
  onOpenChange,
  reportId,
  reportName,
  schedule,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId: string;
  reportName?: string;
  /** Edit this one; omit to create. */
  schedule?: ReportSchedule | null;
}) {
  const { t } = useI18n();
  const me = useMe();
  const reduced = useReducedMotionSafe();
  const save = useSaveSchedule();
  const [d, setD] = React.useState<ScheduleDraft>(() => defaultScheduleDraft());
  const [submitted, setSubmitted] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    save.reset();
    setSubmitted(false);
    setD(schedule ? scheduleToDraft(schedule) : defaultScheduleDraft(me.data?.user.email ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, schedule?.id]);

  const set = (patch: Partial<ScheduleDraft>) => setD((x) => ({ ...x, ...patch }));
  const issues = validateSchedule(d);
  const err = (k: keyof typeof issues) => (submitted && issues[k] ? t(`growth.reports.issues.${issues[k]}`, { max: MAX_RECIPIENTS }) : null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(issues).length) return;
    try {
      await save.mutateAsync({ id: schedule?.id, body: scheduleBody(reportId, d) });
      toast.success(t(schedule ? "growth.reports.schedule.updated" : "growth.reports.schedule.created"));
      onOpenChange(false);
    } catch {
      // inline
    }
  };

  const collapse = {
    initial: reduced ? false : ({ opacity: 0, height: 0 } as const),
    animate: { opacity: 1, height: "auto" },
    exit: reduced ? { opacity: 0 } : { opacity: 0, height: 0 },
    transition: { duration: 0.2 },
    className: "overflow-hidden",
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent closeLabel={t("growth.common.close")} className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t(schedule ? "growth.reports.schedule.editTitle" : "growth.reports.schedule.newTitle")}</DialogTitle>
            <DialogDescription>{reportName ? t("growth.reports.schedule.descriptionNamed", { name: reportName }) : t("growth.reports.schedule.description")}</DialogDescription>
          </DialogHeader>

          <Field>
            <FieldLabel htmlFor={null}>{t("growth.reports.schedule.repeat")}</FieldLabel>
            <ChipGroup<SchedulePreset>
              size="sm"
              aria-label={t("growth.reports.schedule.repeat")}
              value={d.preset}
              onChange={(preset) => set({ preset })}
              options={SCHEDULE_PRESETS.map((p) => ({ value: p, label: t(`growth.reports.schedule.presets.${p}`) }))}
            />
          </Field>

          <FieldRow cols={2}>
            <Field invalid={!!err("time")}>
              <FieldLabel>{t("growth.reports.schedule.time")}</FieldLabel>
              <FieldControl>
                <Input type="time" step={300} value={d.time} onChange={(e) => set({ time: e.target.value })} />
              </FieldControl>
              <FieldHint>{t("growth.reports.schedule.ist")}</FieldHint>
              <FieldError>{err("time")}</FieldError>
            </Field>
            <AnimatePresence initial={false} mode="popLayout">
              {d.preset === "weekly" && (
                <motion.div key="weekly" {...collapse}>
                  <Field>
                    <FieldLabel>{t("growth.reports.schedule.weekday")}</FieldLabel>
                    <Select value={String(d.weekday)} onValueChange={(v) => set({ weekday: Number(v) })}>
                      <FieldControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FieldControl>
                      <SelectContent>
                        {WEEKDAYS.map((w) => (
                          <SelectItem key={w} value={String(w)}>
                            {t(`growth.reports.schedule.days.${w}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </motion.div>
              )}
              {d.preset === "monthly" && (
                <motion.div key="monthly" {...collapse}>
                  <Field invalid={!!err("dayOfMonth")}>
                    <FieldLabel>{t("growth.reports.schedule.dayOfMonth")}</FieldLabel>
                    <Select value={String(d.dayOfMonth)} onValueChange={(v) => set({ dayOfMonth: Number(v) })}>
                      <FieldControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FieldControl>
                      <SelectContent className="max-h-64">
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldHint>{t("growth.reports.schedule.dayHint")}</FieldHint>
                    <FieldError>{err("dayOfMonth")}</FieldError>
                  </Field>
                </motion.div>
              )}
            </AnimatePresence>
          </FieldRow>

          <Field invalid={!!err("recipients")}>
            <FieldLabel aside={<span className="tabular-nums">{`${d.recipients.length}/${MAX_RECIPIENTS}`}</span>}>{t("growth.reports.schedule.recipients")}</FieldLabel>
            <FieldControl>
              <ChipsInput
                type="email"
                inputMode="email"
                value={d.recipients}
                max={MAX_RECIPIENTS}
                normalize={normalizeEmail}
                validate={isEmail}
                onChange={(recipients) => set({ recipients })}
                placeholder={t("growth.reports.schedule.recipientsPlaceholder")}
              />
            </FieldControl>
            <FieldHint>{t("growth.reports.schedule.recipientsHint", { max: MAX_RECIPIENTS })}</FieldHint>
            <FieldError>{err("recipients")}</FieldError>
          </Field>

          <FieldRow cols={2}>
            <Field>
              <FieldLabel>{t("growth.reports.schedule.format")}</FieldLabel>
              <Select value={d.format} onValueChange={(v) => set({ format: v as ReportFormat })}>
                <FieldControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {REPORT_FORMATS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {t(`growth.reports.formats.${f}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t("growth.reports.schedule.active")}</FieldLabel>
              <div className="flex h-10 items-center gap-3">
                <FieldControl>
                  <Switch checked={d.active} onCheckedChange={(active) => set({ active })} />
                </FieldControl>
                <span className="text-sm text-muted-foreground">{d.active ? t("growth.common.active") : t("growth.common.inactive")}</span>
              </div>
            </Field>
          </FieldRow>

          {save.error ? <InlineError title={t("growth.reports.schedule.failed")}>{describeError(save.error, t)}</InlineError> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              {t("growth.common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {save.isPending ? t("growth.common.saving") : t("growth.reports.schedule.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
