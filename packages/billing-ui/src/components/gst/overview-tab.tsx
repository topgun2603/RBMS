"use client";

import * as React from "react";
import { ArrowRightIcon, CalendarCheckIcon, CheckCircle2Icon, ClockIcon, HourglassIcon, TriangleAlertIcon, Undo2Icon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Skeleton,
  StatusPill,
  toast,
} from "@rbms/ui";
import { describeError, QueryError, useI18n } from "@rbms/web";
import { todayIST } from "../../lib/format";
import {
  isQuarterKey,
  monthOfPeriod,
  quarterOfPeriod,
  schemeOf,
  useGstIssues,
  useMarkFiled,
  useUnmarkFiled,
  type DueItem,
  type FilingIssue,
  type GstOverview,
  type IssueTab,
} from "../../lib/gst";
import { PeriodPicker, SeverityPill, Section, useCanManage, useGstText } from "./shared";

export type GoFn = (to: { tab: IssueTab; period?: string; filter?: string }) => void;

const STATUS_TONE = { filed: "success", overdue: "danger", due_soon: "warning", upcoming: "neutral" } as const;
const STATUS_ICON = { filed: CheckCircle2Icon, overdue: TriangleAlertIcon, due_soon: ClockIcon, upcoming: HourglassIcon } as const;

/** Where a return is prepared. */
export function tabOfReturn(type: DueItem["returnType"]): IssueTab {
  return type === "gstr1" ? "gstr1" : type === "gstr3b" || type === "pmt06" ? "gstr3b" : type === "gstr2b" ? "gstr2b" : "composition";
}

export function SchemeBadge({ scheme }: { scheme: ReturnType<typeof schemeOf> }) {
  const { t } = useI18n();
  return (
    <StatusPill tone={scheme === "composition" ? "warning" : scheme === "qrmp" ? "info" : "brand"} size="md">
      {t(`billing.gst.scheme.${scheme}`)}
    </StatusPill>
  );
}

