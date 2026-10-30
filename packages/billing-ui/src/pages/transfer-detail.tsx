"use client";

import * as React from "react";
import { describeError, ModuleLink, Page, PageHeading, QueryError, useI18n, useModuleNavigate, useRouteParams } from "@rbms/web";
import { ArrowLeftIcon, ArrowLeftRightIcon, FileDownIcon, Loader2Icon, PackageCheckIcon, PrinterIcon, SendIcon, Trash2Icon, XIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
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
import { TransferStatusPill } from "../components/inventory/audit-bits";
import { fmtDay, fmtStamp } from "../components/inventory/batch-bits";
import { cleanQty } from "../components/inventory/stock-meta";
import { useHasPermission } from "../lib/access";
import { formatQty, money, parseQty } from "../lib/format";
import { PDF_PATHS, usePdf } from "../lib/pdf";
import { useDeleteTransfer, useTransfer, useTransferAction } from "../lib/queries-stock";
import type { Transfer, TransferLine } from "../lib/types-stock";
import { useLocationNames } from "./transfers";

const outstanding = (l: Pick<TransferLine, "qty" | "received" | "damaged" | "short">) =>
  Math.max(0, Math.round((l.qty - (l.received ?? 0) - (l.damaged ?? 0) - (l.short ?? 0)) * 1000) / 1000);

export default function TransferDetailPage() {
  const { id } = useRouteParams<{ id: string }>();
  const q = useTransfer(id);
  const { t } = useI18n();
  if (q.isPending) return <Page>{null}</Page>;
  if (!q.data)
    return (
      <Page>
        <PageHeading icon={ArrowLeftRightIcon} title={t("billing.transfers.title")} />
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      </Page>
    );
  return <TransferScreen tr={q.data} />;
}

function TransferScreen({ tr }: { tr: Transfer }) {
  const { t } = useI18n();
  const go = useModuleNavigate();
  const locs = useLocationNames();
  const canTransfer = useHasPermission("inventory.transfer");
  const action = useTransferAction(tr.id);
  const del = useDeleteTransfer();
  const pdf = usePdf();
  const [receiving, setReceiving] = React.useState(false);
  const [confirm, setConfirm] = React.useState<"send" | "cancel" | "delete" | null>(null);
  const [reason, setReason] = React.useState("");

  const run = async (a: Parameters<typeof action.mutateAsync>[0], ok: string) => {
    try {
      await action.mutateAsync(a);
      toast.success(ok);
      return true;
    } catch (err) {
      toast.error(describeError(err, t));
      return false;
    }
  };

  const open = tr.status === "in_transit" || tr.status === "partially_received";
  const from = tr.fromName ?? locs.name(tr.fromLocationId);
  const to = tr.toName ?? locs.name(tr.toLocationId);
  const value = tr.lines.reduce((a, l) => a + Math.round(l.qty * (l.unitCost ?? 0)), 0);
  const title = tr.number ?? t("billing.transfers.instant");

  const actions = (
    <>
      {tr.status === "draft" && canTransfer && (
        <Button size="lg" onClick={() => setConfirm("send")} disabled={action.isPending}>
          <SendIcon /> {t("billing.transfers.send")}
        </Button>
      )}
      {open && canTransfer && (
        <Button size="lg" onClick={() => setReceiving(true)}>
          <PackageCheckIcon /> {t("billing.transfers.receive")}
        </Button>
      )}
      {tr.status !== "draft" && tr.status !== "cancelled" && tr.number && (
        <>
          <Button variant="outline" size="lg" disabled={pdf.busy !== null} onClick={() => void pdf.run("print", PDF_PATHS.transferNote(tr.id), { mode: "open", fallbackName: `Transfer-${tr.number}.pdf` })}>
            <PrinterIcon /> {t("billing.transfers.print")}
          </Button>
          <Button variant="outline" size="lg" disabled={pdf.busy !== null} onClick={() => void pdf.run("download", PDF_PATHS.transferNote(tr.id), { mode: "download", fallbackName: `Transfer-${tr.number}.pdf` })}>
            <FileDownIcon /> {t("billing.transfers.pdf")}
          </Button>
        </>
      )}
      {tr.status === "draft" && canTransfer && (
        <Button variant="ghost" size="lg" onClick={() => setConfirm("delete")}>
          <Trash2Icon /> {t("billing.common.delete")}
        </Button>
      )}
      {tr.status === "in_transit" && canTransfer && (
        <Button variant="ghost" size="lg" onClick={() => setConfirm("cancel")}>
          <XIcon /> {t("billing.transfers.cancel")}
        </Button>
      )}
    </>
  );

  const steps = [
    { key: "created", at: tr.createdAt, on: true },
    { key: "sent", at: tr.sentAt, on: !!tr.sentAt },
    { key: "received", at: tr.receivedAt, on: !!tr.receivedAt },
    { key: "closed", at: tr.closedAt, on: !!tr.closedAt },
  ];

  return (
    <Page>
      <div className="mb-2">
        <Button asChild variant="ghost" size="sm">
          <ModuleLink to="transfers">
            <ArrowLeftIcon /> {t("billing.transfers.title")}
          </ModuleLink>
        </Button>
      </div>
      <PageHeading icon={ArrowLeftRightIcon} title={title} description={`${from} → ${to}`} actions={actions} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <TransferStatusPill status={tr.status} />
        <span className="text-sm text-muted-foreground">{t(`billing.transfers.hint.${tr.status}`, { to })}</span>
        {value > 0 && <span className="text-sm text-muted-foreground">{t("billing.transfers.valueAtCost", { value: money(value) })}</span>}
      </div>

      <ol className="mb-5 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {steps.map((s) => (
          <li key={s.key} className={cn("flex items-center gap-2", s.on ? "text-foreground" : "text-muted-foreground/60")}>
            <span className={cn("size-2 rounded-full", s.on ? "bg-primary" : "bg-muted-foreground/30")} aria-hidden />
            {t(`billing.transfers.step.${s.key}`)}
            {s.at ? <span className="text-xs text-muted-foreground">{fmtStamp(s.at)}</span> : null}
          </li>
        ))}
      </ol>

      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">{t("billing.audit.col.item")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("billing.transfers.col.qty")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("billing.transfers.col.received")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("billing.transfers.col.damaged")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("billing.transfers.col.short")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("billing.transfers.col.onRoad")}</th>
            </tr>
          </thead>
          <tbody>
            {tr.lines.map((l) => (
              <tr key={l.itemId} className="border-b align-top last:border-0">
                <td className="max-w-[18rem] px-3 py-2">
                  <p className="truncate font-medium">{l.itemName || "—"}</p>
                  {l.batches && l.batches.length > 0 && (
                    <p className="font-mono text-xs text-muted-foreground">
                      {l.batches.map((b) => `${b.batchNo}${b.expiry ? ` (${fmtDay(b.expiry)})` : ""} ×${formatQty(b.qty)}`).join(", ")}
                    </p>
                  )}
                  {l.reason && <p className="text-xs text-warning-ink">{l.reason}</p>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatQty(l.qty)} {l.unit}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQty(l.received ?? 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQty(l.damaged ?? 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQty(l.short ?? 0)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{tr.status === "draft" ? "—" : formatQty(outstanding(l))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(tr.transport || tr.note || tr.receiveNote || tr.cancelReason) && (
        <dl className="mt-4 grid gap-2 text-sm">
          {tr.transport && <Info label={t("billing.transfers.form.transport")} value={tr.transport} />}
          {tr.note && <Info label={t("billing.adjust.note")} value={tr.note} />}
          {tr.receiveNote && <Info label={t("billing.transfers.receiveNote")} value={tr.receiveNote} />}
          {tr.cancelReason && <Info label={t("billing.transfers.cancelReason")} value={tr.cancelReason} />}
        </dl>
      )}

      <ReceiveDialog tr={tr} open={receiving} onOpenChange={setReceiving} />

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`billing.transfers.confirm.${confirm ?? "send"}Title`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`billing.transfers.confirm.${confirm ?? "send"}Body`, { from, to })}</AlertDialogDescription>
          </AlertDialogHeader>
          {confirm === "cancel" && (
            <div className="grid gap-1.5">
              <Label htmlFor="tc-reason">{t("billing.transfers.cancelReason")}</Label>
              <Input id="tc-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("billing.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                if (confirm === "send") {
                  if (await run({ action: "send" }, t("billing.transfers.sentToast"))) setConfirm(null);
                } else if (confirm === "cancel") {
                  if (await run({ action: "cancel", body: { reason: reason.trim() || undefined } }, t("billing.transfers.cancelledToast"))) setConfirm(null);
                } else if (confirm === "delete") {
                  try {
                    await del.mutateAsync(tr.id);
                    go("transfers");
                  } catch (err) {
                    toast.error(describeError(err, t));
                  }
                }
              }}
            >
              {(action.isPending || del.isPending) && <Loader2Icon className="animate-spin" />}
              {t(`billing.transfers.confirm.${confirm ?? "send"}Action`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3">
      <dt className="w-40 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-line">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- receive

interface Row {
  itemId: string;
  name: string;
  unit: string;
  left: number;
  received: string;
  damaged: string;
  short: string;
  reason: string;
}

function ReceiveDialog({ tr, open, onOpenChange }: { tr: Transfer; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const action = useTransferAction(tr.id);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setRows(
      tr.lines
        .filter((l) => outstanding(l) > 0)
        .map((l) => ({ itemId: l.itemId, name: l.itemName ?? "", unit: l.unit ?? "", left: outstanding(l), received: String(outstanding(l)), damaged: "", short: "", reason: "" })),
    );
    setNote("");
  }, [open, tr]);

  const set = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.itemId === id ? { ...r, ...p } : r)));
  const num = (v: string) => parseQty(v) ?? 0;
  const over = rows.find((r) => num(r.received) + num(r.damaged) + num(r.short) > r.left + 1e-9);
  const rest = rows.reduce((a, r) => a + Math.max(0, r.left - num(r.received) - num(r.damaged) - num(r.short)), 0);

  const submit = async (closeShort: boolean) => {
    if (over) return;
    try {
      await action.mutateAsync({
        action: "receive",
        body: {
          lines: rows.map((r) => ({ itemId: r.itemId, received: num(r.received), ...(num(r.damaged) ? { damaged: num(r.damaged) } : {}), ...(num(r.short) ? { short: num(r.short) } : {}), ...(r.reason.trim() ? { reason: r.reason.trim() } : {}) })),
          closeShort,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      toast.success(t("billing.transfers.receivedToast"));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !action.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("billing.transfers.receiveTitle", { number: tr.number ?? "" })}</DialogTitle>
          <DialogDescription>{t("billing.transfers.receiveBody")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {rows.map((r) => (
            <div key={r.itemId} className="grid gap-2 rounded-xl border p-3">
              <p className="font-medium">
                {r.name} <span className="text-xs font-normal text-muted-foreground">{t("billing.transfers.onRoadQty", { qty: formatQty(r.left), unit: r.unit })}</span>
              </p>
              <div className="grid grid-cols-3 gap-2">
                <NumField label={t("billing.transfers.col.received")} value={r.received} onChange={(v) => set(r.itemId, { received: v })} />
                <NumField label={t("billing.transfers.col.damaged")} value={r.damaged} onChange={(v) => set(r.itemId, { damaged: v })} />
                <NumField label={t("billing.transfers.col.short")} value={r.short} onChange={(v) => set(r.itemId, { short: v })} />
              </div>
              {(num(r.damaged) > 0 || num(r.short) > 0) && (
                <Input aria-label={t("billing.transfers.reasonLabel")} placeholder={t("billing.transfers.reasonPlaceholder")} maxLength={200} value={r.reason} onChange={(e) => set(r.itemId, { reason: e.target.value })} />
              )}
            </div>
          ))}
          {over && <p className="text-sm text-destructive">{t("billing.transfers.tooMany", { name: over.name })}</p>}
          <div className="grid gap-1.5">
            <Label htmlFor="tr-note">{t("billing.transfers.receiveNote")}</Label>
            <Textarea id="tr-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={action.isPending}>
            {t("billing.common.cancel")}
          </Button>
          {rest > 0 && (
            <Button type="button" variant="outline" size="lg" disabled={action.isPending || !!over} onClick={() => submit(true)}>
              {t("billing.transfers.closeShort", { qty: formatQty(rest) })}
            </Button>
          )}
          <Button type="button" size="lg" disabled={action.isPending || !!over} onClick={() => submit(false)}>
            {action.isPending && <Loader2Icon className="animate-spin" />}
            {t("billing.transfers.receiveSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input inputMode="decimal" className="text-right tabular-nums" value={value} placeholder="0" onChange={(e) => onChange(cleanQty(e.target.value))} />
    </div>
  );
}
