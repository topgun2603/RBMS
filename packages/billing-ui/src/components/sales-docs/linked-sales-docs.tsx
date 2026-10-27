"use client";

import { ModuleLink, useFeature, useI18n } from "@srirealtime/web";
import { FileBadgeIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@srirealtime/ui";
import { useHasPermission } from "../../lib/access";
import { money } from "../../lib/format";
import { useLinkedSalesDocs } from "../../lib/queries-sales-docs";

/** Shown on a bill made from a proforma invoice, sale order or delivery challans: links back to them. */
export function LinkedSalesDocsBanner({ invoiceId }: { invoiceId: string }) {
  const { t } = useI18n();
  const on = useFeature("invoices.sales-docs");
  const allowed = useHasPermission("sales-docs.view");
  const linked = useLinkedSalesDocs(invoiceId, on && allowed);
  const d = linked.data;
  if (!d || (!d.proforma && d.saleOrders.length === 0 && d.challans.length === 0)) return null;
  return (
    <Alert data-print-hide className="mb-4 border-primary/30 bg-primary/5">
      <FileBadgeIcon className="text-primary" />
      <AlertTitle>{t("billing.sd.linked.title")}</AlertTitle>
      <AlertDescription className="flex flex-wrap gap-x-4 gap-y-1">
        {d.proforma && (
          <span>
            {t("billing.sd.linked.proforma")}{" "}
            <ModuleLink to={`proformas/${d.proforma.id}`} className="font-mono underline-offset-4 hover:underline">
              {d.proforma.number}
            </ModuleLink>
            {d.proforma.advanceReceived > 0 ? ` · ${t("billing.sd.linked.advance", { amount: money(d.proforma.advanceReceived) })}` : ""}
          </span>
        )}
        {d.saleOrders.map((o) => (
          <span key={o.id}>
            {t("billing.sd.linked.order")}{" "}
            <ModuleLink to={`sale-orders/${o.id}`} className="font-mono underline-offset-4 hover:underline">
              {o.number}
            </ModuleLink>
          </span>
        ))}
        {d.challans.length > 0 && (
          <span>
            {t("billing.sd.linked.challans")}{" "}
            {d.challans.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ", "}
                <ModuleLink to={`challans/${c.id}`} className="font-mono underline-offset-4 hover:underline">
                  {c.number}
                </ModuleLink>
              </span>
            ))}
            {" · "}
            {t("billing.sd.linked.noStock")}
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}
