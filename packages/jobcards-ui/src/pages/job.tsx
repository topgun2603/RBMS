"use client";

import * as React from "react";
import {
  ArrowRightIcon,
  BanIcon,
  CheckIcon,
  CircleDotIcon,
  CopyIcon,
  FilePlusIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  PrinterIcon,
  ReceiptIcon,
  StickyNoteIcon,
  ThumbsUpIcon,
  Trash2Icon,
} from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog, DetailRow, describeError, ModuleLink, Page, PageHeading, useFeature, useI18n, usePermission, useRouteParams } from "@srirealtime/web";
import { ApprovalCard, ApprovalDialog } from "../components/approval";
import { DueDate, InlineError, JobStatusPill, STATUS_ICON, TemplateIcon, UrgentBadge, ReasonDialog } from "../components/bits";
import { EditJobDialog } from "../components/edit-dialog";
import { FieldsView } from "../components/fields-view";
import { LineDialog } from "../components/line-dialog";
import { JOBCARDS_FEATURES, JOBCARDS_PERMISSIONS } from "../lib/access";
import { jobcardsConfig } from "../lib/config";
import { money, qty } from "../lib/format";
import { useJob, useJobActions } from "../lib/queries";
import { JOB_FLOW, type ApprovalDecision, type Job, type JobEvent, type JobLine, type JobStatus } from "../lib/types";

/** One job: status stepper, details, parts and labour, totals, timeline, bill / cancel / tracking link / print. */
export default function JobPage() {
  const { id } = useRouteParams<{ id: string }>();
  const { t } = useI18n();
  const q = useJob(id);
  if (q.isError)
    return (
      <Page>
        <InlineError title={describeError(q.error, t)} />
      </Page>
    );
  if (!q.data)
    return (
      <Page>
        <Skeleton className="h-96" />
      </Page>
    );
  return <JobScreen job={q.data} />;
}

