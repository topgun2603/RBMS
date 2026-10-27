"use client";

import * as React from "react";
import { ConfirmDialog, describeError, ModuleLink, Page, QueryError, useI18n, useModuleNavigate, usePermission, useRouteParams } from "@srirealtime/web";
import { ArrowLeftIcon, BanIcon, CalendarClockIcon, MoreHorizontalIcon, PauseIcon, PencilIcon, PlayIcon, ReceiptIcon, RepeatIcon, SkipForwardIcon, Trash2Icon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@srirealtime/ui";
import { RecurringStatusPill, RunStatusPill, useScheduleText } from "../components/recurring/rc-ui";
import { useHasPermission } from "../lib/access";
import { money } from "../lib/format";
import { useDeleteRecurring, useRecurring, useRecurringAction, useRunRecurringNow, type RecurringAction } from "../lib/queries-recurring";
import type { RecurringDetail } from "../lib/types-recurring";

export default function RecurringDetailPage() {
  return (
    <React.Suspense fallback={null}>
      <Detail />
    </React.Suspense>
  );
}

function Detail() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const q = useRecurring(id);
  return (
    <Page>
      <div className="mb-3 flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <ModuleLink to="recurring">
            <ArrowLeftIcon /> {t("billing.recurring.list.title")}
          </ModuleLink>
        </Button>
      </div>
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-section lg:grid-cols-[minmax(0,1fr)_21rem]">
          <Skeleton className="h-[60vh] rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : (
        <View p={q.data} />
      )}
    </Page>
  );
}

type Confirm = null | "pause" | "skip" | "run" | "end" | "delete";

function SideRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function View({ p }: { p: RecurringDetail }) {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const schedule = useScheduleText();
  const canManage = usePermission("recurring.manage");
  const canBill = useHasPermission("invoices.create");
  const action = useRecurringAction();
  const runNow = useRunRecurringNow();
  const remove = useDeleteRecurring();
  const [confirm, setConfirm] = React.useState<Confirm>(null);

  const ended = p.status === "ended";
  const doAction = async (a: RecurringAction) => {
    try {
      const r = await action.mutateAsync({ id: p.id, action: a });
      const next = r.nextRunDate ? formatDate(r.nextRunDate) : null;
      if (a === "pause" || a === "end") toast.success(t(`billing.recurring.done.${a}`));
      else toast.success(next ? t(`billing.recurring.done.${a}`, { date: next }) : t("billing.recurring.done.noNext"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const doRun = async () => {
    try {
      const { run } = await runNow.mutateAsync(p.id);
      if (run.status === "created") toast.success(run.invoiceNumber ? t("billing.recurring.done.runNow", { number: run.invoiceNumber }) : t("billing.recurring.done.runNowDraft"));
      else toast.error(t("billing.recurring.done.runNowNot", { error: run.error ?? t(`billing.recurring.run.${run.status}`) }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const doDelete = async () => {
    try {
      await remove.mutateAsync(p.id);
      toast.success(t("billing.recurring.done.deleted"));
      navigate("recurring", { replace: true });
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const busy = action.isPending || runNow.isPending || remove.isPending;
  const modeText = t(p.issueMode === "issue" ? "billing.recurring.form.modeIssue" : "billing.recurring.form.modeDraft");
  const sendText = t(p.sendChannel === "whatsapp" ? "billing.recurring.form.sendWhatsapp" : p.sendChannel === "sms" ? "billing.recurring.form.sendSms" : "billing.recurring.form.sendNone");

  return (
    <>
      <header className="mb-section flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="icon-chip size-9 text-primary">
              <RepeatIcon className="size-4" />
            </span>
            <h1 className="truncate font-heading text-xl font-bold">{p.name}</h1>
            <RecurringStatusPill status={p.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <ModuleLink to={`customers/${p.customerId}`} className="font-medium text-foreground hover:underline">
              {p.customerName}
            </ModuleLink>{" "}
            · {schedule(p)}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            {!ended && canBill && (
              <Button size="lg" className="h-11" disabled={busy} onClick={() => setConfirm("run")}>
                <ReceiptIcon /> {t("billing.recurring.action.runNow")}
              </Button>
            )}
            {p.status === "paused" && (
              <Button size="lg" variant="outline" className="h-11" disabled={busy} onClick={() => void doAction("resume")}>
                <PlayIcon /> {t("billing.recurring.action.resume")}
              </Button>
            )}
            {!ended && (
              <Button asChild size="lg" variant="outline" className="h-11">
                <ModuleLink to={`recurring/${p.id}/edit`}>
                  <PencilIcon /> {t("billing.recurring.action.edit")}
                </ModuleLink>
              </Button>
            )}
            {(!ended || p.count === 0) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="lg" variant="outline" className="h-11" aria-label={t("billing.recurring.more")}>
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {p.status === "active" && (
                    <>
                      <DropdownMenuItem className="h-10" disabled={!p.nextRunDate} onSelect={() => setConfirm("skip")}>
                        <SkipForwardIcon /> {t("billing.recurring.action.skip")}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="h-10" onSelect={() => setConfirm("pause")}>
                        <PauseIcon /> {t("billing.recurring.action.pause")}
                      </DropdownMenuItem>
                    </>
                  )}
                  {!ended && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => setConfirm("end")}>
                        <BanIcon /> {t("billing.recurring.action.end")}
                      </DropdownMenuItem>
                    </>
                  )}
                  {p.count === 0 && (
                    <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => setConfirm("delete")}>
                      <Trash2Icon /> {t("billing.recurring.action.delete")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-section lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <div className="grid min-w-0 gap-section">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("billing.recurring.detail.history")}</CardTitle>
            </CardHeader>
            <CardContent>
              {p.runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {p.nextRunDate ? t("billing.recurring.detail.historyEmpty", { date: formatDate(p.nextRunDate) }) : t("billing.recurring.detail.historyEmptyNoDate")}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("billing.recurring.detail.col.date")}</TableHead>
                      <TableHead>{t("billing.recurring.detail.col.status")}</TableHead>
                      <TableHead>{t("billing.recurring.detail.col.bill")}</TableHead>
                      <TableHead className="text-right">{t("billing.recurring.detail.col.total")}</TableHead>
                      <TableHead>{t("billing.recurring.detail.col.sent")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.runs.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="tabular-nums">{formatDate(r.runDate)}</TableCell>
                        <TableCell>
                          <div className="grid gap-0.5">
                            <RunStatusPill status={r.status} />
                            {r.trigger !== "auto" && <span className="text-xs text-muted-foreground">{t(`billing.recurring.trigger.${r.trigger}`)}</span>}
                            {r.error && <span className="max-w-[18rem] text-xs text-muted-foreground">{r.error}</span>}
                            {r.status === "failed" && r.attempts > 1 && <span className="text-xs text-muted-foreground">{t("billing.recurring.detail.attempts", { count: r.attempts })}</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          {r.invoiceId ? (
                            <ModuleLink to={`invoices/${r.invoiceId}`} className="font-mono hover:underline">
                              {r.invoiceNumber ?? t("billing.recurring.detail.draftBill")}
                            </ModuleLink>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.total !== null ? money(r.total) : "—"}</TableCell>
                        <TableCell>{r.invoiceId ? t(r.sent ? "billing.recurring.detail.sentYes" : "billing.recurring.detail.sentNo") : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("billing.recurring.detail.items")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-1.5 text-sm">
                {p.lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">
                      {l.description} <span className="text-muted-foreground">× {l.qty} {l.unit ?? ""}</span>
                    </span>
                    <span className="tabular-nums">
                      {money(l.rate)} · {l.gstRate}%
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-section">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <CalendarClockIcon className="size-4 text-primary" /> {t("billing.recurring.detail.next")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <p className="font-heading text-xl font-bold tabular-nums">{p.status === "active" && p.nextRunDate ? formatDate(p.nextRunDate) : t("billing.recurring.detail.noNext")}</p>
              <dl className="grid gap-2">
                <SideRow label={t("billing.recurring.detail.made")}>
                  <span className="tabular-nums">{p.maxCount ? t("billing.recurring.countOf", { count: p.count, max: p.maxCount }) : p.count}</span>
                </SideRow>
                <SideRow label={t("billing.recurring.detail.each")}>
                  <span className="font-semibold tabular-nums">{money(p.estimate)}</span>
                </SideRow>
                <SideRow label={t("billing.recurring.detail.started")}>{formatDate(p.startDate)}</SideRow>
                <SideRow label={t("billing.recurring.detail.ends")}>
                  {p.endDate ? formatDate(p.endDate) : p.maxCount ? t("billing.recurring.detail.endsAfter", { count: p.maxCount }) : t("billing.recurring.detail.endsNever")}
                </SideRow>
                <SideRow label={t("billing.recurring.detail.mode")}>{modeText}</SideRow>
                <SideRow label={t("billing.recurring.detail.prices")}>{t(p.priceMode === "list" ? "billing.recurring.form.pricesList" : "billing.recurring.form.pricesFixed")}</SideRow>
                <SideRow label={t("billing.recurring.detail.send")}>{sendText}</SideRow>
                <SideRow label={t("billing.recurring.detail.due")}>{p.dueDays !== null ? t("billing.recurring.detail.dueDays", { days: p.dueDays }) : t("billing.recurring.detail.noDue")}</SideRow>
              </dl>
              {p.lastError && (
                <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
                  <p className="font-medium">{t("billing.recurring.detail.lastError")}</p>
                  <p className="text-meta text-muted-foreground">{p.lastError}</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("billing.recurring.detail.upcoming")}</CardTitle>
            </CardHeader>
            <CardContent>
              {p.upcoming.length ? (
                <ul className="grid gap-1 text-sm tabular-nums">
                  {p.upcoming.map((d) => (
                    <li key={d}>{formatDate(d)}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("billing.recurring.detail.upcomingNone")}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "pause"}
        onOpenChange={(o) => setConfirm(o ? "pause" : null)}
        destructive={false}
        title={t("billing.recurring.confirm.pauseTitle")}
        description={t("billing.recurring.confirm.pauseBody")}
        confirmLabel={t("billing.recurring.action.pause")}
        onConfirm={() => doAction("pause")}
      />
      <ConfirmDialog
        open={confirm === "skip"}
        onOpenChange={(o) => setConfirm(o ? "skip" : null)}
        destructive={false}
        title={t("billing.recurring.confirm.skipTitle")}
        description={t("billing.recurring.confirm.skipBody", { date: p.nextRunDate ? formatDate(p.nextRunDate) : "" })}
        confirmLabel={t("billing.recurring.action.skip")}
        onConfirm={() => doAction("skip")}
      />
      <ConfirmDialog
        open={confirm === "run"}
        onOpenChange={(o) => setConfirm(o ? "run" : null)}
        destructive={false}
        title={t("billing.recurring.confirm.runTitle")}
        description={t("billing.recurring.confirm.runBody", { customer: p.customerName })}
        confirmLabel={t("billing.recurring.action.runNow")}
        onConfirm={doRun}
      />
      <ConfirmDialog
        open={confirm === "end"}
        onOpenChange={(o) => setConfirm(o ? "end" : null)}
        title={t("billing.recurring.confirm.endTitle")}
        description={t("billing.recurring.confirm.endBody")}
        confirmLabel={t("billing.recurring.action.end")}
        onConfirm={() => doAction("end")}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => setConfirm(o ? "delete" : null)}
        title={t("billing.recurring.confirm.deleteTitle")}
        description={t("billing.recurring.confirm.deleteBody")}
        confirmLabel={t("billing.recurring.action.delete")}
        onConfirm={doDelete}
      />
    </>
  );
}
