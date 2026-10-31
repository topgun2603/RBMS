"use client";

import * as React from "react";
import { AlertTriangleIcon, GlobeIcon, Loader2Icon } from "lucide-react";
import {
  Alert,
  AlertTitle,
  Button,
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
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import type { AppointmentSource, AppointmentStatus } from "../lib/types";

export function InlineError({ title }: { title: React.ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{title}</AlertTitle>
    </Alert>
  );
}

export const STATUS_TONE: Record<AppointmentStatus, StatusTone> = {
  booked: "info",
  confirmed: "brand",
  arrived: "warning",
  in_service: "warning",
  completed: "success",
  cancelled: "danger",
  no_show: "neutral",
};

export function AppointmentStatusPill({ status }: { status: AppointmentStatus }) {
  const { t } = useI18n();
  return <StatusPill tone={STATUS_TONE[status]}>{t(`bookings.status.${status}`)}</StatusPill>;
}

export function SourceMark({ source }: { source: AppointmentSource }) {
  const { t } = useI18n();
  if (source !== "online") return null;
  return <GlobeIcon role="img" aria-label={t("bookings.source.online")} className="size-3.5 shrink-0 text-muted-foreground" />;
}

/** A coloured dot for a staff member (their calendar colour). */
export function StaffDot({ color, className }: { color: string | null | undefined; className?: string }) {
  return <span aria-hidden className={`inline-block size-2.5 shrink-0 rounded-full ${className ?? ""}`} style={{ backgroundColor: color ?? "var(--muted-foreground)" }} />;
}

/** Asks for a reason (cancelling an appointment); `optional` lets it go empty. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  optional,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  confirm: string;
  optional?: boolean;
  onConfirm: (reason: string | null) => Promise<unknown>;
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
  const invalid = !optional && reason.trim().length < 2;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("bookings.common.close")}>
        <form
          className="grid gap-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setSubmitted(true);
            if (invalid) return;
            setBusy(true);
            setError(null);
            try {
              await onConfirm(reason.trim() || null);
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
            <FieldLabel optional={optional ? t("bookings.common.optional") : undefined}>{t("bookings.common.reason")}</FieldLabel>
            <FieldControl>
              <Input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
            </FieldControl>
            <FieldError>{submitted && invalid ? t("bookings.common.reasonRequired") : null}</FieldError>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("bookings.common.back")}
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