function JobScreen({ job }: { job: Job }) {
  const { t, formatDate } = useI18n();
  const actions = useJobActions(job.id);
  const canManage = usePermission(JOBCARDS_PERMISSIONS.manage);
  const canBill = usePermission(JOBCARDS_PERMISSIONS.bill);
  const tracking = useFeature(JOBCARDS_FEATURES.tracking);
  const config = jobcardsConfig();
  const trackLink = tracking ? config.trackUrl(job.trackToken) : null;
  const [editing, setEditing] = React.useState(false);
  const [line, setLine] = React.useState<JobLine | null | undefined>(undefined);
  const [removing, setRemoving] = React.useState<JobLine | null>(null);
  const [billing, setBilling] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [deciding, setDeciding] = React.useState<ApprovalDecision | null>(null);
  const awaitingAnswer = job.status === "awaiting_approval" && !job.approval;
  const closed = job.status === "delivered" || job.status === "cancelled";
  const linesLocked = closed || !!job.invoiceId;

  const move = async (status: JobStatus) => {
    try {
      await actions.move.mutateAsync({ status });
      toast.success(t("jobcards.detail.moved", { status: t(`jobcards.status.${status}`) }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const copyLink = async () => {
    if (!trackLink) return;
    try {
      await navigator.clipboard.writeText(trackLink);
      toast.success(t("jobcards.detail.linkCopied"));
    } catch {
      toast.error(t("jobcards.detail.copyFailed"));
    }
  };

  const otherMoves = job.moves.filter((s) => !job.next.includes(s) && s !== "cancelled");

  return (
    <Page width="full">
      <PageHeading
        back={{ href: "", label: t("jobcards.nav.board") }}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            <TemplateIcon template={job.template} className="size-5" />
            {job.label}
            <JobStatusPill status={job.status} size="md" />
            {job.priority === "urgent" && <UrgentBadge />}
          </span>
        }
        description={[job.customerName, t(`jobcards.template.${job.template}`), t("jobcards.detail.takenIn", { date: formatDate(job.createdAt) })].join(" · ")}
        actions={
          <>
            {canManage && awaitingAnswer && (
              <Button onClick={() => setDeciding("approved")}>
                <ThumbsUpIcon /> {t("jobcards.approval.record")}
              </Button>
            )}
            {canManage &&
              job.next.map((s, i) => (
                <Button key={s} variant={i === 0 ? "default" : "outline"} disabled={actions.move.isPending} onClick={() => move(s)}>
                  {actions.move.isPending && actions.move.variables?.status === s ? <Loader2Icon className="animate-spin" /> : <ArrowRightIcon />}
                  {t(`jobcards.move.${s}`)}
                </Button>
              ))}
            {canBill && !job.invoiceId && job.status !== "cancelled" && (
              <Button variant={job.next.length ? "outline" : "default"} onClick={() => setBilling(true)} disabled={job.lines.length === 0}>
                <ReceiptIcon /> {t("jobcards.detail.bill")}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t("jobcards.common.more")}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canManage && otherMoves.length > 0 && (
                  <>
                    <DropdownMenuLabel>{t("jobcards.detail.moveTo")}</DropdownMenuLabel>
                    {otherMoves.map((s) => {
                      const Icon = STATUS_ICON[s];
                      return (
                        <DropdownMenuItem key={s} onSelect={() => move(s)}>
                          <Icon /> {t(`jobcards.status.${s}`)}
                        </DropdownMenuItem>
                      );
                    })}
                    <DropdownMenuSeparator />
                  </>
                )}
                {trackLink && (
                  <DropdownMenuItem onSelect={copyLink}>
                    <CopyIcon /> {t("jobcards.detail.copyLink")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => window.print()}>
                  <PrinterIcon /> {t("jobcards.detail.print")}
                </DropdownMenuItem>
                {canManage && !closed && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onSelect={() => setCancelling(true)}>
                      <BanIcon /> {t("jobcards.detail.cancel")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div data-print-hide className="grid gap-section">
        <Stepper job={job} />
        <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid h-fit gap-section">
            <ApprovalCard job={job} canManage={canManage && !closed} onRecord={setDeciding} />
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle>{t("jobcards.detail.details")}</CardTitle>
                {canManage && !closed && (
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    <PencilIcon /> {t("jobcards.common.edit")}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="grid gap-3">
                <FieldsView template={job.template} fields={job.fields} />
                {job.notes && (
                  <p className="flex gap-2 rounded-md bg-muted/50 p-3 text-sm whitespace-pre-wrap">
                    <StickyNoteIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    {job.notes}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle>{t("jobcards.lines.title")}</CardTitle>
                {canManage && !linesLocked && (
                  <Button size="sm" variant="outline" onClick={() => setLine(null)}>
                    <PlusIcon /> {t("jobcards.lines.add")}
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <LinesTable lines={job.lines} onEdit={canManage && !linesLocked ? setLine : undefined} onRemove={canManage && !linesLocked ? setRemoving : undefined} />
                {job.invoiceId && <p className="mt-3 text-meta text-muted-foreground">{t("jobcards.lines.lockedBilled")}</p>}
              </CardContent>
            </Card>

            <Timeline job={job} canNote={canManage} onNote={(n) => actions.note.mutateAsync(n)} />
          </div>

          <div className="grid h-fit gap-section lg:sticky lg:top-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("jobcards.detail.customer")}</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                <DetailRow label={t("jobcards.fields.customerName")}>{job.customerName}</DetailRow>
                {job.customerPhone && (
                  <DetailRow label={t("jobcards.fields.customerPhone")}>
                    <a href={`tel:${job.customerPhone}`} className="inline-flex items-center gap-1 hover:underline">
                      <PhoneIcon className="size-3.5" /> {job.customerPhone}
                    </a>
                  </DetailRow>
                )}
                <DetailRow label={t("jobcards.fields.dueDate")}>
                  <DueDate date={job.dueDate} overdue={job.overdue} />
                  {job.overdue && <span className="ml-1.5 text-destructive">{t("jobcards.common.overdue")}</span>}
                </DetailRow>
                <DetailRow label={t("jobcards.fields.assignee")}>{job.assigneeName ?? "—"}</DetailRow>
              </CardContent>
            </Card>
            <TotalsCard job={job} />
          </div>
        </div>
      </div>

      <JobSheet job={job} trackLink={trackLink} />

      <EditJobDialog open={editing} onOpenChange={setEditing} job={job} onSave={(b) => actions.update.mutateAsync(b)} />
      <LineDialog
        open={line !== undefined}
        onOpenChange={(o) => !o && setLine(undefined)}
        line={line ?? null}
        onSave={(b) => (line ? actions.updateLine.mutateAsync({ lineId: line.id, ...b }) : actions.addLine.mutateAsync(b))}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("jobcards.lines.removeTitle")}
        description={removing?.description}
        confirmLabel={t("jobcards.common.remove")}
        onConfirm={async () => {
          if (removing) await actions.removeLine.mutateAsync(removing.id);
          setRemoving(null);
        }}
      />
      <ConfirmDialog
        open={billing}
        onOpenChange={setBilling}
        destructive={false}
        title={t("jobcards.bill.title", { number: job.label })}
        description={t("jobcards.bill.body", { total: money(job.totals.total), advance: money(job.totals.advance), balance: money(Math.max(job.totals.balance, 0)) })}
        confirmLabel={t("jobcards.bill.confirm")}
        onConfirm={async () => {
          try {
            const r = await actions.bill.mutateAsync();
            toast.success(t("jobcards.bill.done", { number: r.bill.number ?? "" }));
            setBilling(false);
          } catch (err) {
            toast.error(describeError(err, t));
          }
        }}
      />
      <ApprovalDialog
        open={deciding !== null}
        onOpenChange={(o) => !o && setDeciding(null)}
        job={job}
        decision={deciding ?? "approved"}
        onSave={(b) => actions.approval.mutateAsync(b)}
      />
      <ReasonDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t("jobcards.detail.cancelTitle", { number: job.label })}
        description={t("jobcards.detail.cancelBody")}
        confirm={t("jobcards.detail.cancel")}
        onConfirm={(reason) => actions.cancel.mutateAsync(reason)}
      />
    </Page>
  );
}

/** Where the job is in the flow; the optional trial shows dashed until used. */
function Stepper({ job }: { job: Job }) {
  const { t } = useI18n();
  if (job.status === "cancelled")
    return (
      <Card className="flex items-center gap-2 p-3 text-sm text-destructive">
        <BanIcon className="size-4" /> {t("jobcards.detail.cancelled")}
      </Card>
    );
  const at = JOB_FLOW.indexOf(job.status);
  // Optional steps (approval, trial) the job never went through show struck through.
  const used = (s: JobStatus) => job.status === s || job.events.some((e) => e.toStatus === s);
  const OPTIONAL: JobStatus[] = ["awaiting_approval", "approved", "trial"];
  return (
    <ol className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-2" aria-label={t("jobcards.detail.progress")}>
      {JOB_FLOW.map((s, i) => {
        const done = i < at;
        const current = i === at;
        const skipped = OPTIONAL.includes(s) && !used(s) && i < at;
        return (
          <li
            key={s}
            aria-current={current ? "step" : undefined}
            className={cn(
              "flex min-w-max flex-1 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-meta",
              current && "bg-primary/10 font-semibold text-primary",
              done && !skipped && "text-foreground",
              (!done && !current) || skipped ? "text-muted-foreground" : "",
              skipped && "line-through decoration-dashed",
            )}
          >
            {done && !skipped ? <CheckIcon className="size-3.5 text-success" /> : <CircleDotIcon className={cn("size-3.5", !current && "opacity-40")} />}
            {t(`jobcards.status.${s}`)}
          </li>
        );
      })}
    </ol>
  );
}

function LinesTable({ lines, onEdit, onRemove }: { lines: JobLine[]; onEdit?: (l: JobLine) => void; onRemove?: (l: JobLine) => void }) {
  const { t } = useI18n();
  if (lines.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{t("jobcards.lines.empty")}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="border-b text-meta text-muted-foreground">
            <th className="py-2 text-left font-medium">{t("jobcards.lines.description")}</th>
            <th className="py-2 text-right font-medium">{t("jobcards.lines.qty")}</th>
            <th className="py-2 text-right font-medium">{t("jobcards.lines.rate")}</th>
            <th className="py-2 text-right font-medium">{t("jobcards.lines.gst")}</th>
            <th className="py-2 text-right font-medium">{t("jobcards.lines.amount")}</th>
            {(onEdit || onRemove) && (
              <th className="w-20">
                <span className="sr-only">{t("jobcards.common.actions")}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b last:border-0">
              <td className="py-2">
                <span className="font-medium">{l.description}</span>
                <span className="ml-2 text-meta text-muted-foreground">{t(`jobcards.lines.kinds.${l.kind}`)}</span>
                {l.serials?.length > 0 && <span className="block font-mono text-meta text-muted-foreground">{t("jobcards.lines.serialsList", { serials: l.serials.join(", ") })}</span>}
              </td>
              <td className="py-2 text-right tabular-nums">{qty(l.qty)}</td>
              <td className="py-2 text-right tabular-nums">{money(l.rate)}</td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">
                {l.gstRate}% · {money(l.tax)}
              </td>
              <td className="py-2 text-right font-medium tabular-nums">{money(l.amount)}</td>
              {(onEdit || onRemove) && (
                <td className="py-1 text-right">
                  {onEdit && (
                    <Button size="icon" variant="ghost" className="size-8" aria-label={t("jobcards.common.edit")} onClick={() => onEdit(l)}>
                      <PencilIcon />
                    </Button>
                  )}
                  {onRemove && (
                    <Button size="icon" variant="ghost" className="size-8" aria-label={t("jobcards.common.remove")} onClick={() => onRemove(l)}>
                      <Trash2Icon />
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TotalsCard({ job }: { job: Job }) {
  const { t } = useI18n();
  const x = job.totals;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("jobcards.totals.title")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1 text-sm">
        <Row label={t("jobcards.totals.parts")} value={money(x.parts)} muted />
        <Row label={t("jobcards.totals.labour")} value={money(x.labour)} muted />
        <Row label={t("jobcards.totals.amount")} value={money(x.amount)} />
        <Row label={t("jobcards.totals.gst")} value={money(x.tax)} />
        <Row label={t("jobcards.totals.total")} value={money(x.total)} strong />
        <Row label={t("jobcards.totals.advance")} value={`− ${money(x.advance)}`} muted />
        <Row label={x.balance < 0 ? t("jobcards.totals.refund") : t("jobcards.totals.balance")} value={money(Math.abs(x.balance))} strong />
        {job.invoiceId && (
          <ModuleLink href={jobcardsConfig().invoiceHref(job.invoiceId)} className="mt-3 inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
            <FilePlusIcon className="size-4" /> {t("jobcards.totals.openBill", { number: job.invoiceNumber ?? "" })}
          </ModuleLink>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-0.5 tabular-nums", strong && "border-t pt-2 text-base font-semibold", muted && "text-muted-foreground")}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function eventText(e: JobEvent, t: ReturnType<typeof useI18n>["t"]): string {
  switch (e.type) {
    case "created":
      return t("jobcards.timeline.created");
    case "status":
      return e.toStatus ? t("jobcards.timeline.status", { status: t(`jobcards.status.${e.toStatus}`) }) : "";
    case "billed":
      return t("jobcards.timeline.billed", { number: e.note ?? "" });
    case "estimate":
      return t("jobcards.timeline.estimate");
    case "note":
      return t("jobcards.timeline.note");
    case "approval":
      return t("jobcards.timeline.approval");
  }
}

function Timeline({ job, canNote, onNote }: { job: Job; canNote: boolean; onNote: (note: string) => Promise<unknown> }) {
  const { t, formatDate } = useI18n();
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const add = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await onNote(note.trim());
      setNote("");
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };
  const events = [...job.events].reverse();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("jobcards.timeline.title")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {canNote && (
          <div className="grid gap-2">
            <Textarea rows={2} maxLength={1000} value={note} placeholder={t("jobcards.timeline.notePlaceholder")} aria-label={t("jobcards.timeline.addNote")} onChange={(e) => setNote(e.target.value)} />
            <Button size="sm" variant="outline" className="justify-self-end" disabled={busy || !note.trim()} onClick={add}>
              {busy ? <Loader2Icon className="animate-spin" /> : <MessageSquarePlusIcon />} {t("jobcards.timeline.addNote")}
            </Button>
          </div>
        )}
        <ol className="grid gap-3">
          {events.map((e) => (
            <li key={e.id} className="grid grid-cols-[auto_1fr] gap-3 text-sm">
              <span className="mt-1.5 size-2 rounded-full bg-primary/60" aria-hidden />
              <div className="grid gap-0.5">
                <span className="font-medium">{eventText(e, t)}</span>
                {e.note && e.type !== "billed" && <span className="whitespace-pre-wrap text-muted-foreground">{e.note}</span>}
                <span className="text-meta text-muted-foreground">{formatDate(e.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/** The printed job sheet: shop copy with the customer's details, the work, the estimate and a signature line. */
function JobSheet({ job, trackLink }: { job: Job; trackLink: string | null }) {
  const { t, formatDate } = useI18n();
  return (
    <section data-print-area className="hidden text-sm print:block">
      <header className="mb-4 flex items-start justify-between border-b pb-3">
        <div>
          <h2 className="text-xl font-semibold">{t("jobcards.sheet.title")}</h2>
          <p>{t(`jobcards.template.${job.template}`)}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums">{job.label}</p>
          <p>{t("jobcards.detail.takenIn", { date: formatDate(job.createdAt) })}</p>
          <p>
            {t("jobcards.fields.dueDate")}: {job.dueDate ? formatDate(job.dueDate) : "—"}
          </p>
        </div>
      </header>
      <div className="avoid-break mb-4 grid grid-cols-2 gap-4">
        <div>
          <p className="font-semibold">{job.customerName}</p>
          {job.customerPhone && <p>{job.customerPhone}</p>}
        </div>
        <div className="text-right">
          <p>
            {t("jobcards.list.status")}: {t(`jobcards.status.${job.status}`)}
          </p>
          {job.assigneeName && (
            <p>
              {t("jobcards.fields.assignee")}: {job.assigneeName}
            </p>
          )}
        </div>
      </div>
      <h3 className="mb-1 font-semibold">{t("jobcards.detail.details")}</h3>
      <div className="avoid-break mb-4">
        <FieldsView template={job.template} fields={job.fields} />
        {job.notes && <p className="mt-2 whitespace-pre-wrap">{job.notes}</p>}
      </div>
      {job.lines.length > 0 && (
        <>
          <h3 className="mb-1 font-semibold">{t("jobcards.lines.title")}</h3>
          <div className="mb-4">
            <LinesTable lines={job.lines} />
          </div>
        </>
      )}
      <div className="avoid-break ml-auto grid w-64 gap-1">
        <Row label={t("jobcards.totals.amount")} value={money(job.totals.amount)} />
        <Row label={t("jobcards.totals.gst")} value={money(job.totals.tax)} />
        <Row label={t("jobcards.totals.total")} value={money(job.totals.total)} strong />
        <Row label={t("jobcards.totals.advance")} value={money(job.totals.advance)} />
        <Row label={t("jobcards.totals.balance")} value={money(job.totals.balance)} strong />
      </div>
      {trackLink && <p className="mt-4 break-all">{t("jobcards.sheet.track", { url: trackLink })}</p>}
      <div className="avoid-break mt-10 grid grid-cols-2 gap-8">
        <p className="border-t pt-1">{t("jobcards.sheet.customerSign")}</p>
        <p className="border-t pt-1 text-right">{t("jobcards.sheet.shopSign")}</p>
      </div>
      <p className="mt-4 text-meta">{t("jobcards.sheet.terms")}</p>
    </section>
  );
}
