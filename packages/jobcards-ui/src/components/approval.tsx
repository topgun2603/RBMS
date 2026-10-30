"use client";

import * as React from "react";
import { BadgeCheckIcon, HourglassIcon, Loader2Icon, ThumbsDownIcon, ThumbsUpIcon, TriangleAlertIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { money } from "../lib/format";
import type { ApprovalBody } from "../lib/queries";
import { APPROVAL_CHANNELS, type ApprovalDecision, type Job } from "../lib/types";
import { InlineError } from "./bits";

/** "2026-10-22T15:30" in the browser's time zone, for a datetime-local input. */
const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * The customer's answer to the estimate on the job page: waiting (with buttons to record an approval or a decline the
 * shop was told about), approved or declined (who, how, when, the amount — and a warning when the estimate changed).
 */
export function ApprovalCard({ job, canManage, onRecord }: { job: Job; canManage: boolean; onRecord: (d: ApprovalDecision) => void }) {
  const { t, formatDate } = useI18n();
  const a = job.approval;
  const waiting = job.status === "awaiting_approval" && !a;
  if (!waiting && !a) return null;
  const when = (iso: string) => formatDate(iso, { dateStyle: "medium", timeStyle: "short" });
  const changed = a && a.decision === "approved" && a.amount !== job.totals.total && !job.invoiceId;
  return (
    <Card className={cn(waiting && "border-warning/50 bg-warning/5", a?.decision === "declined" && "border-destructive/40 bg-destructive/5")}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {waiting ? (
            <HourglassIcon className="size-4 text-warning" />
          ) : a?.decision === "approved" ? (
            <BadgeCheckIcon className="size-4 text-success" />
          ) : (
            <ThumbsDownIcon className="size-4 text-destructive" />
          )}
          {t("jobcards.approval.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {waiting ? (
          <>
            <p>{t("jobcards.approval.waiting", { total: money(job.totals.total) })}</p>
            {job.approvalRequestedAt && <p className="text-meta text-muted-foreground">{t("jobcards.approval.askedOn", { date: when(job.approvalRequestedAt) })}</p>}
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onRecord("approved")}>
                  <ThumbsUpIcon /> {t("jobcards.approval.approve")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => onRecord("declined")}>
                  <ThumbsDownIcon /> {t("jobcards.approval.decline")}
                </Button>
              </div>
            )}
          </>
        ) : a ? (
          <>
            <p className="font-medium">{t(a.decision === "approved" ? "jobcards.approval.approvedBy" : "jobcards.approval.declinedBy", { by: a.by })}</p>
            <p className="text-muted-foreground">
              {t("jobcards.approval.meta", { channel: t(`jobcards.approval.channels.${a.channel}`), date: when(a.at), amount: money(a.amount) })}
            </p>
            {a.note && <p className="whitespace-pre-wrap text-muted-foreground">{a.note}</p>}
            {a.decision === "declined" && <p className="text-meta">{t("jobcards.approval.declinedHint")}</p>}
            {changed && (
              <p className="flex gap-2 rounded-md bg-warning/10 p-2 text-meta">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                {t("jobcards.approval.changed", { total: money(job.totals.total) })}
              </p>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Records an approval / decline the customer gave at the counter, on a call, on WhatsApp… */
export function ApprovalDialog({
  open,
  onOpenChange,
  job,
  decision,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  job: Job;
  decision: ApprovalDecision;
  onSave: (b: ApprovalBody) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [by, setBy] = React.useState("");
  const [channel, setChannel] = React.useState<(typeof APPROVAL_CHANNELS)[number]>("phone");
  const [at, setAt] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setBy(job.customerName);
    setChannel("phone");
    setAt(localInput(new Date()));
    setNote("");
    setError(null);
  }, [open, job.customerName]);

  const when = at ? new Date(at) : null;
  const atInvalid = !when || Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 5 * 60_000;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (atInvalid) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ decision, by: by.trim() || null, channel, at: when!.toISOString(), note: note.trim() || null });
      toast.success(t(decision === "approved" ? "jobcards.approval.approvedDone" : "jobcards.approval.declinedDone"));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("jobcards.common.close")}>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t(decision === "approved" ? "jobcards.approval.approveTitle" : "jobcards.approval.declineTitle", { number: job.label })}</DialogTitle>
            <DialogDescription>{t("jobcards.approval.dialogBody", { total: money(job.totals.total) })}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <Field>
            <FieldLabel>{t("jobcards.approval.by")}</FieldLabel>
            <FieldControl>
              <Input maxLength={120} value={by} onChange={(e) => setBy(e.target.value)} />
            </FieldControl>
            <FieldHint>{t("jobcards.approval.byHint")}</FieldHint>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={null}>{t("jobcards.approval.channel")}</FieldLabel>
              <Select value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
                <SelectTrigger className="w-full" aria-label={t("jobcards.approval.channel")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APPROVAL_CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`jobcards.approval.channels.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field invalid={atInvalid}>
              <FieldLabel>{t("jobcards.approval.at")}</FieldLabel>
              <FieldControl>
                <Input type="datetime-local" value={at} max={localInput(new Date())} onChange={(e) => setAt(e.target.value)} />
              </FieldControl>
              <FieldError>{atInvalid ? t("jobcards.approval.atInvalid") : null}</FieldError>
            </Field>
          </div>
          <Field>
            <FieldLabel>{t("jobcards.approval.note")}</FieldLabel>
            <FieldControl>
              <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </FieldControl>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("jobcards.common.cancel")}
            </Button>
            <Button type="submit" variant={decision === "approved" ? "default" : "destructive"} disabled={busy || atInvalid}>
              {busy && <Loader2Icon className="animate-spin" />}
              {t(decision === "approved" ? "jobcards.approval.confirmApprove" : "jobcards.approval.confirmDecline")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
