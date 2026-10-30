"use client";

import * as React from "react";
import { Loader2Icon, MinusIcon, PlusIcon } from "lucide-react";
import {
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
  Input,
  Textarea,
  toast,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { InlineError } from "../bits";
import { money, num } from "../../lib/format";
import { useAdjustPoints } from "../../lib/queries/loyalty";
import type { LoyaltyMember } from "../../lib/types";

/** Manual points adjustment: add or remove points with a reason (required, audited). */
export function AdjustDialog({ open, onOpenChange, member }: { open: boolean; onOpenChange: (o: boolean) => void; member: LoyaltyMember }) {
  const { t } = useI18n();
  const adjust = useAdjustPoints(member.id);
  const [dir, setDir] = React.useState<"add" | "remove">("add");
  const [points, setPoints] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setDir("add");
      setPoints("");
      setReason("");
      setSubmitted(false);
      setError(null);
    }
  }, [open]);

  const n = Number(points);
  const pointValue = member.pointsBalance > 0 ? member.pointsValue / member.pointsBalance : null;
  const signed = dir === "add" ? n : -n;
  const after = member.pointsBalance + (Number.isFinite(signed) ? signed : 0);
  const pointsError = !points
    ? t("growth.common.required")
    : !Number.isInteger(n) || n <= 0 || n > 10_000_000
      ? t("growth.loyalty.adjustPointsInvalid")
      : dir === "remove" && n > member.pointsBalance
        ? t("growth.loyalty.adjustTooMany", { balance: num(member.pointsBalance) })
        : null;
  const reasonError = reason.trim().length < 3 ? t("growth.loyalty.adjustReasonRequired") : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (pointsError || reasonError) return;
    try {
      await adjust.mutateAsync({ points: signed, reason: reason.trim() });
      toast.success(t("growth.loyalty.adjusted", { points: num(Math.abs(signed)), name: member.name ?? "" }));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("growth.common.close")}>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("growth.loyalty.adjustTitle")}</DialogTitle>
            <DialogDescription>{t("growth.loyalty.adjustBody", { balance: num(member.pointsBalance) })}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <Field>
            <FieldLabel htmlFor={null}>{t("growth.loyalty.adjustDirection")}</FieldLabel>
            <ChipGroup
              aria-label={t("growth.loyalty.adjustDirection")}
              value={dir}
              onChange={setDir}
              options={[
                { value: "add", label: <span className="inline-flex items-center gap-1"><PlusIcon className="size-3.5" /> {t("growth.loyalty.adjustAdd")}</span> },
                { value: "remove", label: <span className="inline-flex items-center gap-1"><MinusIcon className="size-3.5" /> {t("growth.loyalty.adjustRemove")}</span> },
              ]}
            />
          </Field>
          <Field invalid={submitted && !!pointsError}>
            <FieldLabel>{t("growth.loyalty.adjustPoints")}</FieldLabel>
            <FieldControl>
              <Input inputMode="numeric" autoFocus value={points} onChange={(e) => setPoints(e.target.value.replace(/\D/g, ""))} />
            </FieldControl>
            <FieldHint>
              {t("growth.loyalty.adjustAfter", { balance: num(Math.max(0, after)) })}
              {pointValue !== null && n > 0 ? ` · ${money(Math.round(n * pointValue))}` : ""}
            </FieldHint>
            <FieldError>{submitted ? pointsError : null}</FieldError>
          </Field>
          <Field invalid={submitted && !!reasonError}>
            <FieldLabel aside={<span className="tabular-nums">{reason.length}/300</span>}>{t("growth.loyalty.adjustReason")}</FieldLabel>
            <FieldControl>
              <Textarea rows={3} maxLength={300} value={reason} placeholder={t("growth.loyalty.adjustReasonPlaceholder")} onChange={(e) => setReason(e.target.value)} />
            </FieldControl>
            <FieldHint>{t("growth.loyalty.adjustReasonHint")}</FieldHint>
            <FieldError>{submitted ? reasonError : null}</FieldError>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("growth.common.cancel")}
            </Button>
            <Button type="submit" disabled={adjust.isPending}>
              {adjust.isPending && <Loader2Icon className="animate-spin" />}
              {dir === "add" ? t("growth.loyalty.adjustAddCta") : t("growth.loyalty.adjustRemoveCta")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
