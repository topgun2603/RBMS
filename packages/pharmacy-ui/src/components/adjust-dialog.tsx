"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
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
} from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { expiryLabel, qty as fmtQty } from "../lib/format";
import { useAdjustBatch, type AdjustBody } from "../lib/queries";
import type { Batch } from "../lib/types";
import { InlineError } from "./bits";

type Kind = "count" | "expired" | "damaged" | "return_to_supplier";

/**
 * Stock correction or write-off for one batch. "Count" sets the counted quantity; the write-offs remove a quantity
 * (expired batches default to everything left).
 */
export function AdjustDialog({ open, onOpenChange, batch }: { open: boolean; onOpenChange: (o: boolean) => void; batch: Batch }) {
  const { t } = useI18n();
  const adjust = useAdjustBatch(batch.id);
  const [kind, setKind] = React.useState<Kind>("count");
  const [qty, setQty] = React.useState("");
  const [note, setNote] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const k: Kind = batch.status === "expired" ? "expired" : "count";
    setKind(k);
    setQty(k === "expired" ? String(batch.qty) : String(batch.qty));
    setNote("");
    setSubmitted(false);
    setError(null);
  }, [open, batch]);

  const n = Number(qty);
  const qtyError =
    qty === "" || !Number.isFinite(n) || n < 0
      ? t("pharmacy.receive.qtyInvalid")
      : kind !== "count" && (n <= 0 || n > batch.qty)
        ? t("pharmacy.adjust.tooMany", { qty: fmtQty(batch.qty) })
        : null;
  const after = kind === "count" ? n : batch.qty - n;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (qtyError) return;
    const body: AdjustBody =
      kind === "count" ? { mode: "set", qty: n, reason: "adjust", note: note.trim() || null } : { mode: "remove", qty: n, reason: kind, note: note.trim() || null };
    try {
      await adjust.mutateAsync(body);
      toast.success(t("pharmacy.adjust.done", { batch: batch.batchNo }));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("pharmacy.common.close")}>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("pharmacy.adjust.title", { batch: batch.batchNo })}</DialogTitle>
            <DialogDescription>
              {t("pharmacy.adjust.body", { item: batch.itemName, expiry: expiryLabel(batch.expiry), qty: fmtQty(batch.qty) })}
            </DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <Field>
            <FieldLabel htmlFor={null}>{t("pharmacy.adjust.kind")}</FieldLabel>
            <ChipGroup
              aria-label={t("pharmacy.adjust.kind")}
              value={kind}
              onChange={(k) => {
                setKind(k);
                setQty(k === "count" || k === "expired" ? String(batch.qty) : "");
              }}
              options={(["count", "expired", "damaged", "return_to_supplier"] as const).map((k) => ({ value: k, label: t(`pharmacy.adjust.kinds.${k}`) }))}
            />
          </Field>
          <Field invalid={submitted && !!qtyError}>
            <FieldLabel>{kind === "count" ? t("pharmacy.adjust.counted") : t("pharmacy.adjust.writeOff")}</FieldLabel>
            <FieldControl>
              <Input inputMode="decimal" autoFocus value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} />
            </FieldControl>
            <FieldHint>{Number.isFinite(after) && after >= 0 ? t("pharmacy.adjust.after", { qty: fmtQty(after) }) : null}</FieldHint>
            <FieldError>{submitted ? qtyError : null}</FieldError>
          </Field>
          <Field>
            <FieldLabel>{t("pharmacy.adjust.note")}</FieldLabel>
            <FieldControl>
              <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </FieldControl>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("pharmacy.common.cancel")}
            </Button>
            <Button type="submit" variant={kind === "count" ? "default" : "destructive"} disabled={adjust.isPending}>
              {adjust.isPending && <Loader2Icon className="animate-spin" />}
              {kind === "count" ? t("pharmacy.adjust.saveCount") : t("pharmacy.adjust.writeOffCta")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
