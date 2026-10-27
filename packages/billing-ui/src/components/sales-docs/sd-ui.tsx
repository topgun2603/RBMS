"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  BanIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  FilePenLineIcon,
  HandCoinsIcon,
  HistoryIcon,
  PackageCheckIcon,
  PencilIcon,
  ReceiptIndianRupeeIcon,
  RotateCcwIcon,
  SendIcon,
  TruckIcon,
  Undo2Icon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, cn, StatusPill, type StatusTone } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { money } from "../../lib/format";
import type {
  ChallanReason,
  ChallanStatus,
  ProformaDisplayStatus,
  PublicSalesDocResponse,
  SaleOrderStatus,
  SalesDocEvent,
  SalesDocKind,
  SalesDocMeta,
} from "../../lib/types-sales-docs";

type IconT = React.ComponentType<{ className?: string }>;

const PROFORMA: Record<ProformaDisplayStatus, { tone: StatusTone; icon: IconT }> = {
  draft: { tone: "neutral", icon: FilePenLineIcon },
  issued: { tone: "info", icon: SendIcon },
  expired: { tone: "warning", icon: AlertTriangleIcon },
  converted: { tone: "brand", icon: ReceiptIndianRupeeIcon },
  cancelled: { tone: "neutral", icon: BanIcon },
};
const ORDER: Record<SaleOrderStatus, { tone: StatusTone; icon: IconT }> = {
  open: { tone: "info", icon: CircleDotIcon },
  partly_delivered: { tone: "warning", icon: TruckIcon },
  delivered: { tone: "success", icon: PackageCheckIcon },
  invoiced: { tone: "brand", icon: ReceiptIndianRupeeIcon },
  cancelled: { tone: "neutral", icon: BanIcon },
};
const CHALLAN: Record<ChallanStatus, { tone: StatusTone; icon: IconT }> = {
  issued: { tone: "info", icon: TruckIcon },
  partly_returned: { tone: "warning", icon: Undo2Icon },
  returned: { tone: "success", icon: RotateCcwIcon },
  invoiced: { tone: "brand", icon: ReceiptIndianRupeeIcon },
  cancelled: { tone: "neutral", icon: BanIcon },
};

/** Status of a proforma, sale order or challan as a pill (icon + label, never colour alone). */
export function SalesDocStatusPill({ kind, status, size, className }: { kind: SalesDocKind; status: string; size?: "sm" | "md"; className?: string }) {
  const { t } = useI18n();
  const map = (kind === "proforma" ? PROFORMA : kind === "sale_order" ? ORDER : CHALLAN) as Record<string, { tone: StatusTone; icon: IconT }>;
  const s = map[status] ?? { tone: "neutral" as StatusTone, icon: CircleDotIcon };
  return (
    <StatusPill tone={s.tone} icon={s.icon} size={size} className={cn(status === "cancelled" && "text-muted-foreground", className)}>
      {t(`billing.sd.status.${kind}.${status}`)}
    </StatusPill>
  );
}

/** "On approval", "Job work" ... */
export function useReasonLabel(): (r: ChallanReason) => string {
  const { t } = useI18n();
  return React.useCallback((r) => t(`billing.sd.reason.${r}`), [t]);
}

/** "24 Oct 2026, 5:41 pm" in the UI's language. */
export function useDateTime(): (d: Date | string | number) => string {
  const { formatDate } = useI18n();
  return React.useCallback((d) => formatDate(d, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }), [formatDate]);
}

const qtyFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
export const qtyText = (n: number) => qtyFmt.format(n);

type DocLike = PublicSalesDocResponse["doc"];

/**
 * What the on-screen document prints for a proforma, sale order or challan (the PDF prints the same; see
 * packages/documents/src/renderers/sales-doc.ts).
 */
