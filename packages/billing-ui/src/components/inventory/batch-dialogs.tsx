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
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Switch,
  Textarea,
  toast,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { MoneyInput } from "../money-input";
import { fmtStamp } from "./batch-bits";
import { cleanQty } from "./stock-meta";
import { formatQty, paiseToInput, parseQty, rupeesToPaise } from "../../lib/format";
import { useAdjustBatch, useBatchMovements, useBatchSettings, useSaveBatchSettings, useUpdateBatch } from "../../lib/queries-stock";
import type { Batch, BatchAdjustInput, BatchSettings, ExpiredPolicy, PickRule } from "../../lib/types-stock";

// ---------------------------------------------------------------- adjust / write off

type Mode = BatchAdjustInput["mode"];
type Reason = BatchAdjustInput["reason"];

/** Correct the count of one batch, or write off expired / damaged stock. The item's total moves with it. */
export function BatchAdjustDialog({ open, onOpenChange, batch, initialReason = "adjustment" }: { open: boolean; onOpenChange: (o: boolean) => void; batch: Batch | null; initialReason?: Reason }) {
  const { t } = useI18n();
  const adjust = useAdjustBatch();
  const [mode, setMode] = React.useState<Mode>("remove");
  const [reason, setReason] = React.useState<Reason>("adjustment");
  const [qty, setQty] = React.useState("");
  const [note, setNote] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setReason(initialReason);
    setMode(initialReason === "adjustment" ? "set" : "remove");
    setQty(initialReason !== "adjustment" && batch ? String(batch.qty) : "");
    setNote("");
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when (re)opened
  }, [open, batch?.id, initialReason]);

  const n = parseQty(qty);
  const current = batch?.qty ?? 0;
  const error = n === null ? t("billing.validation.qty") : mode !== "set" && n <= 0 ? t("billing.adjust.errors.positive") : mode === "remove" && n > current ? t("billing.batches.adjust.tooMany", { qty: formatQty(current) }) : null;
  const next = n === null ? current : mode === "add" ? current + n : mode === "remove" ? current - n : n;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!batch || error || n === null) return;
    try {
      await adjust.mutateAsync({ id: batch.id, body: { mode, qty: n, reason, ...(note.trim() ? { note: note.trim() } : {}) } });
      toast.success(t("billing.batches.adjust.done", { batch: batch.batchNo, qty: formatQty(Math.max(0, next)) }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !adjust.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.batches.adjust.title")}</DialogTitle>
          <DialogDescription>
            {batch?.itemName} · {t("billing.batches.batchLabel", { no: batch?.batchNo ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <ChipGroup
            value={mode}
            onChange={setMode}
            aria-label={t("billing.adjust.modeLabel")}
            options={[
              { value: "remove", label: t("billing.adjust.mode.remove") },
              { value: "add", label: t("billing.adjust.mode.add") },
              { value: "set", label: t("billing.adjust.mode.set") },
            ]}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="ba-reason">{t("billing.batches.adjust.reason")}</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as Reason)}>
              <SelectTrigger id="ba-reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["adjustment", "expired", "damaged"] as const).map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`billing.batches.adjust.reason.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-card-ring bg-muted/40 px-4 py-3 text-sm" aria-live="polite">
            <span>
              {t("billing.adjust.current")}: <b className="tabular-nums">{formatQty(current)}</b>
            </span>
            <span>
              {t("billing.adjust.new")}: <b className="tabular-nums">{formatQty(Math.max(0, next))}</b>
            </span>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ba-qty">{mode === "set" ? t("billing.adjust.qtySet") : t("billing.adjust.qty")}</Label>
            <Input id="ba-qty" autoFocus inputMode="decimal" autoComplete="off" className="text-right text-base tabular-nums" value={qty} placeholder="0" aria-invalid={touched && !!error} onChange={(e) => setQty(cleanQty(e.target.value))} />
            {touched && error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ba-note">
              {t("billing.adjust.note")} <span className="font-normal text-muted-foreground">({t("billing.common.optional")})</span>
            </Label>
            <Textarea id="ba-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={adjust.isPending}>
              {t("billing.common.cancel")}
            </Button>
            <Button type="submit" size="lg" disabled={adjust.isPending || !batch}>
              {adjust.isPending && <Loader2Icon className="animate-spin" />}
              {t("billing.adjust.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- edit dates, MRP, cost

export function BatchEditDialog({ open, onOpenChange, batch }: { open: boolean; onOpenChange: (o: boolean) => void; batch: Batch | null }) {
  const { t } = useI18n();
  const update = useUpdateBatch();
  const [expiry, setExpiry] = React.useState("");
  const [mfg, setMfg] = React.useState("");
  const [mrp, setMrp] = React.useState("");
  const [cost, setCost] = React.useState("");
  const [supplier, setSupplier] = React.useState("");

  React.useEffect(() => {
    if (!open || !batch) return;
    setExpiry(batch.expiry ?? "");
    setMfg(batch.mfgDate ?? "");
    setMrp(batch.mrp === null ? "" : paiseToInput(batch.mrp));
    setCost(batch.cost === null ? "" : paiseToInput(batch.cost));
    setSupplier(batch.supplierName ?? "");
  }, [open, batch]);

  const mrpPaise = mrp.trim() ? rupeesToPaise(mrp) : null;
  const costPaise = cost.trim() ? rupeesToPaise(cost) : null;
  const invalid = (mrp.trim() && mrpPaise === null) || (cost.trim() && costPaise === null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batch || invalid) return;
    try {
      await update.mutateAsync({
        id: batch.id,
        body: { expiry: expiry.trim() || null, mfgDate: mfg.trim() || null, mrp: mrpPaise, cost: costPaise, supplierName: supplier.trim() || null },
      });
      toast.success(t("billing.batches.edit.done"));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !update.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.batches.edit.title")}</DialogTitle>
          <DialogDescription>
            {batch?.itemName} · {t("billing.batches.batchLabel", { no: batch?.batchNo ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="be-exp">{t("billing.batches.receive.expiry")}</Label>
              <Input id="be-exp" value={expiry} placeholder="03/2027" onChange={(e) => setExpiry(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="be-mfg">{t("billing.batches.receive.mfg")}</Label>
              <Input id="be-mfg" value={mfg} placeholder="09/2026" onChange={(e) => setMfg(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="be-mrp">{t("billing.batches.receive.mrp")}</Label>
              <MoneyInput id="be-mrp" value={mrp} onChange={(e) => setMrp(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="be-cost">{t("billing.batches.receive.cost")}</Label>
              <MoneyInput id="be-cost" value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="be-sup">{t("billing.batches.edit.supplier")}</Label>
            <Input id="be-sup" value={supplier} maxLength={120} onChange={(e) => setSupplier(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={update.isPending}>
              {t("billing.common.cancel")}
            </Button>
            <Button type="submit" size="lg" disabled={update.isPending || !!invalid}>
              {update.isPending && <Loader2Icon className="animate-spin" />}
              {t("billing.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- history

export function BatchHistorySheet({ open, onOpenChange, batch }: { open: boolean; onOpenChange: (o: boolean) => void; batch: Batch | null }) {
  const { t } = useI18n();
  const q = useBatchMovements(open ? (batch?.id ?? null) : null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("billing.batches.history.title")}</SheetTitle>
          <SheetDescription>
            {batch?.itemName} · {t("billing.batches.batchLabel", { no: batch?.batchNo ?? "" })}
          </SheetDescription>
        </SheetHeader>
        <ul className="mt-4 grid gap-2 px-4 pb-6">
          {q.isPending && <li className="text-sm text-muted-foreground">{t("billing.common.loading")}</li>}
          {(q.data?.items ?? []).map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-3 rounded-xl border bg-card px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{t(`billing.batches.reason.${m.reason}`)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[m.refNumber, m.note, fmtStamp(m.createdAt)].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="shrink-0 text-right tabular-nums">
                <p className={m.delta < 0 ? "font-semibold text-danger-ink" : "font-semibold text-success-ink"}>
                  {m.delta > 0 ? "+" : ""}
                  {formatQty(m.delta)}
                </p>
                <p className="text-xs text-muted-foreground">{formatQty(m.qtyAfter)}</p>
              </div>
            </li>
          ))}
          {q.data && q.data.items.length === 0 && <li className="text-sm text-muted-foreground">{t("billing.batches.history.empty")}</li>}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------- the shop's rules

export function BatchSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const q = useBatchSettings(open);
  const save = useSaveBatchSettings();
  const [s, setS] = React.useState<BatchSettings | null>(null);

  React.useEffect(() => {
    if (open && q.data) setS(q.data);
  }, [open, q.data]);

  const setStep = (i: number, patch: Partial<{ days: number; pct: number }>) => setS((cur) => (cur ? { ...cur, discountLadder: cur.discountLadder.map((r, j) => (j === i ? { ...r, ...patch } : r)) } : cur));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!s) return;
    try {
      await save.mutateAsync({ ...s, discountLadder: s.discountLadder.filter((r) => r.pct > 0) });
      toast.success(t("billing.batches.settings.saved"));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("billing.batches.settings.title")}</DialogTitle>
          <DialogDescription>{t("billing.batches.settings.subtitle")}</DialogDescription>
        </DialogHeader>
        {!s ? (
          <p className="text-sm text-muted-foreground">{t("billing.common.loading")}</p>
        ) : (
          <form onSubmit={submit} className="grid gap-5" noValidate>
            <div className="flex items-start justify-between gap-4 rounded-xl border p-3">
              <div>
                <Label htmlFor="bs-all">{t("billing.batches.settings.trackAll")}</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("billing.batches.settings.trackAllHint")}</p>
              </div>
              <Switch id="bs-all" checked={s.trackAll} onCheckedChange={(v) => setS({ ...s, trackAll: v })} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("billing.batches.settings.expired")}</Label>
              <ChipGroup
                value={s.expiredPolicy}
                onChange={(v: ExpiredPolicy) => setS({ ...s, expiredPolicy: v })}
                aria-label={t("billing.batches.settings.expired")}
                options={(["block", "warn", "allow"] as const).map((v) => ({ value: v, label: t(`billing.batches.settings.expired.${v}`) }))}
              />
              <p className="text-xs text-muted-foreground">{t(`billing.batches.settings.expired.${s.expiredPolicy}Hint`)}</p>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("billing.batches.settings.pick")}</Label>
              <ChipGroup
                value={s.pickRule}
                onChange={(v: PickRule) => setS({ ...s, pickRule: v })}
                aria-label={t("billing.batches.settings.pick")}
                options={(["fefo", "manual"] as const).map((v) => ({ value: v, label: t(`billing.batches.settings.pick.${v}`) }))}
              />
              <p className="text-xs text-muted-foreground">{t(`billing.batches.settings.pick.${s.pickRule}Hint`)}</p>
            </div>
            <div className="grid gap-1.5 sm:max-w-xs">
              <Label htmlFor="bs-days">{t("billing.batches.settings.alertDays")}</Label>
              <Input id="bs-days" inputMode="numeric" className="text-right tabular-nums" value={String(s.alertDays)} onChange={(e) => setS({ ...s, alertDays: Math.min(365, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)) })} />
              <p className="text-xs text-muted-foreground">{t("billing.batches.settings.alertDaysHint")}</p>
            </div>
            <div className="grid gap-2">
              <Label>{t("billing.batches.settings.ladder")}</Label>
              <p className="-mt-1 text-xs text-muted-foreground">{t("billing.batches.settings.ladderHint")}</p>
              {s.discountLadder.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{t("billing.batches.settings.within")}</span>
                  <Input aria-label={t("billing.batches.settings.days")} inputMode="numeric" className="w-20 text-right tabular-nums" value={String(r.days)} onChange={(e) => setStep(i, { days: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
                  <span className="text-muted-foreground">{t("billing.batches.settings.daysSuggest")}</span>
                  <Input aria-label={t("billing.batches.settings.pct")} inputMode="numeric" className="w-16 text-right tabular-nums" value={String(r.pct)} onChange={(e) => setStep(i, { pct: Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0) })} />
                  <span className="text-muted-foreground">%</span>
                </div>
              ))}
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={save.isPending}>
                {t("billing.common.cancel")}
              </Button>
              <Button type="submit" size="lg" disabled={save.isPending}>
                {save.isPending && <Loader2Icon className="animate-spin" />}
                {t("billing.common.save")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
