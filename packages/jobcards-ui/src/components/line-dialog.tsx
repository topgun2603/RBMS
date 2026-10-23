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
  FieldRow,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@srirealtime/ui";
import { describeError, useFeature, useI18n, usePermission } from "@srirealtime/web";
import { money, paiseToInput, rupeesToPaise } from "../lib/format";
import type { LineBody } from "../lib/queries";
import { LINE_KINDS, type JobLine, type LineKind, type ShopItem } from "../lib/types";
import { InlineError } from "./bits";
import { ItemPicker } from "./pickers";
import { SerialPicker } from "./serial-picker";

const GST_RATES = [0, 5, 12, 18, 28] as const;

/**
 * Adds or edits a part / labour line. Parts can come from stock (the item's name, rate, GST and HSN fill in) or be
 * typed; labour is always typed. Rates are before GST.
 */
export function LineDialog({
  open,
  onOpenChange,
  line,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Null = a new line. */
  line: JobLine | null;
  onSave: (body: LineBody) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [kind, setKind] = React.useState<LineKind>("part");
  const [item, setItem] = React.useState<ShopItem | null>(null);
  const [description, setDescription] = React.useState("");
  const [qty, setQty] = React.useState("1");
  const [rate, setRate] = React.useState("");
  const [gst, setGst] = React.useState("18");
  const [hsn, setHsn] = React.useState<string | null>(null);
  const [unit, setUnit] = React.useState<string | null>(null);
  const [serials, setSerials] = React.useState<string[]>([]);
  const [submitted, setSubmitted] = React.useState(false);
  // Serial numbers on parts from stock: the shop tracks serials and this member can read the serial stock.
  const serialsFeature = useFeature("serials");
  const serialsAllowed = usePermission(["serials.view", "serials.manage"]);
  const serialsOn = serialsFeature && serialsAllowed;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setKind(line?.kind ?? "part");
    setItem(null);
    setDescription(line?.description ?? "");
    setQty(line ? String(line.qty) : "1");
    setRate(line ? paiseToInput(line.rate) : "");
    setGst(String(line?.gstRate ?? 18));
    setHsn(line?.hsn ?? null);
    setUnit(line?.unit ?? null);
    setSerials(line?.serials ?? []);
    setSubmitted(false);
    setError(null);
  }, [open, line]);

  const pick = (it: ShopItem | null) => {
    setItem(it);
    setSerials([]);
    if (!it) return;
    setDescription(it.name);
    setRate(paiseToInput(it.rate));
    setGst(String(it.gstRate));
    setHsn(it.hsn);
    setUnit(it.unit);
  };

  const n = Number(qty);
  const paise = rupeesToPaise(rate);
  const errors = {
    description: !description.trim() ? t("jobcards.common.required") : null,
    qty: !Number.isFinite(n) || n <= 0 ? t("jobcards.lines.qtyInvalid") : null,
    rate: paise === null ? t("jobcards.common.amountInvalid") : null,
  };
  const itemId = kind === "part" ? (item?.id ?? (line?.kind === "part" ? line.itemId : null) ?? null) : null;
  const serialsTooMany = serials.length > Math.ceil(Number.isFinite(n) && n > 0 ? n : 1);
  const amount = paise !== null && Number.isFinite(n) ? Math.round(n * paise) : 0;
  const tax = Math.round((amount * Number(gst)) / 100);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (errors.description || errors.qty || errors.rate || serialsTooMany) return;
    setBusy(true);
    try {
      await onSave({
        kind,
        itemId,
        ...(itemId && (serials.length || line?.serials?.length) ? { serials } : {}),
        description: description.trim(),
        qty: n,
        rate: paise!,
        gstRate: Number(gst),
        hsn,
        unit,
      });
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
            <DialogTitle>{line ? t("jobcards.lines.editTitle") : t("jobcards.lines.addTitle")}</DialogTitle>
            <DialogDescription>{t("jobcards.lines.body")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <Field>
            <FieldLabel htmlFor={null}>{t("jobcards.lines.kind")}</FieldLabel>
            <ChipGroup
              aria-label={t("jobcards.lines.kind")}
              value={kind}
              onChange={(k) => {
                setKind(k);
                if (k === "labour") setItem(null);
              }}
              options={LINE_KINDS.map((k) => ({ value: k, label: t(`jobcards.lines.kinds.${k}`) }))}
            />
          </Field>
          {kind === "part" && !line && (
            <Field>
              <FieldLabel htmlFor={null}>{t("jobcards.lines.fromStock")}</FieldLabel>
              <ItemPicker value={item} onChange={pick} />
              <FieldHint>{t("jobcards.lines.fromStockHint")}</FieldHint>
            </Field>
          )}
          <Field invalid={submitted && !!errors.description}>
            <FieldLabel>{t("jobcards.lines.description")}</FieldLabel>
            <FieldControl>
              <Input maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />
            </FieldControl>
            <FieldError>{submitted ? errors.description : null}</FieldError>
          </Field>
          <FieldRow cols={3}>
            <Field invalid={submitted && !!errors.qty}>
              <FieldLabel>{t("jobcards.lines.qty")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" className="tabular-nums" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} />
              </FieldControl>
              <FieldError>{submitted ? errors.qty : null}</FieldError>
            </Field>
            <Field invalid={submitted && !!errors.rate}>
              <FieldLabel>{t("jobcards.lines.rate")}</FieldLabel>
              <InputGroup>
                <InputGroupAddon>₹</InputGroupAddon>
                <InputGroupInput inputMode="decimal" className="tabular-nums" value={rate} aria-label={t("jobcards.lines.rate")} onChange={(e) => setRate(e.target.value)} />
              </InputGroup>
              <FieldError>{submitted ? errors.rate : null}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor={null}>{t("jobcards.lines.gst")}</FieldLabel>
              <Select value={gst} onValueChange={setGst}>
                <SelectTrigger className="w-full" aria-label={t("jobcards.lines.gst")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([...GST_RATES.map(String), gst])].map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldRow>
          {serialsOn && itemId && <SerialPicker itemId={itemId} qty={Number.isFinite(n) ? n : 1} value={serials} onChange={setSerials} />}
          <p className="text-sm text-muted-foreground tabular-nums">{t("jobcards.lines.preview", { amount: money(amount), tax: money(tax), total: money(amount + tax) })}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("jobcards.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              {line ? t("jobcards.common.save") : t("jobcards.lines.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
