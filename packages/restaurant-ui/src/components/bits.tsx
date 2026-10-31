"use client";

import * as React from "react";
import { AlertTriangleIcon, Loader2Icon } from "lucide-react";
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
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import type { KotStatus } from "../lib/types";

export function InlineError({ title }: { title: React.ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{title}</AlertTitle>
    </Alert>
  );
}

const KOT_TONE: Record<KotStatus, StatusTone> = { new: "info", preparing: "warning", ready: "success", served: "neutral", cancelled: "danger" };

export function KotPill({ status, number }: { status: KotStatus; number?: number }) {
  const { t } = useI18n();
  return (
    <StatusPill tone={KOT_TONE[status]}>
      {number !== undefined ? `KOT ${number} · ` : ""}
      {t(`restaurant.kot.${status}`)}
    </StatusPill>
  );
}

/** Green square-in-square (veg) / red (non-veg), as printed on Indian menus. */
export function VegMark({ veg, className }: { veg: boolean | null | undefined; className?: string }) {
  const { t } = useI18n();
  if (veg === null || veg === undefined) return null;
  return (
    <span
      role="img"
      aria-label={veg ? t("restaurant.menu.veg") : t("restaurant.menu.nonVeg")}
      className={cn("inline-grid size-3.5 shrink-0 place-items-center rounded-[3px] border-[1.5px]", veg ? "border-success" : "border-destructive", className)}
    >
      <span className={cn("size-1.5 rounded-full", veg ? "bg-success" : "bg-destructive")} />
    </span>
  );
}

/** Asks for a short reason (cancelling a sent item or an order). */
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
      <DialogContent closeLabel={t("restaurant.common.close")}>
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
            <FieldLabel>{t("restaurant.common.reason")}</FieldLabel>
            <FieldControl>
              <Input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
            </FieldControl>
            <FieldError>{submitted && invalid ? t("restaurant.common.reasonRequired") : null}</FieldError>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("restaurant.common.back")}
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
