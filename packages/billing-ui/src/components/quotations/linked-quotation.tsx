"use client";

import * as React from "react";
import { ModuleLink, useFeature, useI18n } from "@srirealtime/web";
import { FileSignatureIcon, IndianRupeeIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Button } from "@srirealtime/ui";
import { useHasPermission } from "../../lib/access";
import { money } from "../../lib/format";
import { useLinkedQuotation } from "../../lib/queries-quotations";

/**
 * Shown on a bill made from a quotation: a link back to it and, when the quotation asked for an advance the bill hasn't
 * received yet, a shortcut to record it.
 */
export function LinkedQuotationBanner({
  invoiceId,
  paid,
  open,
  onRecordAdvance,
}: {
  invoiceId: string;
  paid: number;
  /** The bill is issued with a balance, so a payment can be recorded. */
  open: boolean;
  onRecordAdvance: (amount: number) => void;
}) {
  const { t } = useI18n();
  const on = useFeature("invoices.quotations");
  const allowed = useHasPermission("quotations.view");
  const linked = useLinkedQuotation(invoiceId, on && allowed);
  const q = linked.data;
  if (!q || q.kind !== "invoice") return null;
  const due = q.advanceAmount - paid;
  return (
    <Alert data-print-hide className="mb-4 border-primary/30 bg-primary/5">
      <FileSignatureIcon className="text-primary" />
      <AlertTitle>
        {t("billing.q.linked.title")}{" "}
        <ModuleLink to={`quotations/${q.id}`} className="font-mono underline-offset-4 hover:underline">
          {q.number}
          {q.rev > 1 ? ` (${t("billing.q.rev", { rev: q.rev })})` : ""}
        </ModuleLink>
      </AlertTitle>
      {q.advanceAmount > 0 && due > 0 && (
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>{t("billing.q.linked.advance", { amount: money(q.advanceAmount), pct: q.advancePercent ?? 0 })}</span>
          {open && (
            <Button size="sm" className="h-8" onClick={() => onRecordAdvance(due)}>
              <IndianRupeeIcon /> {t("billing.q.linked.record", { amount: money(due) })}
            </Button>
          )}
        </AlertDescription>
      )}
    </Alert>
  );
}
