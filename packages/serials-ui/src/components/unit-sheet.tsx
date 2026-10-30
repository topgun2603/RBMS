"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import { Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton, Textarea, toast } from "@rbms/ui";
import { DetailRow, describeError, useFeature, useI18n, usePermission } from "@rbms/web";
import { SERIALS_FEATURES, SERIALS_PERMISSIONS } from "../lib/access";
import { money } from "../lib/format";
import { useSetStatus, useUnit } from "../lib/queries";
import type { ManualStatus, SerialStatus } from "../lib/types";
import { BillLink, EventTimeline, InlineError, StatusChip, WarrantyPill } from "./bits";
import { ClaimForm } from "./claim-form";

/** Hand moves the API allows from each status (sales, cancellations and returns come from bills). */
export const NEXT_STATUSES: Record<SerialStatus, readonly ManualStatus[]> = {
  in_stock: ["defective", "written_off"],
  returned: ["in_stock", "defective", "written_off"],
  defective: ["in_stock", "written_off"],
  written_off: ["in_stock"],
  sold: [],
};

/** One unit: details, sale and warranty, history, and the status actions. */
export function UnitSheet({ unitId, onOpenChange }: { unitId: string | null; onOpenChange: (o: boolean) => void }) {
  const { t, formatDate } = useI18n();
  const q = useUnit(unitId);
  const canManage = usePermission(SERIALS_PERMISSIONS.manage);
  const warrantyOn = useFeature(SERIALS_FEATURES.warranty);
  const setStatus = useSetStatus(unitId ?? "");
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState<ManualStatus | null>(null);

  React.useEffect(() => {
    setNote("");
    setPending(null);
  }, [unitId]);

  const move = async (status: ManualStatus) => {
    setPending(status);
    try {
      await setStatus.mutateAsync({ status, note: note.trim() || null });
      toast.success(t("serials.unit.moved", { status: t(`serials.status.${status}`) }));
      setNote("");
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setPending(null);
    }
  };

  const u = q.data;
  const next = u ? NEXT_STATUSES[u.status] : [];
  return (
    <Sheet open={!!unitId} onOpenChange={onOpenChange}>
      <SheetContent closeLabel={t("serials.common.close")} className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-mono break-all">{u?.serial ?? t("serials.unit.title")}</SheetTitle>
          <SheetDescription>{u?.itemName ?? null}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-6 px-4 pb-6">
          {q.isError ? (
            <InlineError title={describeError(q.error, t)} />
          ) : !u ? (
            <div className="grid gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={u.status} />
                {u.status === "sold" && <WarrantyPill status={u.warrantyStatus} end={u.warrantyEnd} daysLeft={u.warrantyDaysLeft} />}
              </div>
              <div className="grid divide-y">
                {u.serial2 && <DetailRow label={t("serials.common.imei2")}>{<span className="font-mono">{u.serial2}</span>}</DetailRow>}
                <DetailRow label={t("serials.unit.received")}>{formatDate(u.receivedAt)}</DetailRow>
                {u.purchaseRef && <DetailRow label={t("serials.unit.purchaseRef")}>{u.purchaseRef}</DetailRow>}
                {u.supplier && <DetailRow label={t("serials.unit.supplier")}>{u.supplier}</DetailRow>}
                {u.costPaise != null && <DetailRow label={t("serials.unit.cost")}>{money(u.costPaise)}</DetailRow>}
                {u.invoiceNumber && <DetailRow label={t("serials.unit.bill")}>{<BillLink id={u.invoiceId} number={u.invoiceNumber} />}</DetailRow>}
                {u.soldOn && <DetailRow label={t("serials.unit.soldOn")}>{formatDate(u.soldOn)}</DetailRow>}
                {u.customerName && <DetailRow label={t("serials.unit.customer")}>{[u.customerName, u.customerPhone].filter(Boolean).join(" · ")}</DetailRow>}
                <DetailRow label={t("serials.unit.warrantyMonths")}>{t("serials.common.months", { count: u.warrantyMonths })}</DetailRow>
              </div>

              {canManage && next.length > 0 && (
                <section className="grid gap-2">
                  <h3 className="text-sm font-semibold">{t("serials.unit.actions")}</h3>
                  <Textarea rows={2} maxLength={500} value={note} placeholder={t("serials.unit.notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    {next.map((s) => (
                      <Button key={s} size="sm" variant={s === "in_stock" ? "default" : "outline"} disabled={!!pending} onClick={() => move(s)}>
                        {pending === s && <Loader2Icon className="animate-spin" />}
                        {t(`serials.unit.to.${s}`)}
                      </Button>
                    ))}
                  </div>
                </section>
              )}

              {warrantyOn && u.status === "sold" && <ClaimForm unitId={u.id} />}

              <section className="grid gap-3">
                <h3 className="text-sm font-semibold">{t("serials.unit.history")}</h3>
                <EventTimeline events={u.events} />
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