export function useSalesDocMeta(): (d: DocLike) => SalesDocMeta {
  const { t, formatDate } = useI18n();
  const reason = useReasonLabel();
  return React.useCallback(
    (d) => {
      const date = (v: string | null | undefined) => (v ? formatDate(v) : "");
      const stamp = d.status === "cancelled" ? t("billing.sd.status.proforma.cancelled") : d.status === "expired" ? t("billing.sd.status.proforma.expired") : d.kind === "proforma" && d.status === "converted" ? t("billing.sd.doc.billed") : null;
      const advanceRows = (): [string, string][] => {
        const out: [string, string][] = [];
        if (d.advancePercent && (d.advanceAmount ?? 0) > 0) out.push([`${t("billing.sd.doc.advanceAsked")} (${d.advancePercent}%)`, money(d.advanceAmount!)]);
        if ((d.advanceReceived ?? 0) > 0) {
          out.push([t("billing.sd.doc.advanceReceived"), money(d.advanceReceived!)]);
          out.push([t("billing.sd.doc.balanceAfterAdvance"), money(Math.max(d.totals.total - d.advanceReceived!, 0))]);
        }
        return out;
      };
      if (d.kind === "proforma") {
        const meta: [string, string][] = [];
        if (d.validUntil) meta.push([t("billing.sd.doc.validUntil"), date(d.validUntil)]);
        if (d.quotationNumber) meta.push([t("billing.sd.doc.againstQuotation"), d.quotationNumber]);
        return {
          title: t("billing.sd.doc.proformaTitle"),
          numberLabel: t("billing.sd.doc.proformaNo"),
          forLabel: t("billing.doc.billTo"),
          meta,
          totals: advanceRows(),
          blocks: d.deliveryText ? [{ label: t("billing.sd.doc.delivery"), text: d.deliveryText }] : [],
          terms: d.terms,
          note: t("billing.sd.doc.proformaNote"),
          stamp,
          showBank: true,
          receiverSign: null,
        };
      }
      if (d.kind === "sale_order") {
        const meta: [string, string][] = [];
        if (d.promisedDate) meta.push([t("billing.sd.doc.promisedDate"), date(d.promisedDate)]);
        if (d.customerRef) meta.push([t("billing.sd.doc.customerRef"), d.customerRef]);
        if (d.quotationNumber) meta.push([t("billing.sd.doc.againstQuotation"), d.quotationNumber]);
        const delivered = (d.progress ?? []).some((p) => p.delivered > 0);
        return {
          title: t("billing.sd.doc.orderTitle"),
          numberLabel: t("billing.sd.doc.orderNo"),
          forLabel: t("billing.sd.doc.orderFrom"),
          meta,
          totals: advanceRows(),
          blocks: delivered
            ? [{ label: t("billing.sd.doc.deliveryStatus"), text: (d.progress ?? []).map((p) => `${p.description}: ${qtyText(p.delivered)} / ${qtyText(p.ordered)} ${p.unit ?? ""}`.trim()).join("\n") }]
            : [],
          terms: d.terms,
          note: t("billing.sd.doc.orderNote"),
          stamp: d.status === "cancelled" ? t("billing.sd.status.sale_order.cancelled") : null,
          showBank: true,
          receiverSign: null,
        };
      }
      const meta: [string, string][] = [[t("billing.sd.doc.purpose"), d.reason ? reason(d.reason) : ""]];
      if (d.returnBy) meta.push([t("billing.sd.doc.returnBy"), date(d.returnBy)]);
      if (d.saleOrderNumber) meta.push([t("billing.sd.doc.saleOrder"), d.saleOrderNumber]);
      if (d.ewbNo) meta.push([t("billing.sd.doc.ewbNo"), d.ewbNo]);
      if (d.ewbDate) meta.push([t("billing.sd.doc.ewbDate"), date(d.ewbDate)]);
      if (d.invoiceNumber) meta.push([t("billing.sd.doc.billNo"), d.invoiceNumber]);
      const tr = d.transport ?? {};
      const transport = [
        tr.mode ? `${t("billing.sd.transport.mode")}: ${t(`billing.sd.transport.modes.${tr.mode}`)}` : null,
        tr.transporterName || tr.transporterId ? `${t("billing.sd.transport.transporter")}: ${[tr.transporterName, tr.transporterId].filter(Boolean).join(" · ")}` : null,
        tr.vehicleNo ? `${t("billing.sd.transport.vehicle")}: ${tr.vehicleNo}` : null,
        tr.docNo ? `${t("billing.sd.transport.lr")}: ${[tr.docNo, tr.docDate ? date(tr.docDate) : null].filter(Boolean).join(" · ")}` : null,
        tr.distanceKm ? `${t("billing.sd.transport.distance")}: ${tr.distanceKm}` : null,
      ].filter(Boolean);
      const blocks: SalesDocMeta["blocks"] = [];
      if (d.shipTo) blocks.push({ label: t("billing.sd.doc.shipTo"), text: d.shipTo });
      if (transport.length) blocks.push({ label: t("billing.sd.doc.transport"), text: transport.join("\n") });
      if (d.returned?.length) blocks.push({ label: t("billing.sd.doc.returned"), text: d.returned.map((r) => `${r.description}: ${qtyText(r.qty)} ${r.unit ?? ""}`.trim()).join("\n") });
      return {
        title: t("billing.sd.doc.challanTitle"),
        numberLabel: t("billing.sd.doc.challanNo"),
        forLabel: t("billing.sd.doc.consignee"),
        meta,
        totals: [],
        blocks,
        terms: d.terms,
        note: t("billing.sd.doc.challanNote"),
        stamp: d.status === "cancelled" ? t("billing.sd.status.challan.cancelled") : null,
        showBank: false,
        receiverSign: { text: t("billing.sd.doc.receivedGoods"), label: t("billing.sd.doc.receiverSign") },
        totalLabel: t("billing.sd.doc.goodsValue"),
      };
    },
    [t, formatDate, reason],
  );
}

const EVENT_ICON: Record<SalesDocEvent["type"], IconT> = {
  created: FilePenLineIcon,
  edited: PencilIcon,
  issued: CheckCircle2Icon,
  sent: SendIcon,
  advance: HandCoinsIcon,
  converted: ReceiptIndianRupeeIcon,
  delivered: TruckIcon,
  invoiced: ReceiptIndianRupeeIcon,
  returned: Undo2Icon,
  cancelled: BanIcon,
  reopened: RotateCcwIcon,
};

/** Newest first: what happened to the document and who did it. */
export function SalesDocTimeline({ events }: { events: SalesDocEvent[] }) {
  const { t } = useI18n();
  const formatDateTime = useDateTime();
  if (events.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="icon-chip size-8 text-primary">
            <HistoryIcon className="size-4" />
          </span>
          {t("billing.sd.timeline")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3">
          {[...events].reverse().map((e, i) => {
            const Icon = EVENT_ICON[e.type] ?? CircleDotIcon;
            return (
              <li key={`${e.at}-${i}`} className="flex gap-2.5 text-sm">
                <span className={e.type === "cancelled" ? "mt-0.5 text-danger-ink" : "mt-0.5 text-muted-foreground"}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{t(`billing.sd.event.${e.type}`)}</p>
                  <p className="text-meta text-muted-foreground">{formatDateTime(e.at)}</p>
                  {e.note && <p className="text-meta break-words text-muted-foreground">{e.note === "link" ? t("billing.sd.event.viaLink") : e.note}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

export function SideRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
