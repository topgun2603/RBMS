"use client";

import * as React from "react";
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Switch,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { ApiError, describeError, useI18n } from "@srirealtime/web";
import { rupeesToPaise } from "../lib/format";
import { useItemSettings, useReceiveUnits } from "../lib/queries";
import { parseAndCheck, type ParsedRow, type RowCode } from "../lib/serial";
import type { RejectedRow, ShopItem } from "../lib/types";
import { InlineError } from "./bits";
import { ItemPicker } from "./pickers";

const MAX_UNITS = 500;

/** Rows the API refused (400 `details.rows`), keyed by row index. */
function rejectedRows(err: unknown): Map<number, RejectedRow[]> | null {
  if (!(err instanceof ApiError) || err.status !== 400) return null;
  const rows = (err.details as { rows?: RejectedRow[] } | undefined)?.rows;
  if (!Array.isArray(rows)) return null;
  const out = new Map<number, RejectedRow[]>();
  for (const r of rows) out.set(r.index, [...(out.get(r.index) ?? []), r]);
  return out;
}

/**
 * Receive units of one item: paste or scan serials one per line (a scanner's Enter starts the next line). Phones with
 * two IMEIs: switch on pairing and put IMEI 1 and IMEI 2 on one line (tab, comma or space between). Rows are checked as
 * you type (format, IMEI check digit, repeats); serials already on record come back from the server per row.
 */
