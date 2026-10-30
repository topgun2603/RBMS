"use client";

import * as React from "react";
import { ModuleLink, useI18n, useModuleNavigate, usePermission, useQueryParams, useRouteParams, useShop } from "@rbms/web";
import { BanIcon, ClipboardListIcon, FileTextIcon, HandCoinsIcon, PackageCheckIcon, PencilIcon, ReceiptIcon, SendIcon, TruckIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, cn, DropdownMenuItem, DropdownMenuSeparator, Progress } from "@rbms/ui";
import { AdvanceDialog, CancelSalesDocDialog, DeliverDialog, OrderInvoiceDialog, SendSalesDocDialog } from "../components/sales-docs/sd-dialogs";
import { DetailFrame, DetailLayout } from "../components/sales-docs/sd-detail";
import { qtyText, SalesDocStatusPill, SalesDocTimeline, SideRow } from "../components/sales-docs/sd-ui";
import { money } from "../lib/format";
import { useSaleOrder } from "../lib/queries-sales-docs";
import type { SaleOrder } from "../lib/types-sales-docs";

export default function SaleOrderDetailPage() {
  return (
    <React.Suspense fallback={null}>
      <Detail />
    </React.Suspense>
  );
}

function Detail() {
  const { id } = useRouteParams<{ id: string }>();
  const q = useSaleOrder(id);
  return (
    <DetailFrame kind="sale_order" query={q}>
      {(o) => <View order={o} />}
    </DetailFrame>
  );
}

type DialogKind = null | "send" | "advance" | "deliver" | "invoice" | "cancel";

