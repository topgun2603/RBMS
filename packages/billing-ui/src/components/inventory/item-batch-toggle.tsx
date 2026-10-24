"use client";

import * as React from "react";
import { CalendarClockIcon, PlusIcon } from "lucide-react";
import { Button, Label, Switch, toast } from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { BatchReceiveDialog } from "./batch-receive-dialog";
import { useItemTracking, useSetItemTracking } from "../../lib/queries-stock";

/** Item form: track this item batch by batch (batch number, expiry, oldest-first selling). */
export function ItemBatchToggle({ itemId, itemName, unit }: { itemId: string; itemName: string; unit?: string | null }) {
  const { t } = useI18n();
  const tracked = useItemTracking(itemId);
  const set = useSetItemTracking();
  const [receive, setReceive] = React.useState(false);
  const on = tracked.data === true;

  const change = async (enabled: boolean) => {
    try {
      await set.mutateAsync({ itemId, enabled });
      toast.success(enabled ? t("billing.batches.item.on") : t("billing.batches.item.off"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <div className="grid gap-2 rounded-xl border border-dashed bg-muted/30 p-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor="item-batches" className="flex items-center gap-2 text-sm font-medium">
            <span className="icon-chip size-7 text-primary">
              <CalendarClockIcon className="size-3.5" />
            </span>
            {t("billing.batches.item.toggle")}
          </Label>
          <p className="mt-1 text-meta text-muted-foreground">{t("billing.batches.item.hint")}</p>
        </div>
        <Switch id="item-batches" checked={on} disabled={tracked.isPending || set.isPending} onCheckedChange={change} />
      </div>
      {on && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setReceive(true)}>
            <PlusIcon /> {t("billing.batches.item.receive")}
          </Button>
        </div>
      )}
      <BatchReceiveDialog open={receive} onOpenChange={setReceive} item={{ id: itemId, name: itemName, unit }} />
    </div>
  );
}
