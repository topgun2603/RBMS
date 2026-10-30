"use client";

import * as React from "react";
import { AlertTriangleIcon, CheckIcon } from "lucide-react";
import { Badge, cn, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import type { CartLine } from "../lib/cart";
import { useBatchPick } from "../lib/batches";
import { fmtExpiry, formatQty } from "../lib/format";

export { fmtExpiry };

/** Choose the batch a counter line is sold from (oldest expiry first; expired batches are marked). */
export function BatchPickDialog({
  line,
  onClose,
  onPick,
}: {
  line: CartLine | null;
  onClose: () => void;
  onPick: (key: string, batch: { id: string; no: string; expiry: string | null; qty?: number } | null) => void;
}) {
  const { t } = useI18n();
  const q = useBatchPick(line?.itemId ?? null, line?.qty ?? 1);
  const data = q.data;
  return (
    <Dialog open={!!line} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md" closeLabel={t("pos.common.close")}>
        <DialogHeader>
          <DialogTitle className="line-clamp-2 leading-snug">{line?.name}</DialogTitle>
          <DialogDescription>{t("pos.batch.body")}</DialogDescription>
        </DialogHeader>
        {q.isPending && <p className="text-sm text-muted-foreground">{t("pos.batch.loading")}</p>}
        {q.isError && <p className="text-sm text-destructive">{t("pos.batch.error")}</p>}
        {data && data.batches.length === 0 && <p className="text-sm text-muted-foreground">{t("pos.batch.none")}</p>}
        <ul className="grid gap-2">
          {data?.batches.map((b) => {
            const selected = line?.batch?.id === b.batchId;
            const expired = b.status === "expired";
            return (
              <li key={b.batchId}>
                <button
                  type="button"
                  onClick={() => {
                    if (line) onPick(line.key, { id: b.batchId, no: b.batchNo, expiry: b.expiry, qty: b.qty });
                    onClose();
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-3 py-3 text-left transition-colors hover:border-primary/50",
                    selected && "border-primary ring-2 ring-primary/20",
                    expired && "border-danger/50",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-sm font-semibold">{b.batchNo}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("pos.batch.exp")}: {fmtExpiry(b.expiry)}
                      {b.daysLeft !== null && b.daysLeft >= 0 ? ` · ${t("pos.batch.days", { days: b.daysLeft })}` : ""}
                    </span>
                    {b.suggestedDiscount && !expired ? (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-warning-ink">
                        <AlertTriangleIcon className="size-3" aria-hidden /> {t("pos.batch.suggest", { pct: b.suggestedDiscount })}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-semibold tabular-nums">{formatQty(b.qty)}</span>
                    {expired ? <Badge variant="destructive">{t(data.expiredPolicy === "block" ? "pos.batch.expiredBlocked" : "pos.batch.expired")}</Badge> : selected ? <CheckIcon className="size-4 text-primary" aria-hidden /> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