export function ReceiveDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const receive = useReceiveUnits();
  const [item, setItem] = React.useState<ShopItem | null>(null);
  const settings = useItemSettings(item?.id ?? null);
  const [dual, setDual] = React.useState(false);
  const [text, setText] = React.useState("");
  const [purchaseRef, setPurchaseRef] = React.useState("");
  const [supplier, setSupplier] = React.useState("");
  const [cost, setCost] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rejected, setRejected] = React.useState<Map<number, RejectedRow[]> | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setItem(null);
    setDual(false);
    setText("");
    setPurchaseRef("");
    setSupplier("");
    setCost("");
    setSubmitted(false);
    setError(null);
    setRejected(null);
  }, [open]);

  // The item's own setting picks the mode (phones: two IMEIs).
  React.useEffect(() => {
    if (settings.data) setDual(settings.data.dualImei);
  }, [settings.data]);

  const rows = React.useMemo(() => parseAndCheck(text, dual), [text, dual]);
  const withServer: ParsedRow[] = React.useMemo(
    () =>
      rows.map((r, i) => {
        const extra = rejected?.get(i)?.filter((x) => x.code === "exists" && (x.field === "serial" ? x.value === r.serial : x.value === r.serial2)) ?? [];
        return extra.length ? { ...r, problems: [...r.problems, ...extra.map((x) => ({ field: x.field, code: x.code as RowCode }))] } : r;
      }),
    [rows, rejected],
  );
  const bad = withServer.filter((r) => r.problems.length > 0);
  const costPaise = cost ? rupeesToPaise(cost) : null;
  const errors = {
    item: !item ? t("serials.common.required") : null,
    units: rows.length === 0 ? t("serials.receive.noneYet") : rows.length > MAX_UNITS ? t("serials.receive.tooMany", { max: MAX_UNITS }) : null,
    cost: cost && costPaise === null ? t("serials.common.amountInvalid") : null,
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (Object.values(errors).some(Boolean) || bad.length > 0 || !item) return;
    try {
      const r = await receive.mutateAsync({
        itemId: item.id,
        itemName: item.name,
        units: rows.map((x) => ({ serial: x.serial, serial2: x.serial2 })),
        purchaseRef: purchaseRef.trim() || null,
        supplier: supplier.trim() || null,
        costPaise,
      });
      toast.success(t("serials.receive.done", { count: r.received, item: item.name }));
      onOpenChange(false);
    } catch (err) {
      const rej = rejectedRows(err);
      setRejected(rej);
      setError(describeError(err, t));
    }
  };

  const problemLabel = (code: RowCode) => t(`serials.receive.problems.${code}`);
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  const shown = [...bad, ...withServer.filter((r) => r.problems.length === 0)].slice(0, 200);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("serials.common.close")} className="sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("serials.receive.title")}</DialogTitle>
            <DialogDescription>{t("serials.receive.body")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <Field invalid={!!err("item")}>
            <FieldLabel>{t("serials.receive.item")}</FieldLabel>
            <ItemPicker value={item} onChange={setItem} invalid={!!err("item")} autoFocus />
            <FieldError>{err("item")}</FieldError>
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{t("serials.receive.dual")}</span>
              <span className="text-meta text-muted-foreground">{t("serials.receive.dualHint")}</span>
            </span>
            <Switch checked={dual} onCheckedChange={setDual} aria-label={t("serials.receive.dual")} />
          </label>
          <Field invalid={!!err("units")}>
            <FieldLabel>{dual ? t("serials.receive.serialsDual") : t("serials.receive.serials")}</FieldLabel>
            <FieldControl>
              <Textarea
                rows={7}
                className="font-mono text-sm"
                spellCheck={false}
                autoCapitalize="characters"
                placeholder={dual ? t("serials.receive.placeholderDual") : t("serials.receive.placeholder")}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setRejected(null);
                }}
              />
            </FieldControl>
            <FieldHint>{t("serials.receive.serialsHint")}</FieldHint>
            <FieldError>{err("units")}</FieldError>
          </Field>

          {rows.length > 0 && (
            <div className="grid gap-2">
              <p className="text-sm">
                <span className="font-semibold tabular-nums">{t("serials.receive.ready", { count: rows.length - bad.length })}</span>
                {bad.length > 0 && <span className="font-semibold text-destructive tabular-nums"> · {t("serials.receive.problemCount", { count: bad.length })}</span>}
              </p>
              <ul className="grid max-h-56 gap-0.5 overflow-auto rounded-md border p-1" aria-label={t("serials.receive.checkList")}>
                {shown.map((r, i) => (
                  <li key={`${r.line}-${r.serial}-${i}`} className={cn("flex items-start gap-2 rounded-sm px-2 py-1 text-sm", r.problems.length > 0 && "bg-destructive/8")}>
                    {r.problems.length > 0 ? <XIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden /> : <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />}
                    <span className="w-10 shrink-0 text-meta text-muted-foreground tabular-nums">{t("serials.receive.line", { line: r.line })}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-mono break-all">
                        {r.serial || "—"}
                        {r.serial2 && <span className="text-muted-foreground"> / {r.serial2}</span>}
                      </span>
                      {r.problems.map((p, j) => (
                        <span key={j} className="block text-meta text-destructive">
                          {p.field === "serial2" ? `${t("serials.common.imei2")}: ` : ""}
                          {problemLabel(p.code)}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel>{t("serials.receive.purchaseRef")}</FieldLabel>
              <FieldControl>
                <Input value={purchaseRef} maxLength={60} onChange={(e) => setPurchaseRef(e.target.value)} />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{t("serials.receive.supplier")}</FieldLabel>
              <FieldControl>
                <Input value={supplier} maxLength={200} onChange={(e) => setSupplier(e.target.value)} />
              </FieldControl>
            </Field>
            <Field invalid={!!err("cost")}>
              <FieldLabel>{t("serials.receive.cost")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={cost} placeholder="₹" onChange={(e) => setCost(e.target.value)} />
              </FieldControl>
              <FieldHint>{t("serials.receive.costHint")}</FieldHint>
              <FieldError>{err("cost")}</FieldError>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("serials.common.cancel")}
            </Button>
            <Button type="submit" disabled={receive.isPending || (submitted && bad.length > 0)}>
              {receive.isPending && <Loader2Icon className="animate-spin" />}
              {t("serials.receive.cta", { count: rows.length })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
