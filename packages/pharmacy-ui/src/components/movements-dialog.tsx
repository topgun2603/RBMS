"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Skeleton, cn } from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { expiryLabel, qty as fmtQty } from "../lib/format";
import { useMovements } from "../lib/queries";
import type { Batch } from "../lib/types";
import { InlineError } from "./bits";

/** A batch's ledger: receipts, sales (with the bill), cancellations and write-offs. */
export function MovementsDialog({ open, onOpenChange, batch }: { open: boolean; onOpenChange: (o: boolean) => void; batch: Batch | null }) {
  const { t, formatDate } = useI18n();
  const q = useMovements(open && batch ? batch.id : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("pharmacy.common.close")} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("pharmacy.movements.title", { batch: batch?.batchNo ?? "" })}</DialogTitle>
          <DialogDescription>{batch ? `${batch.itemName} · ${expiryLabel(batch.expiry)}` : null}</DialogDescription>
        </DialogHeader>
        {q.isError ? (
          <InlineError title={describeError(q.error, t)} />
        ) : q.isPending ? (
          <div className="grid gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : q.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("pharmacy.movements.empty")}</p>
        ) : (
          <ul className="grid max-h-[60vh] gap-1 overflow-auto">
            {q.data.items.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 rounded-md px-2 py-2 text-sm odd:bg-muted/40">
                <div className="min-w-0">
                  <p className="font-medium">
                    {t(`pharmacy.movements.reasons.${m.reason}`)}
                    {m.refNumber && <span className="font-normal text-muted-foreground"> · {m.refNumber}</span>}
                  </p>
                  <p className="text-meta text-muted-foreground">
                    {formatDate(m.createdAt)}
                    {m.note ? ` · ${m.note}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <p className={cn("font-semibold", m.delta < 0 ? "text-destructive" : "text-success-ink")}>
                    {m.delta > 0 ? "+" : ""}
                    {fmtQty(m.delta)}
                  </p>
                  <p className="text-meta text-muted-foreground">{t("pharmacy.movements.after", { qty: fmtQty(m.qtyAfter) })}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
