"use client";

import * as React from "react";
import { ModuleLink, useFeature, useI18n, useModuleNavigate, usePermission, useRouteParams, useShop } from "@srirealtime/web";
import { AlertTriangleIcon, BanIcon, ReceiptIcon, SendIcon, TruckIcon, Undo2Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent, CardHeader, CardTitle, cn, DropdownMenuItem, DropdownMenuSeparator } from "@srirealtime/ui";
import { CancelSalesDocDialog, ChallanInvoiceDialog, ChallanTransportDialog, ReturnDialog, SendSalesDocDialog } from "../components/sales-docs/sd-dialogs";
import { DetailFrame, DetailLayout } from "../components/sales-docs/sd-detail";
import { qtyText, SalesDocTimeline, SideRow, useReasonLabel } from "../components/sales-docs/sd-ui";
import { useChallan } from "../lib/queries-sales-docs";
import type { Challan } from "../lib/types-sales-docs";

export default function ChallanDetailPage() {
  return (
    <React.Suspense fallback={null}>
      <Detail />
    </React.Suspense>
  );
}

function Detail() {
  const { id } = useRouteParams<{ id: string }>();
  const q = useChallan(id);
  return (
    <DetailFrame kind="challan" query={q}>
      {(c) => <View challan={c} />}
    </DetailFrame>
  );
}

type DialogKind = null | "send" | "return" | "invoice" | "transport" | "cancel";

