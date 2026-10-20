"use client";

import * as React from "react";
import { ExternalLinkIcon, Loader2Icon, PlusIcon, ReceiptIcon } from "lucide-react";
import {
  Button,
  ChipGroup,
  cn,
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
import { describeError, useI18n } from "@srirealtime/web";
import { restaurantConfig } from "../lib/config";
import { money, qty } from "../lib/format";
import { useOrderActions } from "../lib/queries";
import type { BillResult, Order } from "../lib/types";
import { InlineError } from "./bits";

/**
 * Bills the order: one bill, or a split (each line assigned to Bill 1, 2, …). Afterwards links to each bill to take
 * payment there. Amounts here are before GST; the bills add it.
 */
export function BillDialog({ open, onOpenChange, order }: { open: boolean; onOpenChange: (o: boolean) => void; order: Order }) {
  const { t } = useI18n();
  const { bill } = useOrderActions(order.id);
  const lines = order.items.filter((l) => l.status !== "cancelled");
  const [mode, setMode] = React.useState<"one" | "split">("one");
  const [count, setCount] = React.useState(2);
  const [assign, setAssign] = React.useState<Record<string, number>>({});
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [made, setMade] = React.useState<BillResult[] | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setMode("one");
    setCount(2);
    setAssign({});
    setName(order.customerName ?? "");
    setPhone(order.customerPhone ?? "");
    setError(null);
    setMade(null);
  }, [open, order.customerName, order.customerPhone]);

  const billOf = (id: string) => assign[id] ?? 1;
  const totals = Array.from({ length: count }, (_, i) => lines.filter((l) => billOf(l.id) === i + 1).reduce((s, l) => s + l.amount, 0));
  const empty = mode === "split" && totals.some((x) => x === 0);

  const submit = async () => {
    setError(null);
    const splits = mode === "split" ? Array.from({ length: count - 1 }, (_, i) => lines.filter((l) => billOf(l.id) === i + 1).map((l) => l.id)) : undefined;
    try {
      const r = await bill.mutateAsync({ splits, customer: name.trim() ? { name: name.trim(), phone: phone.trim() || null } : null });
      setMade(r.bills);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("restaurant.common.close")} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{made ? t("restaurant.bill.doneTitle") : t("restaurant.bill.title", { number: order.number })}</DialogTitle>
          <DialogDescription>{made ? t("restaurant.bill.doneBody") : t("restaurant.bill.body")}</DialogDescription>
        </DialogHeader>
        {error && <InlineError title={error} />}
        {made ? (
          <ul className="grid gap-2">
            {made.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <span className="inline-flex items-center gap-2 font-medium">
                  <ReceiptIcon className="size-4 text-primary" /> {b.number}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums">{money(b.total)}</span>
                  <Button size="sm" asChild>
                    <a href={restaurantConfig().invoiceHref(b.id)}>
                      {t("restaurant.bill.takePayment")} <ExternalLinkIcon />
                    </a>
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid gap-5">
            <ChipGroup
              aria-label={t("restaurant.bill.mode")}
              value={mode}
              onChange={setMode}
              options={[
                { value: "one", label: t("restaurant.bill.one") },
                { value: "split", label: t("restaurant.bill.split") },
              ]}
            />
            {mode === "split" && (
              <div className="grid gap-2">
                <ul className="grid max-h-72 gap-1 overflow-auto">
                  {lines.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 odd:bg-muted/40">
                      <span className="min-w-0 truncate text-sm">
                        {qty(l.qty)} × {l.name}
                      </span>
                      <span className="flex shrink-0 gap-1">
                        {Array.from({ length: count }, (_, i) => (
                          <button
                            key={i}
                            type="button"
                            aria-pressed={billOf(l.id) === i + 1}
                            onClick={() => setAssign((a) => ({ ...a, [l.id]: i + 1 }))}
                            className={cn(
                              "size-7 rounded-md border text-meta font-semibold tabular-nums",
                              billOf(l.id) === i + 1 ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                            )}
                          >
                            {i + 1}
                          </button>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="flex flex-wrap gap-x-4 gap-y-1">
                    {totals.map((v, i) => (
                      <span key={i} className={cn("tabular-nums", v === 0 && "text-destructive")}>
                        {t("restaurant.bill.billN", { n: i + 1 })}: <strong>{money(v)}</strong>
                      </span>
                    ))}
                  </span>
                  {count < Math.min(10, lines.length) && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setCount((c) => c + 1)}>
                      <PlusIcon /> {t("restaurant.bill.addBill")}
                    </Button>
                  )}
                </div>
                {empty && <p className="text-meta text-destructive">{t("restaurant.bill.emptyBill")}</p>}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>{t("restaurant.open.name")}</FieldLabel>
                <FieldControl>
                  <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
                </FieldControl>
              </Field>
              <Field>
                <FieldLabel>{t("restaurant.open.phone")}</FieldLabel>
                <FieldControl>
                  <Input inputMode="tel" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} />
                </FieldControl>
              </Field>
            </div>
            <p className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("restaurant.bill.beforeGst")}</span>
              <span className="text-base font-semibold tabular-nums">{money(lines.reduce((s, l) => s + l.amount, 0))}</span>
            </p>
          </div>
        )}
        <DialogFooter>
          {made ? (
            <Button onClick={() => onOpenChange(false)}>{t("restaurant.common.done")}</Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("restaurant.common.cancel")}
              </Button>
              <Button onClick={submit} disabled={bill.isPending || empty || lines.length === 0}>
                {bill.isPending && <Loader2Icon className="animate-spin" />}
                {mode === "split" ? t("restaurant.bill.makeN", { count }) : t("restaurant.bill.make")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
