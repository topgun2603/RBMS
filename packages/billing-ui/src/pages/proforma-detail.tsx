"use client";

import * as React from "react";
import { ModuleLink, useI18n, useModuleNavigate, usePermission, useQueryParams, useRouteParams, useShop } from "@srirealtime/web";
import { BanIcon, CheckCircle2Icon, FileTextIcon, HandCoinsIcon, PencilIcon, ReceiptIcon, SendIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, DropdownMenuItem, DropdownMenuSeparator, toast } from "@srirealtime/ui";
import { AdvanceDialog, CancelSalesDocDialog, ConvertProformaDialog, SendSalesDocDialog } from "../components/sales-docs/sd-dialogs";
import { DetailFrame, DetailLayout } from "../components/sales-docs/sd-detail";
import { SalesDocTimeline, SideRow } from "../components/sales-docs/sd-ui";
import { useHasPermission } from "../lib/access";
import { money } from "../lib/format";
import { useIssueProforma, useProforma } from "../lib/queries-sales-docs";
import type { Proforma } from "../lib/types-sales-docs";

export default function ProformaDetailPage() {
  return (
    <React.Suspense fallback={null}>
      <Detail />
    </React.Suspense>
  );
}

function Detail() {
  const { id } = useRouteParams<{ id: string }>();
  const q = useProforma(id);
  return (
    <DetailFrame kind="proforma" query={q}>
      {(p) => <View proforma={p} />}
    </DetailFrame>
  );
}

type DialogKind = null | "send" | "advance" | "convert" | "cancel";