function View({ challan: c }: { challan: Challan }) {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const { shopName } = useShop();
  const inventoryOn = useFeature("inventory");
  const canManage = usePermission("sales-docs.manage");
  const canBill = usePermission("invoices.create");
  const reasonLabel = useReasonLabel();
  const [dialog, setDialog] = React.useState<DialogKind>(null);

  const returned = c.lines.filter((l) => l.returned > 0);
  const docData = React.useMemo(
    () => ({
      ...c,
      kind: "challan" as const,
      status: c.displayStatus,
      invoiceNumber: c.invoiceMissing ? null : c.invoiceNumber,
      returned: returned.map((l) => ({ description: l.description, unit: l.unit ?? null, qty: l.returned })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `returned` derives from c
    [c],
  );

  const actions = (
    <>
      {canManage && canBill && c.canInvoice && (
        <Button size="lg" className="h-11" onClick={() => setDialog("invoice")}>
          <ReceiptIcon /> {t("billing.sd.challan.makeBill")}
        </Button>
      )}
      {canManage && c.canReturn && (
        <Button size="lg" variant={c.canInvoice ? "outline" : "default"} className="h-11" onClick={() => setDialog("return")}>
          <Undo2Icon /> {t("billing.sd.challan.return")}
        </Button>
      )}
      {canManage && c.status !== "cancelled" && (
        <Button size="lg" variant="outline" className="h-11" onClick={() => setDialog("send")}>
          <SendIcon /> {t("billing.sd.send.action")}
        </Button>
      )}
    </>
  );

  const menu = canManage && (
    <>
      {c.canEdit && (
        <DropdownMenuItem className="h-10" onSelect={() => setDialog("transport")}>
          <TruckIcon /> {t("billing.sd.transportEdit.action")}
        </DropdownMenuItem>
      )}
      {c.canCancel && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => setDialog("cancel")}>
            <BanIcon /> {t("billing.sd.cancel.action")}
          </DropdownMenuItem>
        </>
      )}
    </>
  );

  const side = (
    <>
      {c.ewbSuggested && !c.ewbNo && c.status !== "cancelled" && (
        <Alert className="border-amber-500/40 bg-amber-500/5">
          <AlertTriangleIcon className="text-amber-600" />
          <AlertTitle>{t("billing.sd.challan.ewbTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("billing.sd.form.ewbNeeded")}</p>
            {canManage && (
              <Button variant="link" className="h-auto p-0" onClick={() => setDialog("transport")}>
                {t("billing.sd.challan.addEwb")}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="icon-chip size-8 text-primary">
              <TruckIcon className="size-4" />
            </span>
            {t("billing.sd.statusCard")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <dl className="grid gap-2">
            <SideRow label={t("billing.sd.doc.purpose")}>{reasonLabel(c.reason)}</SideRow>
            {c.returnBy && (
              <SideRow label={t("billing.sd.doc.returnBy")}>
                <span className={cn("tabular-nums", c.overdue && "font-semibold text-warning-ink")}>{formatDate(c.returnBy)}</span>
                {c.overdue && <span className="block text-meta text-warning-ink">{t("billing.sd.challan.overdue")}</span>}
              </SideRow>
            )}
            {c.saleOrderId && (
              <SideRow label={t("billing.sd.doc.saleOrder")}>
                <ModuleLink to={`sale-orders/${c.saleOrderId}`} className="font-mono hover:underline">
                  {c.saleOrderNumber}
                </ModuleLink>
              </SideRow>
            )}
            {c.ewbNo && <SideRow label={t("billing.sd.doc.ewbNo")}>{c.ewbNo}</SideRow>}
            {c.transport.vehicleNo && <SideRow label={t("billing.sd.transport.vehicle")}>{c.transport.vehicleNo}</SideRow>}
            <SideRow label={t("billing.sd.challan.stock")}>{inventoryOn ? t("billing.sd.challan.stockOut") : t("billing.sd.challan.stockOff")}</SideRow>
          </dl>
          {c.lines.some((l) => l.returned > 0) && (
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="mb-1 font-medium">{t("billing.sd.challan.returnedTitle")}</p>
              <ul className="grid gap-1 text-meta">
                {c.lines.map((l) => (
                  <li key={l.key} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{l.description}</span>
                    <span className="tabular-nums">{t("billing.sd.challan.backOf", { back: qtyText(l.returned), sent: qtyText(l.qty) })}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {c.invoiceId && (
            <div className="rounded-lg border bg-primary/5 p-3">
              <p className="font-medium">{t("billing.sd.challan.billedAs")}</p>
              <Button asChild variant="link" className="h-auto p-0">
                <ModuleLink to={`invoices/${c.invoiceId}`}>{c.invoiceNumber ?? t("billing.status.draft")}</ModuleLink>
              </Button>
              {c.invoiceMissing && <p className="text-meta text-warning-ink">{t("billing.sd.billGone")}</p>}
            </div>
          )}
          {c.status === "cancelled" && (
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="font-medium">{t("billing.sd.cancelledOn", { date: c.cancelledAt ? formatDate(c.cancelledAt) : "" })}</p>
              {c.cancelReason && <p className="text-muted-foreground">{c.cancelReason}</p>}
            </div>
          )}
        </CardContent>
      </Card>
      <SalesDocTimeline events={c.events} />
    </>
  );

  return (
    <>
      <DetailLayout
        kind="challan"
        doc={c}
        status={c.displayStatus}
        docData={docData}
        subtitle={
          <>
            <span className="font-medium text-foreground">{c.customer.name}</span> · {formatDate(c.date)} · {reasonLabel(c.reason)}
          </>
        }
        actions={actions}
        menu={menu}
        side={side}
      />
      <SendSalesDocDialog kind="challan" doc={c} shopName={shopName} open={dialog === "send"} onOpenChange={(v) => setDialog(v ? "send" : null)} />
      <ReturnDialog challan={c} open={dialog === "return"} onOpenChange={(v) => setDialog(v ? "return" : null)} />
      <ChallanInvoiceDialog challan={c} open={dialog === "invoice"} onOpenChange={(v) => setDialog(v ? "invoice" : null)} onDone={(inv) => navigate(`invoices/${inv.id}`)} />
      <ChallanTransportDialog challan={c} open={dialog === "transport"} onOpenChange={(v) => setDialog(v ? "transport" : null)} />
      <CancelSalesDocDialog kind="challan" doc={c} open={dialog === "cancel"} onOpenChange={(v) => setDialog(v ? "cancel" : null)} />
    </>
  );
}
