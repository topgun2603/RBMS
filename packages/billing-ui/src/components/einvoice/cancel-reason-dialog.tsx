"use client";

import * as React from "react";
import { describeError, useI18n } from "@rbms/web";
import { AlertTriangleIcon, Loader2Icon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AnimatePresence,
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
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@rbms/ui";
import { CANCEL_REASON_CODES, MAX_CANCEL_REMARK, type CancelReasonCode } from "../../lib/einvoice";

/** Reason (NIC code 1–4) + remark, for cancelling an IRN or an e-way bill. */
export function CancelReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  reasons,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  /** Code → message key suffix under billing.einvoice.reasons.* (IRN and e-way bill codes differ). */
  reasons: Record<CancelReasonCode, string>;
  onConfirm: (reason: CancelReasonCode, remark: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [reason, setReason] = React.useState<CancelReasonCode | null>(null);
  const [remark, setRemark] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setReason(null);
    setRemark("");
    setError(null);
    setTouched(false);
  }, [open]);

  const submit = async () => {
    setTouched(true);
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason, remark.trim());
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <Field invalid={touched && !reason}>
            <FieldLabel>{t("billing.einvoice.cancel.reason")}</FieldLabel>
            <Select value={reason ? String(reason) : ""} onValueChange={(v) => setReason(Number(v) as CancelReasonCode)}>
              <FieldControl>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("billing.einvoice.cancel.reason")} />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {CANCEL_REASON_CODES.map((c) => (
                  <SelectItem key={c} value={String(c)}>
                    {t(`billing.einvoice.reasons.${reasons[c]}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError>{touched && !reason ? t("billing.validation.required") : null}</FieldError>
          </Field>
          <Field>
            <FieldLabel
              optional={t("billing.common.optional")}
              aside={<span className="tabular-nums">{t("billing.einvoice.cancel.remarkCount", { count: remark.length, max: MAX_CANCEL_REMARK })}</span>}
            >
              {t("billing.einvoice.cancel.remark")}
            </FieldLabel>
            <FieldControl>
              <Textarea rows={2} maxLength={MAX_CANCEL_REMARK} value={remark} onChange={(e) => setRemark(e.target.value)} />
            </FieldControl>
          </Field>
          <AnimatePresence initial={false}>
            {error && (
              <motion.div key="err" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <Alert variant="destructive">
                  <AlertTriangleIcon />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("billing.einvoice.cancel.keep")}
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2Icon className="animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
