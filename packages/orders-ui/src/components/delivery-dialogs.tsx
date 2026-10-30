"use client";

import * as React from "react";
import { Loader2Icon, MapIcon, PlusIcon, ScaleIcon, Trash2Icon } from "lucide-react";
import {
  Button,
  ChipGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Switch,
  toast,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { parseSlabs, PINCODE_RE, PREFIX_RE } from "../lib/delivery";
import { paiseToInput, rupeesToPaise } from "../lib/format";
import { useSaveRate, useSaveZone } from "../lib/queries";
import { RATE_TYPES, type Rate, type RateType, type Zone } from "../lib/types";
import { ChipsInput, StateMultiSelect } from "./chips-input";
import { Field, MoneyInput } from "./bits";

/** Create / edit a zone: name, states, pincode prefixes and exact pincodes. No rules = "Rest of India". */
export function ZoneDialog({ open, onOpenChange, zone, nextSort }: { open: boolean; onOpenChange: (o: boolean) => void; zone?: Zone | null; nextSort: number }) {
  const { t } = useI18n();
  const save = useSaveZone();
  const [name, setName] = React.useState("");
  const [states, setStates] = React.useState<string[]>([]);
  const [prefixes, setPrefixes] = React.useState<string[]>([]);
  const [pincodes, setPincodes] = React.useState<string[]>([]);
  const [active, setActive] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setName(zone?.name ?? "");
      setStates(zone?.states ?? []);
      setPrefixes(zone?.pincodePrefixes ?? []);
      setPincodes(zone?.pincodes ?? []);
      setActive(zone?.active ?? true);
      setError(null);
    }
  }, [open, zone]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(t("orders.validation.required"));
    try {
      await save.mutateAsync({
        id: zone?.id,
        body: { name: name.trim(), states, pincodePrefixes: prefixes, pincodes, active, ...(zone ? {} : { sort: nextSort }) },
      });
      toast.success(zone ? t("orders.delivery.zoneSaved", { name: name.trim() }) : t("orders.delivery.zoneCreated", { name: name.trim() }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const rest = states.length === 0 && prefixes.length === 0 && pincodes.length === 0;
  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" closeLabel={t("orders.common.close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="icon-chip size-8 text-primary">
              <MapIcon className="size-4" />
            </span>
            {zone ? t("orders.delivery.editZone") : t("orders.delivery.addZone")}
          </DialogTitle>
          <DialogDescription>{t("orders.delivery.zoneHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <Field label={t("orders.delivery.zoneName")} htmlFor="z-name" error={error}>
            <Input id="z-name" autoFocus value={name} onChange={(e) => (setName(e.target.value), setError(null))} placeholder={t("orders.delivery.zoneNamePlaceholder")} />
          </Field>
          <Field label={t("orders.delivery.states")} htmlFor="z-states" optional>
            <StateMultiSelect id="z-states" value={states} onChange={setStates} />
          </Field>
          <Field label={t("orders.delivery.prefixes")} htmlFor="z-prefixes" optional hint={t("orders.delivery.prefixesHint")}>
            <ChipsInput
              id="z-prefixes"
              value={prefixes}
              onChange={setPrefixes}
              inputMode="numeric"
              accept={(s) => PREFIX_RE.test(s)}
              invalidText={t("orders.delivery.prefixInvalid")}
              placeholder="600, 641"
              aria-label={t("orders.delivery.prefixes")}
            />
          </Field>
          <Field label={t("orders.delivery.pincodes")} htmlFor="z-pincodes" optional hint={t("orders.delivery.pincodesHint")}>
            <ChipsInput
              id="z-pincodes"
              value={pincodes}
              onChange={setPincodes}
              inputMode="numeric"
              accept={(s) => PINCODE_RE.test(s)}
              invalidText={t("orders.validation.pincode")}
              placeholder="600001"
              aria-label={t("orders.delivery.pincodes")}
            />
          </Field>
          {rest && <p className="rounded-lg bg-info/10 px-3 py-2 text-xs text-info-ink">{t("orders.delivery.restOfIndia")}</p>}
          <label className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm">
            <span>{t("orders.delivery.zoneActive")}</span>
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              {t("orders.common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {t("orders.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface SlabRow {
  upToGrams: string;
  amount: string;
}

/** Create / edit a rate in a zone: flat, by weight slabs, or free above an amount; ETA; COD + fee. */
export function RateDialog({ open, onOpenChange, zone, rate }: { open: boolean; onOpenChange: (o: boolean) => void; zone: Zone | null; rate?: Rate | null }) {
  const { t } = useI18n();
  const save = useSaveRate();
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<RateType>("flat");
  const [amount, setAmount] = React.useState("");
  const [freeAbove, setFreeAbove] = React.useState("");
  const [slabs, setSlabs] = React.useState<SlabRow[]>([]);
  const [etaMin, setEtaMin] = React.useState("2");
  const [etaMax, setEtaMax] = React.useState("5");
  const [cod, setCod] = React.useState(true);
  const [codFee, setCodFee] = React.useState("");
  const [active, setActive] = React.useState(true);
  const [errors, setErrors] = React.useState<Partial<Record<"name" | "amount" | "freeAbove" | "slabs" | "eta" | "codFee", string>>>({});

  React.useEffect(() => {
    if (!open) return;
    setName(rate?.name ?? t("orders.delivery.defaultRateName"));
    setType(rate?.type ?? "flat");
    setAmount(paiseToInput(rate?.amount ?? 0));
    setFreeAbove(paiseToInput(rate?.freeAbove ?? null));
    setSlabs(
      rate?.weightSlabs.length
        ? rate.weightSlabs.map((s) => ({ upToGrams: String(s.upToGrams), amount: paiseToInput(s.amount) }))
        : [
            { upToGrams: "500", amount: "40" },
            { upToGrams: "1000", amount: "60" },
          ],
    );
    setEtaMin(String(rate?.etaMinDays ?? 2));
    setEtaMax(String(rate?.etaMaxDays ?? 5));
    setCod(rate?.codAllowed ?? true);
    setCodFee(paiseToInput(rate?.codFee ?? 0));
    setActive(rate?.active ?? true);
    setErrors({});
  }, [open, rate, t]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zone) return;
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = t("orders.validation.required");
    const amt = rupeesToPaise(amount || "0");
    if (type !== "weight" && amt === null) errs.amount = t("orders.validation.amount");
    const fa = freeAbove.trim() ? rupeesToPaise(freeAbove) : null;
    if (freeAbove.trim() && fa === null) errs.freeAbove = t("orders.validation.amount");
    if (type === "free_above" && fa === null) errs.freeAbove = t("orders.delivery.freeAboveRequired");
    const parsed = type === "weight" ? parseSlabs(slabs) : ({ ok: true, slabs: [] } as const);
    if (type === "weight" && (!parsed.ok || slabs.length === 0)) errs.slabs = t("orders.delivery.slabsInvalid");
    const min = Number(etaMin);
    const max = Number(etaMax);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 90 || max < min) errs.eta = t("orders.delivery.etaInvalid");
    const fee = cod ? rupeesToPaise(codFee || "0") : 0;
    if (fee === null) errs.codFee = t("orders.validation.amount");
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    try {
      await save.mutateAsync({
        id: rate?.id,
        body: {
          zoneId: zone.id,
          name: name.trim(),
          type,
          amount: type === "weight" ? 0 : (amt ?? 0),
          freeAbove: fa,
          weightSlabs: parsed.ok ? [...parsed.slabs] : [],
          etaMinDays: min,
          etaMaxDays: max,
          codAllowed: cod,
          codFee: fee ?? 0,
          active,
          ...(rate ? {} : { sort: zone.rates.length }),
        },
      });
      toast.success(t("orders.delivery.rateSaved", { name: name.trim() }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" closeLabel={t("orders.common.close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="icon-chip size-8 text-info-ink">
              <ScaleIcon className="size-4" />
            </span>
            {rate ? t("orders.delivery.editRate") : t("orders.delivery.addRate")}
          </DialogTitle>
          <DialogDescription>{t("orders.delivery.rateFor", { zone: zone?.name ?? "" })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <Field label={t("orders.delivery.rateName")} htmlFor="r-name" error={errors.name} hint={t("orders.delivery.rateNameHint")}>
            <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <ChipGroup<RateType>
            aria-label={t("orders.delivery.rateType")}
            value={type}
            onChange={setType}
            options={RATE_TYPES.map((r) => ({ value: r, label: t(`orders.delivery.type.${r}`) }))}
          />
          {type !== "weight" && (
            <Field label={type === "free_above" ? t("orders.delivery.chargeBelow") : t("orders.delivery.charge")} htmlFor="r-amount" error={errors.amount}>
              <MoneyInput id="r-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
            </Field>
          )}
          {type === "weight" && (
            <div className="grid gap-2">
              <p className="text-sm font-medium">{t("orders.delivery.slabs")}</p>
              {slabs.map((s, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2">
                  <InputGroup>
                    <InputGroupInput
                      inputMode="numeric"
                      className="pr-1.5 text-right tabular-nums"
                      aria-label={t("orders.delivery.upTo")}
                      value={s.upToGrams}
                      onChange={(e) => setSlabs((xs) => xs.map((x, j) => (j === i ? { ...x, upToGrams: e.target.value.replace(/\D/g, "") } : x)))}
                    />
                    <InputGroupAddon className="text-xs" aria-hidden>
                      {t("orders.delivery.gramsUnit")}
                    </InputGroupAddon>
                  </InputGroup>
                  <MoneyInput aria-label={t("orders.delivery.charge")} value={s.amount} onChange={(e) => setSlabs((xs) => xs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                  <Button type="button" variant="ghost" size="icon" onClick={() => setSlabs((xs) => xs.filter((_, j) => j !== i))} aria-label={t("orders.delivery.removeSlab")}>
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() =>
                  setSlabs((xs) => [...xs, { upToGrams: String((Number(xs[xs.length - 1]?.upToGrams) || 0) + 1000), amount: xs[xs.length - 1]?.amount ?? "" }])
                }
              >
                <PlusIcon /> {t("orders.delivery.addSlab")}
              </Button>
              <p className={errors.slabs ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{errors.slabs ?? t("orders.delivery.slabsHint")}</p>
            </div>
          )}
          <Field label={t("orders.delivery.freeAbove")} htmlFor="r-free" optional={type !== "free_above"} error={errors.freeAbove} hint={t("orders.delivery.freeAboveHint")}>
            <MoneyInput id="r-free" value={freeAbove} onChange={(e) => setFreeAbove(e.target.value)} />
          </Field>
          <Field label={t("orders.delivery.eta")} htmlFor="r-eta-min" error={errors.eta}>
            <div className="flex items-center gap-2">
              <Input id="r-eta-min" inputMode="numeric" className="w-20 text-center tabular-nums" aria-label={t("orders.delivery.etaMin")} value={etaMin} onChange={(e) => setEtaMin(e.target.value.replace(/\D/g, "").slice(0, 2))} />
              <span className="text-muted-foreground">–</span>
              <Input inputMode="numeric" className="w-20 text-center tabular-nums" aria-label={t("orders.delivery.etaMax")} value={etaMax} onChange={(e) => setEtaMax(e.target.value.replace(/\D/g, "").slice(0, 2))} />
              <span className="text-sm text-muted-foreground">{t("orders.delivery.days")}</span>
            </div>
          </Field>
          <div className="grid gap-3 rounded-xl border p-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                <span className="block font-medium">{t("orders.delivery.codAllowed")}</span>
                <span className="text-xs text-muted-foreground">{t("orders.delivery.codHint")}</span>
              </span>
              <Switch checked={cod} onCheckedChange={setCod} />
            </label>
            {cod && (
              <Field label={t("orders.delivery.codFee")} htmlFor="r-codfee" optional error={errors.codFee}>
                <MoneyInput id="r-codfee" value={codFee} onChange={(e) => setCodFee(e.target.value)} placeholder="0" />
              </Field>
            )}
          </div>
          <label className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm">
            <span>{t("orders.delivery.rateActive")}</span>
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              {t("orders.common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {t("orders.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
