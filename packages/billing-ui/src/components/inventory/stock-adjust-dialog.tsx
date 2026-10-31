"use client";

import * as React from "react";
import { AlertTriangleIcon, ArrowRightIcon, Loader2Icon, MinusIcon, PlusIcon, EqualIcon } from "lucide-react";
import {
  AnimatedNumber,
  Button,
  ChipGroup,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
  toast,
} from "@rbms/ui";
import { MoneyInput } from "../money-input";
import { cleanQty, round3 } from "./stock-meta";
import { formatQty, parseQty, rupeesToPaise } from "../../lib/format";
import { describeError, useI18n } from "@rbms/web";
import { useAdjustStock } from "../../lib/queries-v2";
import type { StockAdjustInput, StockRow } from "../../lib/types";

type Mode = StockAdjustInput["mode"];

/** Add / remove / set stock for one item, with a live "current → new" preview. */
export function StockAdjustDialog({
  open,
  onOpenChange,
  row,
  initialMode = "add",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: StockRow | null;
  initialMode?: Mode;
}) {
  const { t } = useI18n();
  const adjust = useAdjustStock();
  const [mode, setMode] = React.useState<Mode>(initialMode);
  const [qty, setQty] = React.useState("");
  const [cost, setCost] = React.useState("");
  const [note, setNote] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setQty("");
    setCost("");
    setNote("");
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when (re)opened
  }, [open, row?.itemId]);

  const current = row?.qty ?? 0;
  const n = parseQty(qty);
  const qtyError =
    n === null ? t("billing.validation.qty") : mode !== "set" && n <= 0 ? t("billing.adjust.errors.positive") : null;
  const costPaise = cost.trim() ? rupeesToPaise(cost) : null;
  const costError = mode === "add" && cost.trim() && costPaise === null ? t("billing.validation.amount") : null;
  const next = n === null ? current : round3(mode === "add" ? current + n : mode === "remove" ? current - n : n);
  const unit = row?.unit || "pcs";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!row || qtyError || costError || n === null) return;
    const body: StockAdjustInput = { mode, qty: n };
    if (note.trim()) body.note = note.trim();
    if (mode === "add" && costPaise !== null) body.unitCost = costPaise;
    try {
      const res = await adjust.mutateAsync({ itemId: row.itemId, body });
      toast.success(t("billing.adjust.done", { name: row.name, qty: formatQty(typeof res?.qty === "number" ? res.qty : next), unit }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const modes: { value: Mode; label: React.ReactNode }[] = [
    { value: "add", label: <><PlusIcon className="size-3.5" aria-hidden /> {t("billing.adjust.mode.add")}</> },
    { value: "remove", label: <><MinusIcon className="size-3.5" aria-hidden /> {t("billing.adjust.mode.remove")}</> },
    { value: "set", label: <><EqualIcon className="size-3.5" aria-hidden /> {t("billing.adjust.mode.set")}</> },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !adjust.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.adjust.title")}</DialogTitle>
          <DialogDescription>{row?.name}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <ChipGroup value={mode} onChange={setMode} options={modes} aria-label={t("billing.adjust.modeLabel")} />

          {/* Live preview */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-card-ring bg-muted/40 px-4 py-3" aria-live="polite">
            <div className="min-w-0">
              <p className="text-meta text-muted-foreground">{t("billing.adjust.current")}</p>
              <p className="font-heading text-lg font-semibold tabular-nums">
                {formatQty(current)} <span className="text-xs font-normal text-muted-foreground">{unit}</span>
              </p>
            </div>
            <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 text-right">
              <p className="text-meta text-muted-foreground">{t("billing.adjust.new")}</p>
              <p className={cn("font-heading text-lg font-bold tabular-nums", next < 0 ? "text-danger-ink" : "text-primary")}>
                <AnimatedNumber value={next} format={(v) => formatQty(round3(v))} duration={0.35} />{" "}
                <span className="text-xs font-normal text-muted-foreground">{unit}</span>
              </p>
            </div>
          </div>
          {next < 0 && (
            <p className="flex items-center gap-1.5 text-xs text-warning-ink">
              <AlertTriangleIcon className="size-3.5" aria-hidden /> {t("billing.adjust.negative")}
            </p>
          )}

          <div className={cn("grid items-start gap-4", mode === "add" && "sm:grid-cols-2")}>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="adj-qty">{mode === "set" ? t("billing.adjust.qtySet") : t("billing.adjust.qty")}</Label>
              <Input
                id="adj-qty"
                autoFocus
                inputMode="decimal"
                autoComplete="off"
                className="text-right text-base tabular-nums"
                value={qty}
                placeholder="0"
                aria-invalid={touched && !!qtyError}
                aria-describedby={touched && qtyError ? "adj-qty-err" : undefined}
                onChange={(e) => setQty(cleanQty(e.target.value))}
              />
              {touched && qtyError && (
                <p id="adj-qty-err" className="text-xs text-destructive">
                  {qtyError}
                </p>
              )}
            </div>
            {mode === "add" && (
              <div className="grid content-start gap-1.5">
                <Label htmlFor="adj-cost">
                  {t("billing.adjust.unitCost")} <span className="font-normal text-muted-foreground">({t("billing.common.optional")})</span>
                </Label>
                <MoneyInput id="adj-cost" value={cost} aria-invalid={!!costError} aria-describedby="adj-cost-hint" onChange={(e) => setCost(e.target.value)} />
                {costError ? (
                  <p id="adj-cost-hint" className="text-xs text-destructive">{costError}</p>
                ) : (
                  <p id="adj-cost-hint" className="text-xs text-muted-foreground">{t("billing.adjust.unitCostHint")}</p>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="adj-note">
              {t("billing.adjust.note")} <span className="font-normal text-muted-foreground">({t("billing.common.optional")})</span>
            </Label>
            <Textarea
              id="adj-note"
              rows={2}
              maxLength={300}
              placeholder={t("billing.adjust.notePlaceholder")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={adjust.isPending}>
              {t("billing.common.cancel")}
            </Button>
            <Button type="submit" size="lg" disabled={adjust.isPending || !row}>
              {adjust.isPending && <Loader2Icon className="animate-spin" />}
              {t("billing.adjust.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
