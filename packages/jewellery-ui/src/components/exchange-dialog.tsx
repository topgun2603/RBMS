"use client";

import * as React from "react";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { decimalInput, grams, money, parseDecimal } from "../lib/format";
import { buybackRate, METAL_PURITIES, oldGoldValue, rateOf, type Metal, type Purity } from "../lib/pricing";
import { useCreateExchange, useJewellerySettings, useRates } from "../lib/queries";
import type { Exchange } from "../lib/types";
import { InlineError, useMetalLabel } from "./bits";

interface LineState {
  key: number;
  description: string;
  kind: string; // "gold:22K"
  gross: string;
  deduction: string;
}

let nextKey = 1;
const newLine = (): LineState => ({ key: nextKey++, description: "", kind: "gold:22K", gross: "", deduction: "" });
const splitKind = (k: string) => k.split(":") as [Metal, Purity];

/** Buy old gold / silver: customer, then lines of weight, purity and deduction, valued live at today's buying rate. */
export function ExchangeDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (x: Exchange) => void }) {
  const { t } = useI18n();
  const metalLabel = useMetalLabel();
  const create = useCreateExchange();
  const rates = useRates();
  const settings = useJewellerySettings();
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [note, setNote] = React.useState("");
  const [lines, setLines] = React.useState<LineState[]>([newLine()]);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setPhone("");
    setNote("");
    setLines([newLine()]);
    setSubmitted(false);
    setError(null);
  }, [open]);

  const buyback = settings.data?.buybackPct ?? 0;
  const valued = lines.map((l) => {
    const [metal, purity] = splitKind(l.kind);
    const g = parseDecimal(l.gross, 3);
    const d = l.deduction.trim() ? parseDecimal(l.deduction, 2) : 0;
    const sale = rates.data ? rateOf(rates.data.effective, metal, purity) : null;
    const rate = sale === null ? null : buybackRate(sale, buyback);
    const v = rate !== null && g !== null && g > 0 && d !== null && d <= 100 ? oldGoldValue({ grossWeight: g, deductionPct: d }, rate) : null;
    return {
      ...l,
      metal,
      purity,
      g,
      d,
      rate,
      v,
      errors: {
        gross: g === null || g <= 0 || g > 100_000 ? t("jewellery.piece.weightInvalid") : null,
        deduction: d === null || d > 100 ? t("jewellery.piece.pctInvalid") : null,
        rate: rate === null && !rates.isPending ? t("jewellery.piece.noRate", { metal: metalLabel(metal, purity) }) : null,
      },
    };
  });
  const total = valued.reduce((s, l) => s + (l.v?.value ?? 0), 0);
  const nameError = !name.trim() ? t("jewellery.common.required") : null;
  const invalid = !!nameError || valued.some((l) => Object.values(l.errors).some(Boolean));

  const patch = (key: number, p: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (invalid) return;
    try {
      const x = await create.mutateAsync({
        customer: { name: name.trim(), phone: phone.trim() || null },
        lines: valued.map((l) => ({ description: l.description.trim() || undefined, metal: l.metal, purity: l.purity, grossWeight: l.g!, deductionPct: l.d! })),
        note: note.trim() || null,
      });
      toast.success(t("jewellery.exchange.created", { code: x.code, amount: money(x.total) }));
      onOpenChange(false);
      onCreated?.(x);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("jewellery.common.close")} className="sm:max-w-3xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("jewellery.exchange.newTitle")}</DialogTitle>
            <DialogDescription>{buyback > 0 ? t("jewellery.exchange.newBodyBuyback", { pct: buyback }) : t("jewellery.exchange.newBody")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field invalid={submitted && !!nameError}>
              <FieldLabel>{t("jewellery.exchange.customer")}</FieldLabel>
              <FieldControl>
                <Input value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} />
              </FieldControl>
              <FieldError>{submitted ? nameError : null}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("jewellery.exchange.phone")}</FieldLabel>
              <FieldControl>
                <Input inputMode="tel" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} />
              </FieldControl>
            </Field>
          </div>
          <div className="grid gap-3">
            {valued.map((l, i) => (
              <div key={l.key} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1.4fr_1fr_0.8fr_0.8fr_auto] sm:items-end">
                <Field>
                  <FieldLabel>{t("jewellery.exchange.description")}</FieldLabel>
                  <FieldControl>
                    <Input value={l.description} maxLength={120} placeholder={t("jewellery.exchange.descriptionPlaceholder")} onChange={(e) => patch(l.key, { description: e.target.value })} />
                  </FieldControl>
                </Field>
                <Field invalid={submitted && !!l.errors.rate}>
                  <FieldLabel>{t("jewellery.piece.purity")}</FieldLabel>
                  <Select value={l.kind} onValueChange={(v) => patch(l.key, { kind: v })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METAL_PURITIES.map((mp) => (
                        <SelectItem key={`${mp.metal}:${mp.purity}`} value={`${mp.metal}:${mp.purity}`}>
                          {metalLabel(mp.metal, mp.purity)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field invalid={submitted && !!l.errors.gross}>
                  <FieldLabel>{t("jewellery.piece.gross")}</FieldLabel>
                  <FieldControl>
                    <Input inputMode="decimal" value={l.gross} placeholder="g" onChange={(e) => patch(l.key, { gross: decimalInput(e.target.value) })} />
                  </FieldControl>
                </Field>
                <Field invalid={submitted && !!l.errors.deduction}>
                  <FieldLabel>{t("jewellery.exchange.deduction")}</FieldLabel>
                  <FieldControl>
                    <Input inputMode="decimal" value={l.deduction} placeholder="%" onChange={(e) => patch(l.key, { deduction: decimalInput(e.target.value) })} />
                  </FieldControl>
                </Field>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t("jewellery.exchange.removeLine")}
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                >
                  <Trash2Icon />
                </Button>
                <p className="text-meta text-muted-foreground sm:col-span-5">
                  {l.v && l.rate !== null
                    ? t("jewellery.exchange.lineValue", { n: i + 1, net: grams(l.v.netWeight), rate: money(l.rate), value: money(l.v.value) })
                    : submitted
                      ? (l.errors.rate ?? l.errors.gross ?? l.errors.deduction)
                      : l.errors.rate}
                </p>
              </div>
            ))}
            <Button type="button" variant="outline" className="justify-self-start" onClick={() => setLines((ls) => [...ls, newLine()])} disabled={lines.length >= 30}>
              <PlusIcon /> {t("jewellery.exchange.addLine")}
            </Button>
          </div>
          <Field>
            <FieldLabel>{t("jewellery.exchange.note")}</FieldLabel>
            <FieldControl>
              <Textarea value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} />
            </FieldControl>
          </Field>
          <div className="flex items-baseline justify-between rounded-md bg-muted/40 px-4 py-3">
            <span className="text-sm font-medium">{t("jewellery.exchange.total")}</span>
            <span className="text-lg font-semibold tabular-nums">{money(total)}</span>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("jewellery.common.cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2Icon className="animate-spin" />}
              {t("jewellery.exchange.createCta")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
