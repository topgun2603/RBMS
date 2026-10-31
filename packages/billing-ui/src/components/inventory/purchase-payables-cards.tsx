"use client";

import * as React from "react";
import { ConfirmDialog, describeError, ModuleLink, useI18n } from "@rbms/web";
import { HandCoinsIcon, Undo2Icon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, StatusPill, toast } from "@rbms/ui";
import { useHasPermission } from "../../lib/access";
import { formatQty, money } from "../../lib/format";
import { useCancelDebitNote, useDebitNotesOf, usePurchasePayments, useReversePayment } from "../../lib/queries-payables";
import type { PurchasePayment } from "../../lib/types-payables";

/** Payments made against one purchase bill, newest first, with reversal. */
export function PurchasePaymentsCard({ purchaseId, cancelled }: { purchaseId: string; cancelled: boolean }) {
  const { t, formatDate } = useI18n();
  const q = usePurchasePayments(purchaseId);
  const canPay = useHasPermission("inventory.purchases.pay");
  const reverse = useReversePayment();
  const [reversing, setReversing] = React.useState<PurchasePayment | null>(null);
  const items = q.data?.items ?? [];
  if (q.isPending || items.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <span className="icon-chip size-8 text-primary">
          <HandCoinsIcon className="size-4" />
        </span>
        <CardTitle className="text-sm">{t("billing.payables.paymentsOnBill")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className={p.reversedAt ? "text-muted-foreground line-through" : "font-medium"}>
                  {p.kind === "refund" ? t("billing.payables.refundRow", { amount: money(p.amount) }) : money(p.amount)} · {t(`billing.payables.modes.${p.mode}`)}
                </p>
                <p className="text-meta text-muted-foreground">
                  {formatDate(p.date)}
                  {p.reference ? ` · ${p.reference}` : ""}
                  {p.note ? ` · ${p.note}` : ""}
                </p>
              </div>
              {p.reversedAt ? (
                <StatusPill tone="neutral">{t("billing.payables.reversed")}</StatusPill>
              ) : (
                canPay &&
                !cancelled &&
                !p.debitNoteId && (
                  <Button size="sm" variant="ghost" onClick={() => setReversing(p)}>
                    <Undo2Icon /> {t("billing.payables.reverse")}
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
      </CardContent>
      <ConfirmDialog
        open={!!reversing}
        onOpenChange={(o) => !o && setReversing(null)}
        title={t("billing.payables.reverseTitle", { amount: money(reversing?.amount ?? 0) })}
        description={t("billing.payables.reverseOneBody")}
        confirmLabel={t("billing.payables.reverse")}
        onConfirm={async () => {
          if (!reversing) return;
          try {
            await reverse.mutateAsync({ id: reversing.id });
            toast.success(t("billing.payables.reversedToast"));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </Card>
  );
}

/** Debit notes (purchase returns) raised against one purchase bill. */
export function PurchaseReturnsCard({ purchaseId }: { purchaseId: string }) {
  const { t, formatDate } = useI18n();
  const q = useDebitNotesOf(purchaseId);
  const cancel = useCancelDebitNote();
  const [cancelling, setCancelling] = React.useState<{ id: string; number: string } | null>(null);
  const items = q.data?.items ?? [];
  if (q.isPending || items.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <span className="icon-chip size-8 text-primary">
          <Undo2Icon className="size-4" />
        </span>
        <CardTitle className="text-sm">{t("billing.payables.returnsOnBill")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className={d.status === "cancelled" ? "text-muted-foreground line-through" : "font-medium"}>
                  <span className="font-mono">{d.number}</span> · {money(d.total)}
                  {d.refundAmount > 0 ? ` · ${t("billing.payables.refundRow", { amount: money(d.refundAmount) })}` : ""}
                </p>
                <p className="text-meta text-muted-foreground">
                  {formatDate(d.date)} · {d.lines.map((l) => `${l.description} × ${formatQty(l.qty)}`).join(", ")}
                  {d.reason ? ` · ${d.reason}` : ""}
                </p>
              </div>
              {d.status === "cancelled" ? (
                <StatusPill tone="neutral">{t("billing.payables.cancelledNote")}</StatusPill>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setCancelling({ id: d.id, number: d.number })}>
                  {t("billing.payables.cancelNote")}
                </Button>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-meta">
          <ModuleLink to="debit-notes" className="text-primary hover:underline">
            {t("billing.payables.allDebitNotes")}
          </ModuleLink>
        </p>
      </CardContent>
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={t("billing.payables.cancelNoteTitle", { number: cancelling?.number ?? "" })}
        description={t("billing.payables.cancelNoteBody")}
        confirmLabel={t("billing.payables.cancelNote")}
        onConfirm={async () => {
          if (!cancelling) return;
          try {
            await cancel.mutateAsync(cancelling.id);
            toast.success(t("billing.payables.noteCancelled"));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </Card>
  );
}
