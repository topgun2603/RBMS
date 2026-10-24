"use client";

import * as React from "react";
import { DownloadIcon, Loader2Icon, ReceiptTextIcon, RefreshCwIcon, RotateCcwIcon, XCircleIcon } from "lucide-react";
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, EmptyState, toast } from "@srirealtime/ui";
import { ConfirmDialog, useI18n } from "@srirealtime/web";
import { money, timeShort } from "../../lib/format";
import { isPending } from "../../lib/offline/queue";
import type { OfflineFlag, QueuedBill } from "../../lib/offline/types";
import { usePos } from "../pos-context";
import { useAgo } from "./offline-bar";
import { useOffline } from "./offline-provider";

const STATUS_BADGE = { queued: "warning", syncing: "default", failed: "destructive", synced: "success", voided: "muted" } as const;

/** One line per flag, in the cashier's language. */
export function flagText(t: (k: string, v?: Record<string, string | number>) => string, f: OfflineFlag): string {
  const line = typeof f.line === "number" ? ` (${f.line + 1})` : "";
  return `${t(`pos.off.flag.${f.code}`)}${line}`;
}

export function PendingBillsDialog({
  open,
  onClose,
  onShowSlip,
}: {
  open: boolean;
  onClose: () => void;
  /** Open the slip of a bill (print / reprint) in the receipt screen. */
  onShowSlip: (bill: QueuedBill) => void;
}) {
  const { t } = useI18n();
  const { online } = usePos();
  const offline = useOffline();
  const ago = useAgo();
  const [cancelling, setCancelling] = React.useState<QueuedBill | null>(null);
  const [showDone, setShowDone] = React.useState(false);
  const { counts } = offline;

  const list = React.useMemo(() => {
    const sorted = [...offline.bills].sort((a, b) => b.order - a.order);
    return showDone ? sorted : sorted.filter((b) => isPending(b) || (b.status === "synced" && (b.result?.flags.length ?? 0) > 0));
  }, [offline.bills, showDone]);

  const download = async () => {
    const json = await offline.exportJson();
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `offline-bills-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 p-0 sm:max-w-3xl" closeLabel={t("pos.common.close")}>
        <DialogHeader className="border-b px-5 py-4 text-left sm:px-5 sm:pr-12">
          <DialogTitle>{t("pos.off.title")}</DialogTitle>
          <DialogDescription>
            {t("pos.off.summary", { pending: counts.pending, failed: counts.failed, flagged: counts.flagged })}
            {offline.lastSyncAt ? ` · ${t("pos.off.lastSync", { when: ago(offline.lastSyncAt) })}` : ""}
          </DialogDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" size="sm" onClick={() => void offline.syncNow()} disabled={!online.online || offline.syncing || counts.pending === 0}>
              {offline.syncing ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} {t("pos.off.syncNow")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void download()}>
              <DownloadIcon /> {t("pos.off.export")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowDone((v) => !v)}>
              {t(showDone ? "pos.off.hideDone" : "pos.off.showDone", { count: counts.synced + counts.voided })}
            </Button>
          </div>
          {!online.online && <p className="pt-1 text-xs text-muted-foreground">{t("pos.off.syncNeedsNet")}</p>}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {list.length === 0 ? (
            <EmptyState title={t("pos.off.emptyTitle")} description={t("pos.off.emptyBody")} />
          ) : (
            <ul className="grid gap-2">
              {list.map((b) => (
                <li key={b.clientId} className="grid gap-2 rounded-xl border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold tabular-nums">{b.result?.number ?? b.number}</span>
                    <Badge variant={STATUS_BADGE[b.status]}>{t(`pos.off.status.${b.status}`)}</Badge>
                    {b.numberKind === "provisional" && !b.result?.number && <Badge variant="outline">{t("pos.off.provisional")}</Badge>}
                    <span className="ml-auto text-sm font-semibold tabular-nums">{money(b.display.total)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {timeShort(b.createdAt)} · {b.display.customerName} · {t("pos.off.items", { count: b.display.itemCount })} · {b.display.cashier}
                    {b.result?.number && b.result.number !== b.number ? ` · ${t("pos.off.slipNumber", { number: b.number })}` : ""}
                  </p>
                  {b.error && (
                    <p className="rounded-lg bg-destructive/10 px-2 py-1 text-xs text-destructive" role="alert">
                      {t("pos.off.error", { code: b.error.code })}: {b.error.message}
                      {b.error.retryable && b.nextTryAt ? ` · ${t("pos.off.retryAt", { time: timeShort(b.nextTryAt) })}` : ""}
                    </p>
                  )}
                  {(b.result?.flags.length ?? 0) > 0 && (
                    <ul className="grid gap-0.5 rounded-lg bg-warning/15 px-2 py-1 text-xs">
                      {b.result!.flags.map((f, i) => (
                        <li key={i}>{flagText(t, f)}</li>
                      ))}
                      {b.result!.flags.some((f) => f.code === "number_reassigned") && (
                        <li className="font-medium">{t("pos.off.reprintHint", { number: b.result!.number ?? "" })}</li>
                      )}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {b.receipt && (
                      <Button type="button" size="sm" variant="outline" onClick={() => onShowSlip(b)}>
                        <ReceiptTextIcon /> {t("pos.off.showSlip")}
                      </Button>
                    )}
                    {b.status === "failed" && (
                      <Button type="button" size="sm" variant="secondary" onClick={() => void offline.retry(b.clientId)} disabled={!online.online}>
                        <RotateCcwIcon /> {t("pos.off.retry")}
                      </Button>
                    )}
                    {(b.status === "queued" || b.status === "failed") && !b.payload.voided && (
                      <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelling(b)}>
                        <XCircleIcon /> {t("pos.off.cancelBill")}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">{t("pos.off.returnsNote")}</p>
      </DialogContent>
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={t("pos.off.cancelTitle")}
        description={t("pos.off.cancelBody", { number: cancelling?.number ?? "", total: money(cancelling?.display.total ?? 0) })}
        confirmLabel={t("pos.off.cancelBill")}
        onConfirm={() => {
          const b = cancelling;
          setCancelling(null);
          if (!b) return;
          void offline.voidBill(b.clientId, t("pos.off.cancelReason")).then((ok) => (ok ? toast.success(t("pos.off.cancelled")) : toast.error(t("pos.off.cantCancel"))));
        }}
      />
    </Dialog>
  );
}
