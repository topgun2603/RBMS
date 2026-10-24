"use client";

import * as React from "react";
import { PencilIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { Button, Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, Skeleton, toast } from "@srirealtime/ui";
import { ConfirmDialog, DetailRow, PriceBreakupButton, describeError, useI18n } from "@srirealtime/web";
import { grams, money } from "../lib/format";
import { usePieceActions, usePiecePrice } from "../lib/queries";
import type { Piece } from "../lib/types";
import { BreakdownList, InlineError, PieceStatusPill, useMetalLabel } from "./bits";

/** A piece's details and today's price breakdown, with edit / sold / reprice / delete for managers. */
export function PieceSheet({ piece, onOpenChange, onEdit, canManage }: { piece: Piece | null; onOpenChange: (o: boolean) => void; onEdit: (p: Piece) => void; canManage: boolean }) {
  const { t, formatDate } = useI18n();
  const metalLabel = useMetalLabel();
  const price = usePiecePrice(piece?.id ?? null);
  const a = usePieceActions();
  const [deleting, setDeleting] = React.useState(false);
  const p = price.data?.piece ?? piece;

  const making = (x: Piece) =>
    x.makingType === "per_gram"
      ? t("jewellery.making.perGramValue", { amount: money(x.makingValue) })
      : x.makingType === "percent"
        ? `${x.makingValue / 100}%`
        : money(x.makingValue);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Sheet open={!!piece} onOpenChange={onOpenChange}>
      <SheetContent closeLabel={t("jewellery.common.close")} className="w-full overflow-y-auto sm:max-w-md">
        {p && (
          <>
            <SheetHeader>
              <SheetTitle>{p.name}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                {metalLabel(p.metal, p.purity)} <PieceStatusPill status={p.status} />
              </SheetDescription>
            </SheetHeader>
            <div className="grid gap-5 px-4">
              <div className="divide-y">
                <DetailRow label={t("jewellery.piece.tagNo")}>{p.tagNo ?? "—"}</DetailRow>
                <DetailRow label={t("jewellery.piece.huid")}>{p.huid ? <span className="font-mono">{p.huid}</span> : "—"}</DetailRow>
                <DetailRow label={t("jewellery.piece.gross")}>{grams(p.grossWeight)}</DetailRow>
                <DetailRow label={t("jewellery.piece.stoneWeight")}>{grams(p.stoneWeight)}</DetailRow>
                <DetailRow label={t("jewellery.piece.net")}>{grams(p.netWeight)}</DetailRow>
                <DetailRow label={t("jewellery.piece.wastage")}>{p.wastagePct}%</DetailRow>
                <DetailRow label={t("jewellery.piece.making")}>{making(p)}</DetailRow>
              </div>
              <div className="rounded-md border p-4">
                <p className="mb-2 text-sm font-medium">{t("jewellery.sheet.priceToday")}</p>
                {price.isPending ? (
                  <Skeleton className="h-40" />
                ) : price.isError ? (
                  <InlineError title={describeError(price.error, t)} />
                ) : price.data?.breakdown ? (
                  <>
                    <BreakdownList b={price.data.breakdown} />
                    {price.data.rate?.date && (
                      <p className="mt-2 text-meta text-muted-foreground">{t("jewellery.sheet.rateOf", { date: formatDate(price.data.rate.date) })}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("jewellery.piece.noRate", { metal: metalLabel(p.metal, p.purity) })}</p>
                )}
                {price.data?.breakdown && <PriceBreakupButton pieceId={p.id} className="mt-3" />}
                {p.lastPrice != null && (
                  <p className="mt-2 text-meta text-muted-foreground">
                    {t("jewellery.sheet.catalogue", { price: money(p.lastPrice) })}
                    {p.priceUpdatedAt ? ` · ${formatDate(p.priceUpdatedAt)}` : ""}
                  </p>
                )}
              </div>
            </div>
            {canManage && (
              <SheetFooter className="flex-row flex-wrap gap-2">
                <Button variant="outline" onClick={() => onEdit(p)}>
                  <PencilIcon /> {t("jewellery.common.edit")}
                </Button>
                <Button
                  variant="outline"
                  disabled={a.status.isPending}
                  onClick={() =>
                    run(
                      () => a.status.mutateAsync({ id: p.id, status: p.status === "sold" ? "in_stock" : "sold" }),
                      p.status === "sold" ? t("jewellery.sheet.markedInStock") : t("jewellery.sheet.markedSold"),
                    )
                  }
                >
                  {p.status === "sold" ? t("jewellery.sheet.markInStock") : t("jewellery.sheet.markSold")}
                </Button>
                <Button variant="outline" disabled={a.reprice.isPending} onClick={() => run(() => a.reprice.mutateAsync({ pieceId: p.id }), t("jewellery.sheet.repriced"))}>
                  <RefreshCwIcon /> {t("jewellery.sheet.reprice")}
                </Button>
                <Button variant="ghost" className="text-destructive" onClick={() => setDeleting(true)}>
                  <Trash2Icon /> {t("jewellery.common.delete")}
                </Button>
              </SheetFooter>
            )}
            <ConfirmDialog
              open={deleting}
              onOpenChange={setDeleting}
              destructive
              title={t("jewellery.sheet.deleteTitle", { name: p.name })}
              description={t("jewellery.sheet.deleteBody")}
              confirmLabel={t("jewellery.common.delete")}
              onConfirm={async () => {
                try {
                  await a.remove.mutateAsync(p.id);
                  toast.success(t("jewellery.sheet.deleted"));
                  setDeleting(false);
                  onOpenChange(false);
                } catch (err) {
                  toast.error(describeError(err, t));
                }
              }}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
