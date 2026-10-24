"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import { Button, ChipGroup, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, toast } from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { MoneyInput } from "../money-input";
import { ItemCombobox } from "./batch-bits";
import { cleanQty } from "./stock-meta";
import { formatQty, parseQty, rupeesToPaise } from "../../lib/format";
import { useReceiveBatch } from "../../lib/queries-stock";
import type { BatchReceiveInput } from "../../lib/types-stock";

type Mode = "receive" | "assign";

/** Receive stock into a batch (a new batch number creates it), or put stock you already have into a batch. */
export function BatchReceiveDialog({
  open,
  onOpenChange,
  item,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Start with this item chosen (from the stock page or the item form). */
  item?: { id: string; name: string; unit?: string | null } | null;
}) {
  const { t } = useI18n();
  const receive = useReceiveBatch();
  const [picked, setPicked] = React.useState<{ id: string; name: string; unit: string } | null>(null);
  const [search, setSearch] = React.useState("");
  const [mode, setMode] = React.useState<Mode>("receive");
  const [batchNo, setBatchNo] = React.useState("");
  const [mfg, setMfg] = React.useState("");
  const [expiry, setExpiry] = React.useState("");
  const [mrp, setMrp] = React.useState("");
  const [cost, setCost] = React.useState("");
  const [qty, setQty] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setPicked(item ? { id: item.id, name: item.name, unit: item.unit || "pcs" } : null);
    setSearch(item?.name ?? "");
    setMode("receive");
    setBatchNo("");
    setMfg("");
    setExpiry("");
    setMrp("");
    setCost("");
    setQty("");
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when (re)opened
  }, [open, item?.id]);

  const n = parseQty(qty);
  const mrpPaise = mrp.trim() ? rupeesToPaise(mrp) : null;
  const costPaise = cost.trim() ? rupeesToPaise(cost) : null;
  const errors = {
    item: picked ? null : t("billing.batches.receive.errItem"),
    batchNo: batchNo.trim() ? null : t("billing.batches.receive.errBatchNo"),
    qty: n === null || n <= 0 ? t("billing.validation.qty") : null,
    mrp: mrp.trim() && mrpPaise === null ? t("billing.validation.amount") : null,
    cost: cost.trim() && costPaise === null ? t("billing.validation.amount") : null,
  };
  const bad = Object.values(errors).some(Boolean);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (bad || !picked || n === null) return;
    const body: BatchReceiveInput = { itemId: picked.id, batchNo: batchNo.trim(), qty: n, mode };
    if (expiry.trim()) body.expiry = expiry.trim();
    if (mfg.trim()) body.mfgDate = mfg.trim();
    if (mrpPaise !== null) body.mrp = mrpPaise;
    if (costPaise !== null) body.cost = costPaise;
    try {
      await receive.mutateAsync(body);
      toast.success(t("billing.batches.receive.done", { qty: formatQty(n), batch: body.batchNo, name: picked.name }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const err = (key: keyof typeof errors) => (touched && errors[key] ? <p className="text-xs text-destructive">{errors[key]}</p> : null);

  return (
    <Dialog open={open} onOpenChange={(o) => !receive.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("billing.batches.receive.title")}</DialogTitle>
          <DialogDescription>{t("billing.batches.receive.subtitle")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <ChipGroup
            value={mode}
            onChange={setMode}
            aria-label={t("billing.batches.receive.modeLabel")}
            options={[
              { value: "receive", label: t("billing.batches.receive.modeReceive") },
              { value: "assign", label: t("billing.batches.receive.modeAssign") },
            ]}
          />
          <p className="-mt-2 text-xs text-muted-foreground">{mode === "receive" ? t("billing.batches.receive.modeReceiveHint") : t("billing.batches.receive.modeAssignHint")}</p>

          <div className="grid gap-1.5">
            <Label htmlFor="br-item">{t("billing.batches.receive.item")}</Label>
            <ItemCombobox
              id="br-item"
              value={search}
              invalid={touched && !!errors.item}
              autoFocus={!item}
              placeholder={t("billing.batches.receive.itemPlaceholder")}
              onValue={(v) => {
                setSearch(v);
                setPicked(null);
              }}
              onPick={(it) => {
                setPicked({ id: it.id, name: it.name, unit: it.unit || "pcs" });
                setSearch(it.name);
              }}
            />
            {err("item")}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-1.5">
              <Label htmlFor="br-no">{t("billing.batches.receive.batchNo")}</Label>
              <Input id="br-no" value={batchNo} maxLength={60} autoComplete="off" autoFocus={!!item} className="font-mono" onChange={(e) => setBatchNo(e.target.value.toUpperCase())} aria-invalid={touched && !!errors.batchNo} />
              {err("batchNo")}
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="br-qty">
                {t("billing.batches.receive.qty")} {picked ? <span className="font-normal text-muted-foreground">({picked.unit})</span> : null}
              </Label>
              <Input id="br-qty" inputMode="decimal" autoComplete="off" className="text-right tabular-nums" value={qty} placeholder="0" onChange={(e) => setQty(cleanQty(e.target.value))} aria-invalid={touched && !!errors.qty} />
              {err("qty")}
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="br-exp">
                {t("billing.batches.receive.expiry")} <span className="font-normal text-muted-foreground">({t("billing.common.optional")})</span>
              </Label>
              <Input id="br-exp" value={expiry} placeholder="03/2027" autoComplete="off" maxLength={12} onChange={(e) => setExpiry(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t("billing.batches.receive.expiryHint")}</p>
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="br-mfg">
                {t("billing.batches.receive.mfg")} <span className="font-normal text-muted-foreground">({t("billing.common.optional")})</span>
              </Label>
              <Input id="br-mfg" value={mfg} placeholder="09/2026" autoComplete="off" maxLength={12} onChange={(e) => setMfg(e.target.value)} />
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="br-mrp">
                {t("billing.batches.receive.mrp")} <span className="font-normal text-muted-foreground">({t("billing.common.optional")})</span>
              </Label>
              <MoneyInput id="br-mrp" value={mrp} onChange={(e) => setMrp(e.target.value)} aria-invalid={!!errors.mrp} />
              {err("mrp")}
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="br-cost">
                {t("billing.batches.receive.cost")} <span className="font-normal text-muted-foreground">({t("billing.common.optional")})</span>
              </Label>
              <MoneyInput id="br-cost" value={cost} onChange={(e) => setCost(e.target.value)} aria-invalid={!!errors.cost} />
              {err("cost")}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={receive.isPending}>
              {t("billing.common.cancel")}
            </Button>
            <Button type="submit" size="lg" disabled={receive.isPending}>
              {receive.isPending && <Loader2Icon className="animate-spin" />}
              {t("billing.batches.receive.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
