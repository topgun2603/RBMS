"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
  toast,
} from "@rbms/ui";
import { cleanQty } from "./stock-meta";
import { parseQty } from "../../lib/format";
import { describeError, useI18n } from "@rbms/web";
import { useUpdateStockSettings } from "../../lib/queries-v2";
import type { StockRow } from "../../lib/types";

/** Reorder level + "track stock" switch for one item. */
export function StockSettingsDialog({
  open,
  onOpenChange,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: StockRow | null;
}) {
  const { t } = useI18n();
  const update = useUpdateStockSettings();
  const [track, setTrack] = React.useState(true);
  const [level, setLevel] = React.useState("");

  React.useEffect(() => {
    if (!open || !row) return;
    setTrack(row.track !== false);
    setLevel(row.reorderLevel ? String(row.reorderLevel) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when (re)opened
  }, [open, row?.itemId]);

  const parsed = level.trim() ? parseQty(level) : 0;
  const invalid = parsed === null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!row || parsed === null) return;
    try {
      await update.mutateAsync({ itemId: row.itemId, body: { track, reorderLevel: parsed } });
      toast.success(t("billing.stock.settings.saved"));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !update.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.stock.settings.title")}</DialogTitle>
          <DialogDescription>{row?.name}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <div className="flex items-start justify-between gap-4 rounded-xl border border-card-ring bg-muted/30 p-3">
            <div className="grid gap-0.5">
              <Label htmlFor="stk-track">{t("billing.stock.settings.track")}</Label>
              <p className="text-meta text-muted-foreground">{t("billing.stock.settings.trackHint")}</p>
            </div>
            <Switch id="stk-track" checked={track} onCheckedChange={setTrack} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="stk-level">{t("billing.stock.settings.reorderLevel")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="stk-level"
                inputMode="decimal"
                autoComplete="off"
                className="text-right tabular-nums"
                placeholder="0"
                disabled={!track}
                value={level}
                aria-invalid={invalid}
                onChange={(e) => setLevel(cleanQty(e.target.value))}
              />
              <span className="shrink-0 text-sm text-muted-foreground">{row?.unit || "pcs"}</span>
            </div>
            <p className="text-meta text-muted-foreground">{t("billing.stock.settings.reorderHint")}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={update.isPending}>
              {t("billing.common.cancel")}
            </Button>
            <Button type="submit" size="lg" disabled={update.isPending || invalid || !row}>
              {update.isPending && <Loader2Icon className="animate-spin" />}
              {t("billing.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
