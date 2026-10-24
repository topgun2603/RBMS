"use client";

import * as React from "react";
import { AlertTriangleIcon, CalendarClockIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { fmtDay } from "./batch-bits";
import { formatQty } from "../../lib/format";
import { usePickBatches } from "../../lib/queries-stock";
import type { PickOption } from "../../lib/types-stock";

export interface ChosenBatch {
  batchId: string;
  batchNo: string;
  expiry: string | null;
  mrp: number | null;
  suggestedDiscount: number | null;
}

const NONE = "__none";

/**
 * Batch of a sale / transfer line. Shows only for items that have batches at the current branch; the first-expiry-first-out
 * choice is filled in by itself (when the shop's rule is "oldest first") and the user can pick another batch. Expired
 * batches are marked, and refused by the server when the shop's rule is "block".
 */
export function LineBatchSelect({
  itemId,
  qty,
  value,
  onChange,
  className,
  autoPick = true,
}: {
  itemId: string | undefined;
  qty: number;
  value?: string;
  onChange: (b: ChosenBatch | null) => void;
  className?: string;
  autoPick?: boolean;
}) {
  const { t } = useI18n();
  const q = usePickBatches(itemId, qty > 0 ? qty : 1, !!itemId);
  const data = q.data;
  const first = data?.suggestion[0]?.batchId;

  // Fill the oldest-first choice once, for a line that has none yet.
  const autoDone = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!autoPick || !data || !itemId || value || autoDone.current === itemId) return;
    if (data.rule !== "fefo" || !first) return;
    const b = data.batches.find((x) => x.batchId === first);
    if (!b) return;
    autoDone.current = itemId;
    onChange(toChosen(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the answer for this item arrives
  }, [data, itemId, value]);
  React.useEffect(() => {
    autoDone.current = null;
  }, [itemId]);

  if (!itemId || !data || data.batches.length === 0) return null;
  const chosen = data.batches.find((b) => b.batchId === value);
  const expired = chosen?.status === "expired";

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <CalendarClockIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <Select
          value={value ?? NONE}
          onValueChange={(v) => {
            if (v === NONE) onChange(null);
            else {
              const b = data.batches.find((x) => x.batchId === v);
              if (b) onChange(toChosen(b));
            }
          }}
        >
          <SelectTrigger size="sm" className="w-full" aria-label={t("billing.batches.pick.label")}>
            <SelectValue placeholder={t("billing.batches.pick.choose")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("billing.batches.pick.auto")}</SelectItem>
            {data.batches.map((b) => (
              <SelectItem key={b.batchId} value={b.batchId}>
                {describe(b, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {expired && (
        <p className="mt-1 flex items-center gap-1 text-xs text-danger-ink">
          <AlertTriangleIcon className="size-3.5" aria-hidden /> {data.expiredPolicy === "block" ? t("billing.batches.pick.expiredBlocked") : t("billing.batches.pick.expiredWarn")}
        </p>
      )}
      {chosen && !expired && chosen.suggestedDiscount ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-warning-ink">
          <AlertTriangleIcon className="size-3.5" aria-hidden /> {t("billing.batches.pick.nearExpiry", { days: chosen.daysLeft ?? 0, pct: chosen.suggestedDiscount })}
        </p>
      ) : null}
      {chosen && qty > chosen.qty ? <p className="mt-1 text-xs text-muted-foreground">{t("billing.batches.pick.short", { qty: formatQty(chosen.qty) })}</p> : null}
    </div>
  );
}

const toChosen = (b: PickOption): ChosenBatch => ({ batchId: b.batchId, batchNo: b.batchNo, expiry: b.expiry, mrp: b.mrp, suggestedDiscount: b.suggestedDiscount });

function describe(b: PickOption, t: (k: string, v?: Record<string, string | number>) => string) {
  const exp = b.expiry ? `${t("billing.batches.pick.exp")} ${fmtDay(b.expiry)}` : t("billing.batches.status.none");
  return `${b.batchNo} · ${exp} · ${t("billing.batches.pick.left", { qty: formatQty(b.qty) })}${b.status === "expired" ? ` · ${t("billing.batches.status.expired")}` : ""}`;
}