export function OverviewTab({ overview, period, onPeriod, go }: { overview: GstOverview; period: string; onPeriod: (p: string) => void; go: GoFn }) {
  const { t } = useI18n();
  const text = useGstText();
  const scheme = schemeOf(overview.config);
  const quarterly = scheme !== "regular";
  const effective = quarterly ? quarterOfPeriod(period) : monthOfPeriod(period);
  const [marking, setMarking] = React.useState<DueItem | null>(null);
  const canManage = useCanManage();
  const unmark = useUnmarkFiled();

  const profileIssues = overview.issues.filter((i) => i.code !== "overdue");

  const undo = async (d: DueItem) => {
    try {
      await unmark.mutateAsync({ returnType: d.returnType, period: d.period });
      toast.success(t("billing.gst.cal.undone"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <div className="grid gap-5">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <SchemeBadge scheme={scheme} />
          <p className="min-w-0 flex-1 break-words text-sm text-muted-foreground">{t(`billing.gst.scheme.${scheme}Body`)}</p>
          <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => go({ tab: "settings" })}>
            {t("billing.gst.scheme.change")}
          </Button>
        </CardContent>
      </Card>

      {profileIssues.length > 0 && (
        <Section title={t("billing.gst.profile.title")} hint={t("billing.gst.profile.hint")}>
          <ul className="grid gap-2">
            {profileIssues.map((i) => (
              <IssueRow key={i.id} issue={i} sentence={text.issue(i)} go={go} />
            ))}
          </ul>
        </Section>
      )}

      <Section title={t("billing.gst.cal.title")} hint={t("billing.gst.cal.hint")} flush>
        {overview.calendar.length === 0 ? (
          <EmptyState compact icon={CalendarCheckIcon} title={t("billing.gst.cal.emptyTitle")} description={t("billing.gst.cal.emptyBody")} />
        ) : (
          <ul className="divide-y">
            {overview.calendar.map((d) => {
              const Icon = STATUS_ICON[d.status];
              return (
                <li key={`${d.returnType}|${d.period}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="font-medium">
                      {text.returnName(d.returnType)} <span className="font-normal text-muted-foreground">· {text.label(d.period)}</span>
                    </p>
                    <p className="text-meta text-muted-foreground">
                      {d.filed && d.filedOn
                        ? t("billing.gst.cal.filedOn", { date: text.dateText(d.filedOn) })
                        : t("billing.gst.cal.due", { date: text.dateText(d.dueDate) }) + " · " + dueWords(t, d)}
                    </p>
                  </div>
                  <StatusPill tone={STATUS_TONE[d.status]} icon={Icon}>
                    {t(`billing.gst.cal.status.${d.status}`)}
                  </StatusPill>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => go({ tab: tabOfReturn(d.returnType), period: d.period })}>
                      {t("billing.gst.cal.open")}
                      <ArrowRightIcon />
                    </Button>
                    {canManage && d.returnType !== "pmt06" && (d.filed ? (
                      <Button type="button" variant="ghost" size="sm" className="h-11 sm:h-9" disabled={unmark.isPending} onClick={() => void undo(d)}>
                        <Undo2Icon />
                        {t("billing.gst.cal.undo")}
                      </Button>
                    ) : (
                      <Button type="button" size="sm" className="h-11 sm:h-9" onClick={() => setMarking(d)}>
                        <CheckCircle2Icon />
                        {t(d.returnType === "gstr2b" ? "billing.gst.cal.markDone" : "billing.gst.cal.markFiled")}
                      </Button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <PeriodIssues period={effective} quarterly={quarterly} onPeriod={onPeriod} go={go} />

      <MarkFiledDialog item={marking} onClose={() => setMarking(null)} />
    </div>
  );
}

function dueWords(t: ReturnType<typeof useI18n>["t"], d: DueItem): string {
  const left = d.daysLeft ?? 0;
  if (left < 0) return t("billing.gst.cal.daysLate", { days: -left });
  if (left === 0) return t("billing.gst.cal.today");
  return t("billing.gst.cal.daysLeft", { days: left });
}

function IssueRow({ issue, sentence, go }: { issue: FilingIssue; sentence: string; go: GoFn }) {
  const { t } = useI18n();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-3">
      <SeverityPill severity={issue.severity} />
      <p className="min-w-0 flex-1 basis-64 text-sm">{sentence}</p>
      {issue.count ? <span className="rounded-full bg-muted px-2 text-xs tabular-nums">{issue.count}</span> : null}
      {issue.link && (
        <Button type="button" variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => go(issue.link!)}>
          {t("billing.gst.issues.fix")}
          <ArrowRightIcon />
        </Button>
      )}
    </li>
  );
}

/** The "fix before filing" list for one month or quarter. */
function PeriodIssues({ period, quarterly, onPeriod, go }: { period: string; quarterly: boolean; onPeriod: (p: string) => void; go: GoFn }) {
  const { t } = useI18n();
  const text = useGstText();
  const q = useGstIssues(period);
  return (
    <Section
      title={t("billing.gst.issues.title")}
      hint={t("billing.gst.issues.hint")}
      actions={<PeriodPicker value={period} onChange={onPeriod} kind={quarterly || isQuarterKey(period) ? "quarter" : "month"} id="gst-issues-period" />}
    >
      {q.isError && !q.data ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <div className="grid gap-2" aria-busy>
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
          <p className="text-meta text-muted-foreground">{t("billing.gst.issues.checking")}</p>
        </div>
      ) : q.data.issues.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl bg-success/10 p-4 text-sm text-success-ink">
          <CheckCircle2Icon className="size-4 shrink-0" />
          {t("billing.gst.issues.none", { period: text.label(period) })}
        </p>
      ) : (
        <ul className={q.isFetching ? "grid gap-2 opacity-60" : "grid gap-2"}>
          {[...q.data.issues]
            .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : b.severity === "error" ? 1 : a.severity === "warning" ? -1 : 1))
            .map((i) => (
              <IssueRow key={i.id} issue={i} sentence={text.issue(i)} go={go} />
            ))}
        </ul>
      )}
    </Section>
  );
}

function MarkFiledDialog({ item, onClose }: { item: DueItem | null; onClose: () => void }) {
  const { t } = useI18n();
  const text = useGstText();
  const mark = useMarkFiled();
  const [date, setDate] = React.useState(todayIST());
  const [arn, setArn] = React.useState("");
  React.useEffect(() => {
    setDate(todayIST());
    setArn("");
  }, [item?.returnType, item?.period]);
  if (!item) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await mark.mutateAsync({ returnType: item.returnType, period: item.period, filedOn: date, arn: arn.trim() || null });
      toast.success(t("billing.gst.cal.marked"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !mark.isPending && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("billing.common.close")}>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("billing.gst.cal.markTitle", { name: text.returnName(item.returnType), period: text.label(item.period) })}</DialogTitle>
            <DialogDescription>{t("billing.gst.cal.markBody")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="filed-on">{t("billing.gst.cal.filedDate")}</Label>
            <Input id="filed-on" type="date" required max={todayIST()} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filed-arn">{t("billing.gst.cal.arn")}</Label>
            <Input id="filed-arn" maxLength={40} value={arn} onChange={(e) => setArn(e.target.value)} placeholder={t("billing.gst.cal.arnHint")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={mark.isPending}>
              {t("billing.common.cancel")}
            </Button>
            <Button type="submit" disabled={mark.isPending || !date}>
              {t("billing.gst.cal.markSave")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
