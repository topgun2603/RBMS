"use client";

import * as React from "react";
import { GemIcon, Loader2Icon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  Skeleton,
  toast,
} from "@rbms/ui";
import { describeError, useI18n, usePermission } from "@rbms/web";
import { InlineError } from "../components/bits";
import { JEWELLERY_PERMISSIONS } from "../lib/access";
import { decimalInput, parseDecimal } from "../lib/format";
import { useJewellerySettings, useSaveSettings } from "../lib/queries";

/** Rounding steps in paise: none, ₹1, ₹10, ₹100. */
const ROUNDING = [1, 100, 1000, 10000] as const;

/** Settings → Jewellery: GST % shown on breakdowns, old-gold buy-back % below the sale rate, price rounding. */
export default function JewellerySettingsPage() {
  const { t } = useI18n();
  const canManage = usePermission(JEWELLERY_PERMISSIONS.manage);
  const s = useJewellerySettings();
  const save = useSaveSettings();
  const [gst, setGst] = React.useState("3");
  const [buyback, setBuyback] = React.useState("0");
  const [roundTo, setRoundTo] = React.useState("100");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!s.data) return;
    setGst(String(s.data.gstRate));
    setBuyback(String(s.data.buybackPct));
    setRoundTo(String(s.data.roundTo));
  }, [s.data]);

  const g = parseDecimal(gst, 2);
  const b = parseDecimal(buyback, 2);
  const errors = {
    gst: g === null || g > 28 ? t("jewellery.settings.gstInvalid") : null,
    buyback: b === null || b > 50 ? t("jewellery.settings.buybackInvalid") : null,
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (Object.values(errors).some(Boolean) || g === null || b === null) return;
    try {
      await save.mutateAsync({ gstRate: g, buybackPct: b, roundTo: Number(roundTo) });
      toast.success(t("jewellery.settings.saved"));
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  const roundLabel = (v: number) => (v === 1 ? t("jewellery.settings.roundNone") : t("jewellery.settings.roundTo", { amount: v / 100 }));
  const options: number[] = [...ROUNDING];
  if (s.data && !options.includes(s.data.roundTo)) options.push(s.data.roundTo);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GemIcon className="size-4 text-primary" /> {t("jewellery.settings.title")}
        </CardTitle>
        <CardDescription>{t("jewellery.settings.body")}</CardDescription>
      </CardHeader>
      <CardContent>
        {s.isError ? (
          <InlineError title={describeError(s.error, t)} />
        ) : s.isPending ? (
          <Skeleton className="h-40" />
        ) : (
          <form onSubmit={submit} className="grid max-w-lg gap-5">
            {error && <InlineError title={error} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field invalid={!!errors.gst}>
                <FieldLabel>{t("jewellery.settings.gst")}</FieldLabel>
                <FieldControl>
                  <Input inputMode="decimal" value={gst} disabled={!canManage} onChange={(e) => setGst(decimalInput(e.target.value))} />
                </FieldControl>
                <FieldHint>{t("jewellery.settings.gstHint")}</FieldHint>
                <FieldError>{errors.gst}</FieldError>
              </Field>
              <Field invalid={!!errors.buyback}>
                <FieldLabel>{t("jewellery.settings.buyback")}</FieldLabel>
                <FieldControl>
                  <Input inputMode="decimal" value={buyback} disabled={!canManage} onChange={(e) => setBuyback(decimalInput(e.target.value))} />
                </FieldControl>
                <FieldHint>{t("jewellery.settings.buybackHint")}</FieldHint>
                <FieldError>{errors.buyback}</FieldError>
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel>{t("jewellery.settings.rounding")}</FieldLabel>
                <Select value={roundTo} onValueChange={setRoundTo} disabled={!canManage}>
                  <SelectTrigger className="w-full sm:w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((v) => (
                      <SelectItem key={v} value={String(v)}>
                        {roundLabel(v)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldHint>{t("jewellery.settings.roundingHint")}</FieldHint>
              </Field>
            </div>
            {canManage && (
              <Button type="submit" className="justify-self-start" disabled={save.isPending}>
                {save.isPending && <Loader2Icon className="animate-spin" />}
                {t("jewellery.common.save")}
              </Button>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
