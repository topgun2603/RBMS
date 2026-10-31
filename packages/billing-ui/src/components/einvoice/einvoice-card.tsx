"use client";

import * as React from "react";
import { ApiError, useFeature, useI18n } from "@rbms/web";
import { AlertTriangleIcon, BanIcon, CircleAlertIcon, FileCheck2Icon, FlaskConicalIcon, RotateCwIcon, TimerIcon, TruckIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AnimatePresence,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  motion,
  Skeleton,
  StatusPill,
  toast,
  useReducedMotionSafe,
} from "@rbms/ui";
import { CopyButton } from "../copy-button";
import { QrImage } from "../upi-qr";
import { useHasPermission } from "../../lib/access";
import { money } from "../../lib/format";
import {
  cancelWindow,
  decodeSignedQr,
  einvoiceTimeline,
  EWB_CANCEL_REASONS,
  IRN_CANCEL_REASONS,
  splitDuration,
  truncateMiddle,
  type EInvoiceRecord,
  type InvoiceEInvoiceStatus,
} from "../../lib/einvoice";
import { useEInvoiceAction, useEInvoiceStatus } from "../../lib/queries-growth";
import type { Invoice } from "../../lib/types";
import { CancelReasonDialog } from "./cancel-reason-dialog";
import { EInvoiceTimeline } from "./einvoice-timeline";
import { EwbDialog } from "./ewb-dialog";
import { GenerateIrnDialog } from "./generate-irn-dialog";

export const EINVOICE_FEATURE = "gst-einvoice";
export const EWAYBILL_FEATURE = "gst-ewaybill";
export const EINVOICE_PERMISSION = "einvoice.manage";

/** Re-renders every `ms` so countdowns stay current. */
function useNow(ms = 30_000) {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

type DialogKind = null | "irn" | "cancelIrn" | "ewb" | "cancelEwb";

/**
 * E-invoice (IRN) + e-way bill panel for an issued B2B bill (feature `gst-einvoice`, e-way bill part `gst-ewaybill`).
 * Writes need `einvoice.manage`; without it (or on a 403) the status is read-only.
 */
export function EInvoiceCard({ invoice }: { invoice: Invoice }) {
  const { t } = useI18n();
  const status = useEInvoiceStatus(invoice.id);
  const forbidden = status.error instanceof ApiError && status.error.status === 403;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="icon-chip size-8 text-primary">
            <FileCheck2Icon className="size-4" />
          </span>
          {t("billing.einvoice.title")}
          {status.data?.history.some((r) => r.mock) && (
            <Badge variant="warning" className="ml-auto gap-1">
              <FlaskConicalIcon className="size-3" /> {t("billing.einvoice.sandbox")}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {status.isPending ? (
          <div className="grid gap-2" aria-busy>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ) : forbidden ? (
          <p className="text-sm text-muted-foreground">{t("billing.einvoice.noAccess")}</p>
        ) : status.isError ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-danger-ink">
              <CircleAlertIcon className="size-4 shrink-0" />
              <span className="truncate">{t("billing.einvoice.loadError")}</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => void status.refetch()} disabled={status.isFetching}>
              <RotateCwIcon className={status.isFetching ? "animate-spin" : undefined} /> {t("billing.common.retry")}
            </Button>
          </div>
        ) : (
          <EInvoiceBody invoice={invoice} status={status.data} />
        )}
      </CardContent>
    </Card>
  );
}

