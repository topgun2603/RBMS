"use client";

import { Input, Label } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { useItemTracking } from "../../lib/queries-stock";

export interface GrnBatchInput {
  no: string;
  expiry: string;
}

/** Goods receipt: for items that use batches, the batch number and expiry printed on the supplier's challan. */
export function GrnBatchFields({ itemId, value, onChange, disabled }: { itemId: string | undefined; value: GrnBatchInput; onChange: (v: GrnBatchInput) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const tracked = useItemTracking(itemId, !!itemId);
  if (!itemId || tracked.data !== true) return null;
  return (
    <div className="col-span-2 grid grid-cols-2 gap-3">
      <div className="grid gap-1">
        <Label className="text-xs text-muted-foreground">{t("billing.batches.receive.batchNo")}</Label>
        <Input size="sm" className="font-mono" maxLength={60} disabled={disabled} value={value.no} onChange={(e) => onChange({ ...value, no: e.target.value.toUpperCase() })} />
      </div>
      <div className="grid gap-1">
        <Label className="text-xs text-muted-foreground">{t("billing.batches.receive.expiry")}</Label>
        <Input size="sm" placeholder="03/2027" maxLength={12} disabled={disabled} value={value.expiry} onChange={(e) => onChange({ ...value, expiry: e.target.value })} />
      </div>
    </div>
  );
}
