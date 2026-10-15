"use client";

import * as React from "react";
import { Loader2Icon, MinusIcon, PlusIcon, SlidersHorizontalIcon } from "lucide-react";
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
  toast,
} from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { cleanQty, formatQty, parseQty } from "../lib/format";
import { useAdjustStock } from "../lib/queries";
import type { StockAdjustInput } from "../lib/types";

type Mode = StockAdjustInput["mode"];

/** Add / remove / set stock for one variant (POST /v1/inventory/stock/:itemId/adjust). */
export function StockAdjustDialog({
  open,
  onOpenChange,
  itemId,
  name,
  current,
  unit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  itemId: string | null;
  name: string;
  current: number | null;
  unit: string;
}) {
  const { t } = useI18n();
  const adjust = useAdjustStock();
  const [mode, setMode] = React.useState<Mode>("add");
  const [qty, setQty] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setMode("add");
      setQty("");
      setNote("");
      setError(null);
    }
  }, [open]);

  const n = parseQty(qty);
  const now = current ?? 0;
  const after = n === null ? null : mode === "add" ? now + n : mode === "remove" ? now - n : n;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!itemId) return;
    if (n === null || (mode !== "set" && n <= 0)) {
      setError(t("commerce.validation.qty"));
      return;
    }
    try {
      await adjust.mutateAsync({ itemId, body: { mode, qty: n, ...(note.trim() ? { note: note.trim() } : {}) } });
      toast.success(t("commerce.stock.adjusted", { name }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !adjust.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" closeLabel={t("commerce.common.close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="icon-chip size-8 text-primary">
              <SlidersHorizontalIcon className="size-4" />
            </span>
            {t("commerce.stock.adjustTitle")}
          </DialogTitle>
          <DialogDescription>
            {name} · {t("commerce.stock.current", { qty: `${formatQty(now)} ${unit}` })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <ChipGroup<Mode>
            value={mode}
            onChange={setMode}
            aria-label={t("commerce.stock.mode")}
            options={[
              { value: "add", label: <><PlusIcon className="size-3.5" /> {t("commerce.stock.add")}</> },
              { value: "remove", label: <><MinusIcon className="size-3.5" /> {t("commerce.stock.remove")}</> },
              { value: "set", label: t("commerce.stock.set") },
            ]}
          />
          <Field id="adjust-qty" invalid={!!error}>
            <FieldLabel>{mode === "set" ? t("commerce.stock.newQty") : t("commerce.stock.qty")}</FieldLabel>
            <FieldControl>
              <Input
                autoFocus
                inputMode="decimal"
                autoComplete="off"
                className="text-right text-lg tabular-nums"
                placeholder="0"
                value={qty}
                onChange={(e) => {
                  setQty(cleanQty(e.target.value));
                  setError(null);
                }}
              />
            </FieldControl>
            <FieldError>{error}</FieldError>
            {!error && after !== null && (
              <FieldHint className={after < 0 ? "text-danger-ink" : undefined}>{t("commerce.stock.after", { qty: `${formatQty(after)} ${unit}` })}</FieldHint>
            )}
          </Field>
          <Field id="adjust-note">
            <FieldLabel>{t("commerce.stock.note")}</FieldLabel>
            <FieldControl>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("commerce.stock.notePlaceholder")} />
            </FieldControl>
          </Field>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={adjust.isPending}>
              {t("commerce.common.cancel")}
            </Button>
            <Button type="submit" disabled={adjust.isPending}>
              {adjust.isPending && <Loader2Icon className="animate-spin" />}
              {t("commerce.stock.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