function EInvoiceBody({ invoice, status }: { invoice: Invoice; status: InvoiceEInvoiceStatus }) {
  const { t, formatDate } = useI18n();
  const reduced = useReducedMotionSafe();
  const canManage = useHasPermission(EINVOICE_PERMISSION);
  const ewbOn = useFeature(EWAYBILL_FEATURE);
  const action = useEInvoiceAction(invoice.id);
  const now = useNow();
  const [dialog, setDialog] = React.useState<DialogKind>(null);
  const setOpen = (d: DialogKind) => (o: boolean) => setDialog(o ? d : null);

  const active = status.einvoice;
  const latest = status.history[0] ?? null;
  const cancelled = !active ? status.history.find((r) => r.status === "cancelled") ?? null : null;
  const failed = latest?.status === "failed" ? latest : null;
  const events = React.useMemo(() => einvoiceTimeline(status.history), [status.history]);
  const billCancelled = invoice.status === "cancelled";
  const fmt = (d: string | null) => (d ? formatDate(d, { dateStyle: "medium", timeStyle: "short" }) : "—");

  return (
    <>
      <AnimatePresence initial={false} mode="wait">
        {active ? (
          <motion.div key="active" initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid gap-3">
            <IrnPanel record={active} now={now} canManage={canManage} ewbActive={!!status.ewb} onCancel={() => setDialog("cancelIrn")} />
          </motion.div>
        ) : cancelled ? (
          <motion.div key="cancelled" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid gap-1 text-sm">
            <StatusPill tone="neutral" icon={BanIcon} size="md">
              {t("billing.einvoice.cancelledTitle")}
            </StatusPill>
            <p className="text-meta text-muted-foreground">{t("billing.einvoice.cancelledHint")}</p>
          </motion.div>
        ) : (
          <motion.div key="none" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid gap-3">
            <div className="text-sm">
              <p className="font-medium">{t("billing.einvoice.statusNone")}</p>
              <p className="text-meta text-muted-foreground">{t("billing.einvoice.statusNoneHint")}</p>
            </div>
            {failed && (
              <Alert variant="destructive" className="py-2">
                <AlertTriangleIcon />
                <AlertTitle>{t("billing.einvoice.failedTitle")}</AlertTitle>
                {failed.error?.message && <AlertDescription className="break-words">{failed.error.message}</AlertDescription>}
              </Alert>
            )}
            {canManage && !billCancelled ? (
              <Button onClick={() => setDialog("irn")}>
                <FileCheck2Icon /> {t("billing.einvoice.generate")}
              </Button>
            ) : (
              !canManage && <p className="text-meta text-muted-foreground">{t("billing.einvoice.readOnly")}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {ewbOn && (
        <section className="grid gap-2 border-t pt-3">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <TruckIcon className="size-4 text-primary" /> {t("billing.ewb.title")}
          </h3>
          {status.ewb ? (
            <motion.dl initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="grid gap-1.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{t("billing.ewb.number")}</dt>
                <dd className="flex items-center gap-1 font-mono font-medium tabular-nums">
                  {status.ewb.ewbNo}
                  <CopyButton value={status.ewb.ewbNo} variant="ghost" size="icon-sm" />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("billing.ewb.date")}</dt>
                <dd className="text-right tabular-nums">{fmt(status.ewb.ewbDate)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t("billing.ewb.validTill")}</dt>
                <dd className="text-right tabular-nums">{status.ewb.validTill ? fmt(status.ewb.validTill) : t("billing.ewb.validTillNone")}</dd>
              </div>
              {canManage && (
                <Button variant="outline" size="sm" className="mt-1 justify-self-start text-destructive hover:text-destructive" onClick={() => setDialog("cancelEwb")}>
                  <BanIcon /> {t("billing.ewb.cancel")}
                </Button>
              )}
            </motion.dl>
          ) : (
            <div className="grid gap-2">
              <p className="text-meta text-muted-foreground">
                <span className="font-medium text-foreground">{t("billing.ewb.none")}</span> · {t("billing.ewb.noneHint")}
              </p>
              {canManage && !billCancelled && (
                <Button variant="outline" onClick={() => setDialog("ewb")}>
                  <TruckIcon /> {t("billing.ewb.generate")}
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      <EInvoiceTimeline events={events} />

      {canManage && (
        <>
          <GenerateIrnDialog invoiceId={invoice.id} open={dialog === "irn"} onOpenChange={setOpen("irn")} />
          <CancelReasonDialog
            open={dialog === "cancelIrn"}
            onOpenChange={setOpen("cancelIrn")}
            title={t("billing.einvoice.cancel.title")}
            description={t("billing.einvoice.cancel.body")}
            confirmLabel={t("billing.einvoice.cancel.confirm")}
            reasons={IRN_CANCEL_REASONS}
            onConfirm={async (reason, remark) => {
              await action.mutateAsync({ kind: "cancelIrn", reason, remark: remark || undefined });
              toast.success(t("billing.einvoice.cancel.done"));
            }}
          />
          {ewbOn && (
            <>
              <EwbDialog invoiceId={invoice.id} billDate={invoice.date} standalone={!active} open={dialog === "ewb"} onOpenChange={setOpen("ewb")} />
              <CancelReasonDialog
                open={dialog === "cancelEwb"}
                onOpenChange={setOpen("cancelEwb")}
                title={t("billing.ewb.cancelTitle")}
                description={t("billing.ewb.cancelBody")}
                confirmLabel={t("billing.ewb.cancelConfirm")}
                reasons={EWB_CANCEL_REASONS}
                onConfirm={async (reason, remark) => {
                  await action.mutateAsync({ kind: "cancelEwb", reason, remark: remark || undefined });
                  toast.success(t("billing.ewb.cancelDone"));
                }}
              />
            </>
          )}
        </>
      )}
    </>
  );
}

function IrnPanel({
  record,
  now,
  canManage,
  ewbActive,
  onCancel,
}: {
  record: EInvoiceRecord;
  now: Date;
  canManage: boolean;
  ewbActive: boolean;
  onCancel: () => void;
}) {
  const { t, formatDate } = useI18n();
  // Decode on the client; fall back to the server's decoded copy.
  const qr = React.useMemo(() => decodeSignedQr(record.signedQrCode) ?? record.qr, [record.signedQrCode, record.qr]);
  const win = cancelWindow(record.cancellableUntil, now);
  const left = splitDuration(win.msLeft);
  const irn = record.irn ?? "";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone="success" icon={FileCheck2Icon} size="md">
          {t("billing.einvoice.generated")}
        </StatusPill>
      </div>
      <dl className="grid gap-1.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t("billing.einvoice.irn")}</dt>
          <dd className="flex min-w-0 items-center gap-1">
            <span className="truncate font-mono text-xs" title={irn}>
              {truncateMiddle(irn)}
            </span>
            <CopyButton value={irn} label={t("billing.einvoice.copyIrn")} copiedMessage={t("billing.einvoice.irnCopied")} variant="ghost" size="icon-sm" />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t("billing.einvoice.ackNo")}</dt>
          <dd className="font-mono text-xs tabular-nums">{record.ackNo ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t("billing.einvoice.ackDate")}</dt>
          <dd className="text-right tabular-nums">{record.ackDate ? formatDate(record.ackDate, { dateStyle: "medium", timeStyle: "short" }) : "—"}</dd>
        </div>
      </dl>

      {record.signedQrCode && (
        <div className="grid gap-3 rounded-xl border bg-muted/30 p-3 sm:grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-1">
          <QrImage value={record.signedQrCode} size={148} className="justify-self-center" alt={t("billing.einvoice.qrAlt", { number: record.docNo })} />
          {qr ? (
            <dl className="grid content-start gap-1 text-xs">
              <p className="mb-0.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("billing.einvoice.qrTitle")}</p>
              <QrRow label={t("billing.einvoice.qrSeller")} value={qr.SellerGstin} mono />
              <QrRow label={t("billing.einvoice.qrBuyer")} value={qr.BuyerGstin} mono />
              <QrRow label={t("billing.einvoice.qrDocNo")} value={qr.DocNo} />
              <QrRow label={t("billing.einvoice.qrDocDate")} value={qr.DocDt} />
              <QrRow label={t("billing.einvoice.qrTotal")} value={money(Math.round(Number(qr.TotInvVal) * 100))} />
              <QrRow label={t("billing.einvoice.qrItems")} value={String(qr.ItemCnt)} />
              <QrRow label={t("billing.einvoice.qrHsn")} value={qr.MainHsnCode} mono />
            </dl>
          ) : (
            <p className="text-meta text-muted-foreground">{t("billing.einvoice.qrUnreadable")}</p>
          )}
        </div>
      )}

      {win.open ? (
        <div className="grid gap-2">
          <p className="flex items-start gap-1.5 text-meta text-muted-foreground">
            <TimerIcon className="mt-px size-3.5 shrink-0" />
            <span>
              {t("billing.einvoice.cancellableFor", left)} ·{" "}
              {t("billing.einvoice.cancellableUntil", { time: formatDate(win.until!, { dateStyle: "medium", timeStyle: "short" }) })}
            </span>
          </p>
          {canManage &&
            (ewbActive ? (
              <p className="text-meta text-muted-foreground">{t("billing.einvoice.cancelEwbFirst")}</p>
            ) : (
              <Button variant="outline" size="sm" className="justify-self-start text-destructive hover:text-destructive" onClick={onCancel}>
                <BanIcon /> {t("billing.einvoice.cancelIrn")}
              </Button>
            ))}
        </div>
      ) : (
        <p className="text-meta text-muted-foreground">{t("billing.einvoice.cancelClosed")}</p>
      )}
    </>
  );
}

function QrRow({ label, value, mono }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "truncate font-mono" : "truncate text-right"}>{value ?? "—"}</dd>
    </div>
  );
}
