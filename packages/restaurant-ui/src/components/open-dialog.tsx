"use client";

import * as React from "react";
import { Loader2Icon, MinusIcon, PlusIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldLabel,
  Input,
} from "@srirealtime/ui";
import { describeError, useI18n, useModuleNavigate } from "@srirealtime/web";
import { useOpenOrder } from "../lib/queries";
import type { DiningTable, OrderType } from "../lib/types";
import { InlineError } from "./bits";

/**
 * Opens an order: a free table (guests) or a takeaway / delivery (name and phone, optional). Goes to the order screen.
 * A table someone else opened a moment ago goes to that order instead.
 */
export function OpenDialog({
  open,
  onOpenChange,
  table,
  type,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  table?: DiningTable | null;
  type: OrderType;
}) {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const openOrder = useOpenOrder();
  const [guests, setGuests] = React.useState(2);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setGuests(Math.min(2, table?.seats ?? 2));
      setName("");
      setPhone("");
      setError(null);
    }
  }, [open, table]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const o = await openOrder.mutateAsync({
        type,
        tableId: table?.id ?? null,
        guests: table ? guests : null,
        customerName: name.trim() || null,
        customerPhone: phone.trim() || null,
      });
      onOpenChange(false);
      navigate(`orders/${o.id}`);
    } catch (err) {
      const existing = (err as { code?: string; details?: { orderId?: string } }).code === "table_busy" ? (err as { details?: { orderId?: string } }).details?.orderId : undefined;
      if (existing) {
        onOpenChange(false);
        navigate(`orders/${existing}`);
      } else setError(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("restaurant.common.close")} className="sm:max-w-sm">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{table ? t("restaurant.open.tableTitle", { table: table.name }) : t(`restaurant.open.${type}Title`)}</DialogTitle>
            <DialogDescription>{table ? t("restaurant.open.tableBody", { seats: table.seats }) : t("restaurant.open.takeawayBody")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          {table ? (
            <Field>
              <FieldLabel htmlFor={null}>{t("restaurant.open.guests")}</FieldLabel>
              <div className="flex items-center gap-3">
                <Button type="button" size="icon" variant="outline" aria-label={t("restaurant.common.less")} onClick={() => setGuests((g) => Math.max(1, g - 1))}>
                  <MinusIcon />
                </Button>
                <span className="w-10 text-center text-2xl font-semibold tabular-nums">{guests}</span>
                <Button type="button" size="icon" variant="outline" aria-label={t("restaurant.common.more")} onClick={() => setGuests((g) => Math.min(200, g + 1))}>
                  <PlusIcon />
                </Button>
              </div>
            </Field>
          ) : (
            <div className="grid gap-4">
              <Field>
                <FieldLabel>{t("restaurant.open.name")}</FieldLabel>
                <FieldControl>
                  <Input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
                </FieldControl>
              </Field>
              <Field>
                <FieldLabel>{t("restaurant.open.phone")}</FieldLabel>
                <FieldControl>
                  <Input inputMode="tel" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} />
                </FieldControl>
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("restaurant.common.cancel")}
            </Button>
            <Button type="submit" disabled={openOrder.isPending}>
              {openOrder.isPending && <Loader2Icon className="animate-spin" />}
              {t("restaurant.open.cta")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
