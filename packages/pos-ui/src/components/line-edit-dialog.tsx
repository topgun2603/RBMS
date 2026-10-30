"use client";

import * as React from "react";
import { LockIcon } from "lucide-react";
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
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
} from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { lineAmount } from "@rbms/gst";
import { cartLineGstRate, clampDiscount, percentDiscount, type CartLine } from "../lib/cart";
import { money, paiseToInput, parseQty, rupeesToPaise } from "../lib/format";
import { usePos } from "./pos-context";
import { boxesToCover, setLineUnit } from "../lib/units";

export interface LineEdit {
  qty: number;
  price: number;
  discount: number;
  /** A different unit picked for the line (box instead of pieces); applied before qty and price. */
  unit?: string;
}

/** Quantity, price (needs invoices.discount) and line discount in ₹ or % (needs invoices.discount). */
export function LineEditDialog({ line, onClose, onSave }: { line: CartLine | null; onClose: () => void; onSave: (key: string, edit: LineEdit) => void }) {
  const { t } = useI18n();
  const { can } = usePos();
  const [qty, setQty] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [disc, setDisc] = React.useState("");
  const [mode, setMode] = React.useState<"amount" | "percent">("amount");
  const [touched, setTouched] = React.useState(false);
  const [unit, setUnit] = React.useState("");
  const [area, setArea] = React.useState("");
  const [wastage, setWastage] = React.useState("10");

  React.useEffect(() => {
    if (!line) return;
    setUnit(line.unit);
    setArea("");
    setQty(String(line.qty));
    setPrice(paiseToInput(line.price));
    setDisc(line.discount ? paiseToInput(line.discount) : "");
    setMode("amount");
    setTouched(false);
  }, [line]);

  if (!line) return <Dialog open={false} />;

  const q = parseQty(qty);
  const p = can.price || (unit && unit !== line.unit) ? rupeesToPaise(price) : line.price;
  const pct = mode === "percent" ? Number(disc || "0") : null;
  const pctOk = pct === null || (Number.isFinite(pct) && pct >= 0 && pct <= 100);
  const rawDisc = !can.discount ? line.discount : mode === "amount" ? (disc.trim() ? rupeesToPaise(disc) : 0) : null;
  const gross = q !== null && p !== null ? lineAmount(q, p) : 0;
  const discount =
    !can.discount ? clampDiscount(line.discount, gross) : mode === "percent" ? (pctOk && q !== null && p !== null ? percentDiscount({ qty: q, price: p }, pct ?? 0) : null) : rawDisc;
  const discTooBig = discount !== null && rawDisc !== null && rawDisc > gross;
  const valid = q !== null && p !== null && discount !== null && pctOk && !discTooBig;

  // Tiles and flooring: type the room's area, get the boxes (stock moves by box).
  const cover = boxesToCover(line, Number(area), "sqft", Number(wastage));
  const useCover = () => {
    if (!cover) return;
    const next = setLineUnit([line], line.key, cover.unit)[0]!;
    setUnit(cover.unit);
    setPrice(paiseToInput(next.price));
    setQty(String(cover.qty));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    onSave(line.key, { qty: q!, price: p!, discount: discount!, ...(unit && unit !== line.unit ? { unit } : {}) });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("pos.common.close")}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle className="line-clamp-2 leading-snug">{line.name}</DialogTitle>
            <DialogDescription>
              {t("pos.edit.listPrice", { price: money(line.listPrice), unit: line.unit })}
              {line.taxInclusive ? ` · ${t("pos.edit.inclGst", { rate: cartLineGstRate(line) })}` : ` · ${t("pos.edit.plusGst", { rate: cartLineGstRate(line) })}`}
            </DialogDescription>
          </DialogHeader>
          {line.units?.length && !line.ticket ? (
            <Field>
              <FieldLabel>{t("pos.edit.unit")}</FieldLabel>
              <Select
                value={unit}
                onValueChange={(v) => {
                  setUnit(v);
                  // The price follows the unit (scaled when it was changed by hand).
                  const next = setLineUnit([line], line.key, v)[0]!;
                  setPrice(paiseToInput(next.price));
                }}
              >
                <SelectTrigger size="lg" className="w-full" aria-label={t("pos.edit.unit")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={line.baseUnit ?? line.unit}>{line.baseUnit ?? line.unit}</SelectItem>
                  {line.units.map((u) => (
                    <SelectItem key={u.unit} value={u.unit}>
                      {t("pos.edit.unitOption", { unit: u.unit, factor: u.factor, base: line.baseUnit ?? "" })} · {money(u.price)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          {boxesToCover(line, 1) && !line.ticket ? (
            <FieldRow cols={3}>
              <Field>
                <FieldLabel>{t("pos.edit.area")}</FieldLabel>
                <FieldControl>
                  <InputGroup size="lg">
                    <InputGroupInput value={area} onChange={(e) => setArea(e.target.value)} inputMode="decimal" aria-label={t("pos.edit.area")} />
                    <InputGroupAddon>{t("pos.edit.sqft")}</InputGroupAddon>
                  </InputGroup>
                </FieldControl>
              </Field>
              <Field>
                <FieldLabel>{t("pos.edit.wastage")}</FieldLabel>
                <FieldControl>
                  <InputGroup size="lg">
                    <InputGroupInput value={wastage} onChange={(e) => setWastage(e.target.value)} inputMode="decimal" aria-label={t("pos.edit.wastage")} />
                    <InputGroupAddon>%</InputGroupAddon>
                  </InputGroup>
                </FieldControl>
              </Field>
              <Field>
                <FieldLabel>{t("pos.edit.boxesNeeded")}</FieldLabel>
                <Button type="button" variant="outline" size="lg" disabled={!cover} onClick={useCover}>
                  {cover ? t("pos.edit.useBoxes", { boxes: cover.qty, unit: cover.unit }) : "—"}
                </Button>
              </Field>
            </FieldRow>
          ) : null}
          <FieldRow cols={2}>
            <Field>
              <FieldLabel>{t("pos.edit.qty")}</FieldLabel>
              <FieldControl>
                <InputGroup size="lg">
                  <InputGroupInput value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" autoFocus onFocus={(e) => e.target.select()} />
                  <InputGroupAddon>{unit || line.unit}</InputGroupAddon>
                </InputGroup>
              </FieldControl>
              <FieldError>{touched && q === null ? t("pos.edit.qtyInvalid") : null}</FieldError>
            </Field>
            <Field>
              <FieldLabel aside={!can.price ? <LockIcon className="size-3.5" aria-label={t("pos.edit.locked")} /> : undefined}>{t("pos.edit.price")}</FieldLabel>
              <InputGroup size="lg">
                <InputGroupAddon>₹</InputGroupAddon>
                <FieldControl>
                  <InputGroupInput value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" disabled={!can.price} onFocus={(e) => e.target.select()} />
                </FieldControl>
              </InputGroup>
              {!can.price ? <FieldHint>{t("pos.edit.priceLocked")}</FieldHint> : null}
              <FieldError>{touched && p === null ? t("pos.edit.priceInvalid") : null}</FieldError>
            </Field>
          </FieldRow>
          <Field>
            <FieldLabel
              aside={
                can.discount ? (
                  <ToggleGroup
                    type="single"
                    size="sm"
                    variant="outline"
                    value={mode}
                    onValueChange={(v) => {
                      if (v === "amount" || v === "percent") {
                        setMode(v);
                        setDisc("");
                      }
                    }}
                    aria-label={t("pos.edit.discountMode")}
                  >
                    <ToggleGroupItem value="amount" className="h-7 px-2 text-xs">
                      ₹
                    </ToggleGroupItem>
                    <ToggleGroupItem value="percent" className="h-7 px-2 text-xs">
                      %
                    </ToggleGroupItem>
                  </ToggleGroup>
                ) : (
                  <LockIcon className="size-3.5" aria-label={t("pos.edit.locked")} />
                )
              }
            >
              {t("pos.edit.discount")}
            </FieldLabel>
            <InputGroup size="lg">
              <InputGroupAddon>{mode === "percent" ? "%" : "₹"}</InputGroupAddon>
              <FieldControl>
                <InputGroupInput value={disc} onChange={(e) => setDisc(e.target.value)} inputMode="decimal" disabled={!can.discount} placeholder="0" onFocus={(e) => e.target.select()} />
              </FieldControl>
            </InputGroup>
            {!can.discount ? (
              <FieldHint>{t("pos.edit.discountLocked")}</FieldHint>
            ) : discount !== null && discount > 0 ? (
              <FieldHint>{t("pos.edit.discountIs", { amount: money(discount), total: money(gross - discount) })}</FieldHint>
            ) : null}
            <FieldError>{touched && (discTooBig || discount === null || !pctOk) ? t("pos.edit.discountInvalid") : null}</FieldError>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={onClose}>
              {t("pos.common.cancel")}
            </Button>
            <Button type="submit" size="lg">
              {t("pos.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
