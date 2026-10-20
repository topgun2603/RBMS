"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import {
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
} from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { InlineError } from "./bits";

/** Asks for a reason (at least 2 characters) before a destructive step such as cancelling a plan. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setReason("");
      setSubmitted(false);
      setError(null);
    }
  }, [open]);

  const invalid = reason.trim().length < 2;
  const submit = async (e: React.FormEvent) => {
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
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent closeLabel={t("memberships.common.close")} className="sm:max-w-sm">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {error && <InlineError title={error} />}
          <Field invalid={submitted && invalid}>
            <FieldLabel>{t("memberships.common.reason")}</FieldLabel>
            <FieldControl>
              <Input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
            </FieldControl>
            <FieldError>{submitted && invalid ? t("memberships.common.reasonRequired") : null}</FieldError>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("memberships.common.back")}
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
