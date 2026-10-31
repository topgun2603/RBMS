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
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@rbms/ui";
import { describeError, HuidPhotoButton, useI18n } from "@rbms/web";
import { decimalInput, paiseToInput, parseDecimal, rupeesToPaise } from "../lib/format";
import { isPurityOf, isValidHuid, MAKING_TYPES, METALS, normalizeHuid, PURITIES, priceBreakdown, rateOf, type MakingType, type Metal, type Purity } from "../lib/pricing";
import { useJewellerySettings, useRates, useSavePiece } from "../lib/queries";
import type { Piece, ShopItem } from "../lib/types";
import { BreakdownList, InlineError, useMetalLabel } from "./bits";
import { ItemPicker } from "./pickers";

/** The making value as typed: ₹ per gram, percent, or ₹ flat. */
const makingToInput = (type: MakingType, v: number) => (type === "percent" ? String(v / 100) : paiseToInput(v));
const makingFromInput = (type: MakingType, s: string): number | null => {
  if (!s.trim()) return 0;
  if (type === "percent") {
    const n = parseDecimal(s, 2);
    return n === null ? null : Math.round(n * 100);
  }
  return rupeesToPaise(s);
};

/** Add or edit a piece: catalogue item, metal and purity, weights, making, wastage, stones, HUID; live price preview. */
export function PieceDialog({ open, onOpenChange, piece }: { open: boolean; onOpenChange: (o: boolean) => void; piece?: Piece | null }) {
  const { t } = useI18n();
  const metalLabel = useMetalLabel();
  const save = useSavePiece(piece?.id);
  const rates = useRates();
  const settings = useJewellerySettings();
  const [item, setItem] = React.useState<ShopItem | null>(null);
  const [metal, setMetal] = React.useState<Metal>("gold");
  const [purity, setPurity] = React.useState<Purity>("22K");
  const [gross, setGross] = React.useState("");
  const [stone, setStone] = React.useState("");
  const [wastage, setWastage] = React.useState("");
  const [makingType, setMakingType] = React.useState<MakingType>("per_gram");
  const [making, setMaking] = React.useState("");
  const [stones, setStones] = React.useState("");
  const [huid, setHuid] = React.useState("");
  const [tagNo, setTagNo] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setItem(null);
    setMetal(piece?.metal ?? "gold");
    setPurity(piece?.purity ?? "22K");
    setGross(piece ? String(piece.grossWeight) : "");
    setStone(piece?.stoneWeight ? String(piece.stoneWeight) : "");
    setWastage(piece?.wastagePct ? String(piece.wastagePct) : "");
    setMakingType(piece?.makingType ?? "per_gram");
    setMaking(piece ? makingToInput(piece.makingType, piece.makingValue) : "");
    setStones(piece?.stoneCharges ? paiseToInput(piece.stoneCharges) : "");
    setHuid(piece?.huid ?? "");
    setTagNo(piece?.tagNo ?? "");
    setSubmitted(false);
    setError(null);
  }, [open, piece]);

  const g = parseDecimal(gross, 3);
  const s = stone.trim() ? parseDecimal(stone, 3) : 0;
  const w = wastage.trim() ? parseDecimal(wastage, 2) : 0;
  const m = makingFromInput(makingType, making);
  const st = stones.trim() ? rupeesToPaise(stones) : 0;
  const h = normalizeHuid(huid);
  const errors = {
    item: !piece && !item ? t("jewellery.common.required") : null,
    gross: g === null || g <= 0 || g > 100_000 ? t("jewellery.piece.weightInvalid") : null,
    stone: s === null || (g !== null && s >= g) ? t("jewellery.piece.stoneInvalid") : null,
    wastage: w === null || w > 100 ? t("jewellery.piece.pctInvalid") : null,
    making: m === null || (makingType === "percent" && m > 10_000) ? t("jewellery.piece.makingInvalid") : null,
    stones: st === null ? t("jewellery.common.amountInvalid") : null,
    huid: h && !isValidHuid(h) ? t("jewellery.piece.huidInvalid") : null,
  };
  const valid = !Object.values(errors).some(Boolean);

  const rate = rates.data ? rateOf(rates.data.effective, metal, purity) : null;
  const preview =
    rate !== null && g !== null && g > 0 && s !== null && w !== null && m !== null && st !== null
      ? priceBreakdown({ grossWeight: g, stoneWeight: s, wastagePct: w, makingType, makingValue: m, stoneCharges: st }, rate, {
          gstRate: settings.data?.gstRate,
          roundTo: settings.data?.roundTo ?? 100,
        })
      : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (!valid || g === null || s === null || w === null || m === null || st === null) return;
    try {
      const saved = await save.mutateAsync({
        ...(piece ? {} : { itemId: item!.id, name: item!.name }),
        metal,
        purity,
        grossWeight: g,
        stoneWeight: s,
        wastagePct: w,
        makingType,
        makingValue: m,
        stoneCharges: st,
        huid: h || null,
        tagNo: tagNo.trim() || null,
      });
      toast.success(piece ? t("jewellery.piece.saved", { name: saved.name }) : t("jewellery.piece.added", { name: saved.name }));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  const err = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  const makingUnit = makingType === "per_gram" ? t("jewellery.piece.unitPerGram") : makingType === "percent" ? "%" : "₹";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("jewellery.common.close")} className="sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{piece ? t("jewellery.piece.editTitle") : t("jewellery.piece.addTitle")}</DialogTitle>
            <DialogDescription>{piece ? piece.name : t("jewellery.piece.addBody")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          {!piece && (
            <Field invalid={!!err("item")}>
              <FieldLabel>{t("jewellery.piece.item")}</FieldLabel>
              <ItemPicker value={item} onChange={setItem} invalid={!!err("item")} autoFocus />
              <FieldHint>{t("jewellery.piece.itemHint")}</FieldHint>
              <FieldError>{err("item")}</FieldError>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel>{t("jewellery.piece.metal")}</FieldLabel>
              <Select
                value={metal}
                onValueChange={(v) => {
                  const next = v as Metal;
                  setMetal(next);
                  if (!isPurityOf(next, purity)) setPurity(next === "gold" ? "22K" : PURITIES[next][0]);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METALS.map((x) => (
                    <SelectItem key={x} value={x}>
                      {metalLabel(x)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t("jewellery.piece.purity")}</FieldLabel>
              <Select value={purity} onValueChange={(v) => setPurity(v as Purity)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PURITIES[metal].map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t("jewellery.piece.tagNo")}</FieldLabel>
              <FieldControl>
                <Input value={tagNo} maxLength={40} onChange={(e) => setTagNo(e.target.value)} />
              </FieldControl>
            </Field>
            <Field invalid={!!err("gross")}>
              <FieldLabel>{t("jewellery.piece.gross")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={gross} placeholder="g" onChange={(e) => setGross(decimalInput(e.target.value))} />
              </FieldControl>
              <FieldError>{err("gross")}</FieldError>
            </Field>
            <Field invalid={!!err("stone")}>
              <FieldLabel>{t("jewellery.piece.stoneWeight")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={stone} placeholder="0.000" onChange={(e) => setStone(decimalInput(e.target.value))} />
              </FieldControl>
              <FieldError>{err("stone")}</FieldError>
            </Field>
            <Field invalid={!!err("wastage")}>
              <FieldLabel>{t("jewellery.piece.wastage")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={wastage} placeholder="%" onChange={(e) => setWastage(decimalInput(e.target.value))} />
              </FieldControl>
              <FieldError>{err("wastage")}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("jewellery.piece.makingType")}</FieldLabel>
              <Select
                value={makingType}
                onValueChange={(v) => {
                  setMakingType(v as MakingType);
                  setMaking("");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAKING_TYPES.map((x) => (
                    <SelectItem key={x} value={x}>
                      {t(`jewellery.making.${x}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field invalid={!!err("making")}>
              <FieldLabel>{t("jewellery.piece.making")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={making} placeholder={makingUnit} onChange={(e) => setMaking(decimalInput(e.target.value))} />
              </FieldControl>
              <FieldHint>{makingUnit}</FieldHint>
              <FieldError>{err("making")}</FieldError>
            </Field>
            <Field invalid={!!err("stones")}>
              <FieldLabel>{t("jewellery.piece.stoneCharges")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={stones} placeholder="₹" onChange={(e) => setStones(e.target.value)} />
              </FieldControl>
              <FieldError>{err("stones")}</FieldError>
            </Field>
            <Field invalid={!!err("huid")} className="sm:col-span-3">
              <FieldLabel>{t("jewellery.piece.huid")}</FieldLabel>
              <FieldControl>
                <Input value={huid} maxLength={8} autoCapitalize="characters" className="font-mono sm:max-w-48" onChange={(e) => setHuid(e.target.value.toUpperCase())} />
              </FieldControl>
              <HuidPhotoButton pieceId={piece?.id} onApply={(v) => setHuid(v)} className="mt-1 w-fit" />
              <FieldHint>{t("jewellery.piece.huidHint")}</FieldHint>
              <FieldError>{err("huid") ?? (h && !isValidHuid(h) && h.length >= 6 ? t("jewellery.piece.huidInvalid") : null)}</FieldError>
            </Field>
          </div>
          <div className="rounded-md border bg-muted/30 p-4">
            <p className="mb-2 text-sm font-medium">{t("jewellery.piece.preview")}</p>
            {preview ? (
              <BreakdownList b={preview} />
            ) : (
              <p className="text-sm text-muted-foreground">{rate === null && !rates.isPending ? t("jewellery.piece.noRate", { metal: metalLabel(metal, purity) }) : t("jewellery.piece.previewHint")}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("jewellery.common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {piece ? t("jewellery.common.save") : t("jewellery.piece.addCta")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
