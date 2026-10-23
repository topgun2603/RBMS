"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  BadgeCheckIcon,
  BanIcon,
  CalendarIcon,
  CheckCheckIcon,
  GlassesIcon,
  HourglassIcon,
  InboxIcon,
  Loader2Icon,
  PackageCheckIcon,
  RulerIcon,
  SearchIcon,
  ShirtIcon,
  SmartphoneIcon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";
import {
  Alert,
  AlertTitle,
  Button,
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
  FieldLabel,
  Input,
  StatusPill,
  type StatusTone,
} from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import type { JobStatus, JobTemplate } from "../lib/types";

export function InlineError({ title }: { title: React.ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{title}</AlertTitle>
    </Alert>
  );
}

export const STATUS_TONE: Record<JobStatus, StatusTone> = {
  received: "neutral",
  diagnosed: "info",
  awaiting_approval: "warning",
  approved: "success",
  in_progress: "brand",
  trial: "info",
  ready: "success",
  delivered: "neutral",
  cancelled: "danger",
};

export const STATUS_ICON: Record<JobStatus, React.ComponentType<{ className?: string }>> = {
  received: InboxIcon,
  diagnosed: SearchIcon,
  awaiting_approval: HourglassIcon,
  approved: BadgeCheckIcon,
  in_progress: WrenchIcon,
  trial: RulerIcon,
  ready: PackageCheckIcon,
  delivered: CheckCheckIcon,
  cancelled: BanIcon,
};

export function JobStatusPill({ status, size }: { status: JobStatus; size?: "sm" | "md" }) {
  const { t } = useI18n();
  return (
    <StatusPill tone={STATUS_TONE[status]} icon={STATUS_ICON[status]} size={size}>
      {t(`jobcards.status.${status}`)}
    </StatusPill>
  );
}

export const TEMPLATE_ICON: Record<JobTemplate, React.ComponentType<{ className?: string }>> = {
  device: SmartphoneIcon,
  garment: ShirtIcon,
  eyewear: GlassesIcon,
  general: WrenchIcon,
};

export function TemplateIcon({ template, className }: { template: JobTemplate; className?: string }) {
  const { t } = useI18n();
  const Icon = TEMPLATE_ICON[template] ?? WrenchIcon;
  return (
    <span role="img" aria-label={t(`jobcards.template.${template}`)} title={t(`jobcards.template.${template}`)} className="inline-flex">
      <Icon className={cn("size-4 text-muted-foreground", className)} />
    </span>
  );
}

export function UrgentBadge() {
  const { t } = useI18n();
  return (
    <StatusPill tone="danger" icon={ZapIcon}>
      {t("jobcards.priority.urgent")}
    </StatusPill>
  );
}

/** The due date, red once overdue. */
export function DueDate({ date, overdue, className }: { date: string | null; overdue?: boolean; className?: string }) {
  const { t, formatDate } = useI18n();
  if (!date) return <span className={cn("text-muted-foreground", className)}>{t("jobcards.common.noDue")}</span>;
  return (
    <span className={cn("inline-flex items-center gap-1 tabular-nums", overdue ? "font-medium text-destructive" : "text-muted-foreground", className)}>
      <CalendarIcon className="size-3.5" />
      {formatDate(date)}
      {overdue && <span className="sr-only"> · {t("jobcards.common.overdue")}</span>}
    </span>
  );
}

/** Asks for a short reason (cancelling a job). */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  confirm: string;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
      setSubmitted(false);
    }
  }, [open]);
  const invalid = reason.trim().length < 2;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("jobcards.common.close")}>
        <form
          className="grid gap-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setSubmitted(true);
            if (invalid) return;
            setBusy(true);
            setError(null);
            try {
              await onConfirm(reason.trim());
              onOpenChange(false);
            } catch (err) {
              setError(describeError(err, t));
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {error && <InlineError title={error} />}
          <Field invalid={submitted && invalid}>
            <FieldLabel>{t("jobcards.common.reason")}</FieldLabel>
            <FieldControl>
              <Input autoFocus value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
            </FieldControl>
            <FieldError>{submitted && invalid ? t("jobcards.common.reasonRequired") : null}</FieldError>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("jobcards.common.back")}
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              {confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