function View({ order: o }: { order: SaleOrder }) {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const params = useQueryParams();
  const { shopName } = useShop();
  const canManage = usePermission("sales-docs.manage");
  const canBill = usePermission("invoices.create");
  const canReceive = usePermission("payments.receive");
  const [dialog, setDialog] = React.useState<DialogKind>(null);

  React.useEffect(() => {
    if (params.get("send") === "1" && canManage && o.status !== "cancelled") {
      setDialog("send");
      navigate("?", { replace: true, scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on arrival
  }, []);

  const docData = React.useMemo(() => ({ ...o, kind: "sale_order" as const }), [o]);
  const ordered = o.progress.reduce((s, p) => s + p.ordered, 0);
  const delivered = o.progress.reduce((s, p) => s + Math.min(p.delivered, p.ordered), 0);
  const invoiced = o.progress.reduce((s, p) => s + Math.min(p.invoiced, p.ordered), 0);
  const pct = (n: number) => (ordered > 0 ? Math.round((n / ordered) * 100) : 0);

  const actions = (
    <>
      {canManage && o.canDeliver && (
        <Button size="lg" className="h-11" onClick={() => setDialog("deliver")}>
          <TruckIcon /> {t("billing.sd.order.deliver")}
        </Button>
      )}
      {canManage && canBill && o.canInvoice && (
        <Button size="lg" variant={o.canDeliver ? "outline" : "default"} className="h-11" onClick={() => setDialog("invoice")}>
          <ReceiptIcon /> {t("billing.sd.order.makeBill")}
        </Button>
      )}
      {canManage && canReceive && o.canAdvance && (
        <Button size="lg" variant="outline" className="h-11" onClick={() => setDialog("advance")}>
          <HandCoinsIcon /> {t("billing.sd.advance.action")}
        </Button>
      )}
      {canManage && o.status !== "cancelled" && (
        <Button size="lg" variant="outline" className="h-11" onClick={() => setDialog("send")}>
          <SendIcon /> {t("billing.sd.send.action")}
        </Button>
      )}
      {canManage && o.canEdit && (
        <Button asChild size="lg" variant="outline" className="h-11">
          <ModuleLink to={`sale-orders/${o.id}/edit`}>
            <PencilIcon /> {t("billing.detail.edit")}
          </ModuleLink>
        </Button>
      )}
    </>
  );

  const menu = canManage && o.canCancel && (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => setDialog("cancel")}>
        <BanIcon /> {t("billing.sd.cancel.action")}
      </DropdownMenuItem>
    </>
  );

  const side = (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="icon-chip size-8 text-primary">
              <PackageCheckIcon className="size-4" />
            </span>
            {t("billing.sd.order.progress")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="grid gap-1.5">
            <div className="flex justify-between text-meta">
              <span>{t("billing.sd.order.delivered")}</span>
              <span className="tabular-nums">{pct(delivered)}%</span>
            </div>
            <Progress value={pct(delivered)} aria-label={t("billing.sd.order.delivered")} />
            <div className="flex justify-between text-meta">
              <span>{t("billing.sd.order.invoiced")}</span>
              <span className="tabular-nums">{pct(invoiced)}%</span>
            </div>
            <Progress value={pct(invoiced)} aria-label={t("billing.sd.order.invoiced")} />
          </div>
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[16rem] text-meta">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="px-1 py-1 font-medium">{t("billing.sd.order.col.item")}</th>
                  <th className="px-1 py-1 text-right font-medium">{t("billing.sd.order.col.ordered")}</th>
                  <th className="px-1 py-1 text-right font-medium">{t("billing.sd.order.col.delivered")}</th>
                  <th className="px-1 py-1 text-right font-medium">{t("billing.sd.order.col.invoiced")}</th>
                </tr>
              </thead>
              <tbody>
                {o.progress.map((p) => (
                  <tr key={p.key} className="border-t align-top">
                    <td className="max-w-[9rem] truncate px-1 py-1.5" title={p.description}>
                      {p.description}
                    </td>
                    <td className="px-1 py-1.5 text-right tabular-nums">
                      {qtyText(p.ordered)} {p.unit ?? ""}
                    </td>
                    <td className={cn("px-1 py-1.5 text-right tabular-nums", p.toDeliver > 0 ? "text-warning-ink" : "text-success-ink")}>{qtyText(p.delivered)}</td>
                    <td className="px-1 py-1.5 text-right tabular-nums">{qtyText(p.invoiced)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="grid gap-2">
            {o.promisedDate && (
              <SideRow label={t("billing.sd.doc.promisedDate")}>
                <span className={cn("tabular-nums", o.overdue && "font-semibold text-warning-ink")}>{formatDate(o.promisedDate)}</span>
                {o.overdue && <span className="block text-meta text-warning-ink">{t("billing.sd.order.late")}</span>}
              </SideRow>
            )}
            {o.customerRef && <SideRow label={t("billing.sd.doc.customerRef")}>{o.customerRef}</SideRow>}
            {o.advanceAmount > 0 && (
              <SideRow label={t("billing.sd.doc.advanceAsked")}>
                <span className="tabular-nums">
                  {money(o.advanceAmount)} ({o.advancePercent}%)
                </span>
              </SideRow>
            )}
            <SideRow label={t("billing.sd.doc.advanceReceived")}>
              <span className="font-semibold tabular-nums">{money(o.advanceReceived)}</span>
            </SideRow>
            {o.advanceUnapplied > 0 && <SideRow label={t("billing.sd.advance.heldShort")}>{money(o.advanceUnapplied)}</SideRow>}
            <SideRow label={t("billing.sd.order.hold")}>{o.reserveStock ? t("billing.sd.order.holdOn") : t("billing.sd.order.holdOff")}</SideRow>
            {o.quotationId && (
              <SideRow label={t("billing.sd.doc.againstQuotation")}>
                <ModuleLink to={`quotations/${o.quotationId}`} className="font-mono hover:underline">
                  {o.quotationNumber}
                </ModuleLink>
              </SideRow>
            )}
          </dl>
          {o.status === "cancelled" && (
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="font-medium">{t("billing.sd.cancelledOn", { date: o.cancelledAt ? formatDate(o.cancelledAt) : "" })}</p>
              {o.cancelReason && <p className="text-muted-foreground">{o.cancelReason}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {(o.challans.length > 0 || o.bills.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <span className="icon-chip size-8 text-primary">
                <ClipboardListIcon className="size-4" />
              </span>
              {t("billing.sd.order.documents")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1.5 text-sm">
              {o.challans.map((c) => (
                <li key={c.id}>
                  <ModuleLink to={`challans/${c.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-mono font-medium">
                        <TruckIcon className="size-3.5 text-muted-foreground" /> {c.number}
                      </span>
                      <span className="block text-meta text-muted-foreground">{formatDate(c.date)}</span>
                    </span>
                    <SalesDocStatusPill kind="challan" status={c.displayStatus} size="sm" />
                  </ModuleLink>
                </li>
              ))}
              {o.bills
                .filter((b) => b.via === "order")
                .map((b) => (
                  <li key={b.invoiceId}>
                    <ModuleLink to={`invoices/${b.invoiceId}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
                      <span className="flex items-center gap-1.5 font-mono font-medium">
                        <FileTextIcon className="size-3.5 text-muted-foreground" /> {b.number ?? t("billing.status.draft")}
                      </span>
                      <span className={cn("text-meta", b.missing ? "text-warning-ink" : "text-muted-foreground")}>{b.missing ? t("billing.sd.billGoneShort") : t("billing.sd.order.billDirect")}</span>
                    </ModuleLink>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <SalesDocTimeline events={o.events} />
    </>
  );

  return (
    <>
      <DetailLayout
        kind="sale_order"
        doc={o}
        status={o.status}
        docData={docData}
        subtitle={
          <>
            <span className="font-medium text-foreground">{o.customer.name}</span> · {formatDate(o.date)}
            {o.promisedDate ? ` · ${t("billing.sd.order.dueShort", { date: formatDate(o.promisedDate) })}` : ""}
          </>
        }
        actions={actions}
        menu={menu}
        side={side}
      />
      <SendSalesDocDialog kind="sale_order" doc={o} shopName={shopName} open={dialog === "send"} onOpenChange={(v) => setDialog(v ? "send" : null)} />
      <AdvanceDialog kind="sale_order" doc={o} open={dialog === "advance"} onOpenChange={(v) => setDialog(v ? "advance" : null)} />
      <DeliverDialog order={o} open={dialog === "deliver"} onOpenChange={(v) => setDialog(v ? "deliver" : null)} onDone={(c) => navigate(`challans/${c.id}`)} />
      <OrderInvoiceDialog order={o} open={dialog === "invoice"} onOpenChange={(v) => setDialog(v ? "invoice" : null)} onDone={(inv) => navigate(`invoices/${inv.id}`)} />
      <CancelSalesDocDialog kind="sale_order" doc={o} open={dialog === "cancel"} onOpenChange={(v) => setDialog(v ? "cancel" : null)} />
    </>
  );
}
