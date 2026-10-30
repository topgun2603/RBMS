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
  FieldHint,
  FieldLabel,
  Input,
  toast,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { monthFromNow, qty as fmtQty, rupeesToPaise } from "../lib/format";
import { useReceiveBatch } from "../lib/queries";
import type { ShopItem } from "../lib/types";
import { InlineError } from "./bits";
import { ItemPicker } from "./pickers";

/** Receive stock into a batch: item, batch number, expiry month, MRP, purchase rate, quantity, distributor. */
export function ReceiveDialog({ open, onOpenChange, item: initialItem }: { open: boolean; onOpenChange: (o: boolean) => void; item?: ShopItem | null }) {
  const { t } = useI18n();
  const receive = useReceiveBatch();
  const [item, setItem] = React.useState<ShopItem | null>(null);
  const [batchNo, setBatchNo] = React.useState("");
  const [expiry, setExpiry] = React.useState("");
  const [mrp, setMrp] = React.useState("");
  const [rate, setRate] = React.useState("");
  const [qty, setQty] = React.useState("");
  const [supplier, setSupplier] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setItem(initialItem ?? null);
    setBatchNo("");
    setExpiry(monthFromNow(18));
    setMrp(initialItem ? String(initialItem.rate / 100) : "");
    setRate("");
    setQty("");
    setSupplier("");
    setSubmitted(false);
    setError(null);
  }, [open, initialItem]);

  const n = Number(qty);
  const mrpPaise = mrp ? rupeesToPaise(mrp) : null;
  const ratePaise = rate ? rupeesToPaise(rate) : null;
  const errors = {
    item: !item ? t("pharmacy.common.required") : null,
    batchNo: !batchNo.trim() ? t("pharmacy.common.required") : null,
    expiry: !/^\d{4}-\d{2}$/.test(expiry) ? t("pharmacy.receive.expiryInvalid") : null,
    qty: !qty || !(n > 0) || n > 10_000_000 ? t("pharmacy.receive.qtyInvalid") : null,
    mrp: mrp && mrpPaise === null ? t("pharmacy.common.amountInvalid") : null,
    rate: rate && ratePaise === null ? t("pharmacy.common.amountInvalid") : null,
  };
  const past = /^\d{4}-\d{2}$/.test(expiry) && expiry < monthFromNow(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (Object.values(errors).some(Boolean) || !item) return;
    try {
      const b = await receive.mutateAsync({
        itemId: item.id,
        itemName: item.name,
        batchNo: batchNo.trim(),
        expiry,
        mrp: mrpPaise,
        purchaseRate: ratePaise,
        qty: n,
        supplier: supplier.trim() || null,
      });
      toast.success(t("pharmacy.receive.done", { qty: fmtQty(n), batch: b.batchNo, item: b.itemName }));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  const err = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("pharmacy.common.close")} className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("pharmacy.receive.title")}</DialogTitle>
            <DialogDescription>{t("pharmacy.receive.body")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <Field invalid={!!err("item")}>
            <FieldLabel>{t("pharmacy.receive.item")}</FieldLabel>
            <ItemPicker value={item} onChange={(i) => { setItem(i); if (i && !mrp) setMrp(String(i.rate / 100)); }} invalid={!!err("item")} autoFocus={!initialItem} />
            <FieldError>{err("item")}</FieldError>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field invalid={!!err("batchNo")}>
              <FieldLabel>{t("pharmacy.receive.batchNo")}</FieldLabel>
              <FieldControl>
                <Input value={batchNo} maxLength={40} autoCapitalize="characters" onChange={(e) => setBatchNo(e.target.value.toUpperCase())} />
              </FieldControl>
              <FieldError>{err("batchNo")}</FieldError>
            </Field>
            <Field invalid={!!err("expiry")}>
              <FieldLabel>{t("pharmacy.receive.expiry")}</FieldLabel>
              <FieldControl>
                <Input type="month" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
              </FieldControl>
              {past && !err("expiry") && <FieldHint className="text-destructive">{t("pharmacy.receive.expiryPast")}</FieldHint>}
              <FieldError>{err("expiry")}</FieldError>
            </Field>
            <Field invalid={!!err("qty")}>
              <FieldLabel>{t("pharmacy.receive.qty")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} />
              </FieldControl>
              <FieldHint>{item ? t("pharmacy.receive.qtyHint", { unit: item.unit }) : null}</FieldHint>
              <FieldError>{err("qty")}</FieldError>
            </Field>
            <Field invalid={!!err("mrp")}>
              <FieldLabel>{t("pharmacy.receive.mrp")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={mrp} placeholder="₹" onChange={(e) => setMrp(e.target.value)} />
              </FieldControl>
              <FieldError>{err("mrp")}</FieldError>
            </Field>
            <Field invalid={!!err("rate")}>
              <FieldLabel>{t("pharmacy.receive.rate")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={rate} placeholder="₹" onChange={(e) => setRate(e.target.value)} />
              </FieldControl>
              <FieldHint>{t("pharmacy.receive.rateHint")}</FieldHint>
              <FieldError>{err("rate")}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("pharmacy.receive.supplier")}</FieldLabel>
              <FieldControl>
                <Input value={supplier} maxLength={200} onChange={(e) => setSupplier(e.target.value)} />
              </FieldControl>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("pharmacy.common.cancel")}
            </Button>
            <Button type="submit" disabled={receive.isPending}>
              {receive.isPending && <Loader2Icon className="animate-spin" />}
              {t("pharmacy.receive.cta")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