function View({ proforma: p }: { proforma: Proforma }) {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const params = useQueryParams();
  const { shopName } = useShop();
  const canManage = usePermission("sales-docs.manage");
  const canBill = useHasPermission("invoices.create");
  const canReceive = useHasPermission("payments.receive");
  const issue = useIssueProforma();
  const [dialog, setDialog] = React.useState<DialogKind>(null);

  React.useEffect(() => {
    if (params.get("send") === "1" && canManage && p.status !== "cancelled") {
      setDialog("send");
      navigate("?", { replace: true, scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on arrival
  }, []);

  const docData = React.useMemo(
    () => ({ ...p, kind: "proforma" as const, status: p.displayStatus, advanceReceived: p.advanceReceived }),
    [p],
  );
  const live = p.status !== "cancelled" && !(p.status === "converted" && !p.invoiceMissing);

  const actions = (
    <>
      {canManage && canBill && p.canConvert && (
        <Button size="lg" className="h-11" onClick={() => setDialog("convert")}>
          <ReceiptIcon /> {t("billing.sd.proforma.makeBill")}
        </Button>
      )}
      {canManage && canReceive && p.canAdvance && (
        <Button size="lg" variant="outline" className="h-11" onClick={() => setDialog("advance")}>
          <HandCoinsIcon /> {t("billing.sd.advance.action")}
        </Button>
      )}
      {canManage && live && (
        <Button size="lg" variant="outline" className="h-11" onClick={() => setDialog("send")}>
          <SendIcon /> {p.status === "draft" ? t("billing.sd.send.action") : t("billing.sd.send.again")}
        </Button>
      )}
      {canManage && p.canEdit && (
        <Button asChild size="lg" variant="outline" className="h-11">
          <ModuleLink to={`proformas/${p.id}/edit`}>
            <PencilIcon /> {t("billing.detail.edit")}
          </ModuleLink>
        </Button>
      )}
    </>
  );

  const menu = canManage && (
    <>
      {p.status === "draft" && (
        <DropdownMenuItem
          className="h-10"
          disabled={issue.isPending}
          onSelect={async () => {
            try {
              await issue.mutateAsync(p.id);
              toast.success(t("billing.sd.proforma.issued"));
            } catch (err) {
              toast.error(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          <CheckCircle2Icon /> {t("billing.sd.proforma.issue")}
        </DropdownMenuItem>
      )}
      {p.canCancel && (
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="icon-chip size-8 text-primary">
              <FileTextIcon className="size-4" />
            </span>
            {t("billing.sd.statusCard")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <dl className="grid gap-2">
            <SideRow label={t("billing.sd.doc.validUntil")}>{p.validUntil ? formatDate(p.validUntil) : t("billing.sd.form.noExpiry")}</SideRow>
            {p.advanceAmount > 0 && (
              <SideRow label={t("billing.sd.doc.advanceAsked")}>
                <span className="tabular-nums">
                  {money(p.advanceAmount)} ({p.advancePercent}%)
                </span>
              </SideRow>
            )}
            <SideRow label={t("billing.sd.doc.advanceReceived")}>
              <span className="font-semibold tabular-nums">{money(p.advanceReceived)}</span>
            </SideRow>
            {p.advanceReceived > 0 && (
              <SideRow label={t("billing.sd.doc.balanceAfterAdvance")}>
                <span className="tabular-nums">{money(Math.max(p.total - p.advanceReceived, 0))}</span>
              </SideRow>
            )}
            {p.quotationId && (
              <SideRow label={t("billing.sd.doc.againstQuotation")}>
                <ModuleLink to={`quotations/${p.quotationId}`} className="font-mono hover:underline">
                  {p.quotationNumber}
                </ModuleLink>
              </SideRow>
            )}
          </dl>
          {p.advances.length > 0 && (
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="mb-1 font-medium">{t("billing.sd.advance.list")}</p>
              <ul className="grid gap-1 text-meta">
                {p.advances.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2">
                    <span>
                      {formatDate(a.date)} · {t(`billing.payment.methods.${a.method}`)}
                    </span>
                    <span className="tabular-nums">{money(a.amount)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-meta text-muted-foreground">{p.advanceUnapplied > 0 ? t("billing.sd.advance.held", { amount: money(p.advanceUnapplied) }) : t("billing.sd.advance.applied")}</p>
            </div>
          )}
          {p.invoiceId && (
            <div className="rounded-lg border bg-primary/5 p-3">
              <p className="font-medium">{t("billing.sd.proforma.billedAs")}</p>
              <Button asChild variant="link" className="h-auto p-0">
                <ModuleLink to={`invoices/${p.invoiceId}`}>{p.invoiceNumber ?? t("billing.status.draft")}</ModuleLink>
              </Button>
              {p.invoiceMissing && <p className="text-meta text-warning-ink">{t("billing.sd.billGone")}</p>}
            </div>
          )}
          {p.status === "cancelled" && (
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="font-medium">{t("billing.sd.cancelledOn", { date: p.cancelledAt ? formatDate(p.cancelledAt) : "" })}</p>
              {p.cancelReason && <p className="text-muted-foreground">{p.cancelReason}</p>}
              {p.advanceReceived > 0 && <p className="text-meta text-muted-foreground">{t("billing.sd.advance.keptOnCancel")}</p>}
            </div>
          )}
        </CardContent>
      </Card>
      <SalesDocTimeline events={p.events} />
    </>
  );

  return (
    <>
      <DetailLayout
        kind="proforma"
        doc={p}
        status={p.displayStatus}
        docData={docData}
        subtitle={
          <>
            <span className="font-medium text-foreground">{p.customer.name}</span> · {formatDate(p.date)}
          </>
        }
        actions={actions}
        menu={menu}
        side={side}
      />
      <SendSalesDocDialog kind="proforma" doc={p} shopName={shopName} open={dialog === "send"} onOpenChange={(o) => setDialog(o ? "send" : null)} />
      <AdvanceDialog kind="proforma" doc={p} open={dialog === "advance"} onOpenChange={(o) => setDialog(o ? "advance" : null)} />
      <ConvertProformaDialog proforma={p} open={dialog === "convert"} onOpenChange={(o) => setDialog(o ? "convert" : null)} onDone={(inv) => navigate(`invoices/${inv.id}`)} />
      <CancelSalesDocDialog kind="proforma" doc={p} open={dialog === "cancel"} onOpenChange={(o) => setDialog(o ? "cancel" : null)} />
    </>
  );
}
