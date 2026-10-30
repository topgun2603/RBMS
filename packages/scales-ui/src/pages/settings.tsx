"use client";

import * as React from "react";
import { BarcodeIcon, CheckCircle2Icon, Loader2Icon, PlusIcon, ScanBarcodeIcon, XCircleIcon, XIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChipGroup,
  cn,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  Skeleton,
  toast,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { BarcodeDigits, InlineError } from "../components/bits";
import { buildScaleBarcode, isValidEan13, parseScaleBarcode, scaleFormatProblem, type ScaleBarcodeFormat } from "../lib/barcode";
import { barcodeParts, money, qty } from "../lib/format";
import { useSaveScaleSettings, useScaleSettings } from "../lib/queries";
import { VALUE_KINDS, type ValueKind } from "../lib/types";

const COMMON_PREFIXES = ["20", "21", "22", "23", "24", "25", "26", "27", "28", "29"];

/** Settings → Weighing: the barcode format the scales print, with a live decode of a sample label. */
export default function ScalesSettingsPage() {
  const { t } = useI18n();
  const s = useScaleSettings();
  const save = useSaveScaleSettings();
  const [prefixes, setPrefixes] = React.useState<string[]>([]);
  const [custom, setCustom] = React.useState("");
  const [pluDigits, setPluDigits] = React.useState("5");
  const [valueDigits, setValueDigits] = React.useState("5");
  const [valueKind, setValueKind] = React.useState<ValueKind>("weight");
  const [sample, setSample] = React.useState("");
  const [sampleTouched, setSampleTouched] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!s.data) return;
    setPrefixes(s.data.prefixes);
    setPluDigits(String(s.data.pluDigits));
    setValueDigits(String(s.data.valueDigits));
    setValueKind(s.data.valueKind);
  }, [s.data]);

  const format: ScaleBarcodeFormat = { prefixes: [...prefixes].sort(), pluDigits: Number(pluDigits), valueDigits: Number(valueDigits), valueKind };
  const prefixLen = prefixes[0]?.length ?? 0;
  const problem = scaleFormatProblem(format);
  const problemText = !problem
    ? null
    : prefixes.length === 0
      ? t("scales.settings.needPrefix")
      : prefixes.some((p) => p.length !== prefixLen)
        ? t("scales.settings.samePrefixLength")
        : t("scales.settings.digitsSum", { prefix: prefixLen, plu: pluDigits || "0", value: valueDigits || "0" });

  // The example label follows the format until the user types or scans their own.
  const example = problem ? null : buildScaleBarcode(valueKind === "weight" ? { plu: 42, weightKg: 1.25 } : { plu: 42, pricePaise: 12_500 }, format);
  React.useEffect(() => {
    if (!sampleTouched) setSample(example ?? "");
  }, [example, sampleTouched]);

  const code = sample.replace(/\s/g, "");
  const parsed = problem ? null : parseScaleBarcode(code, format);
  const why =
    code.length === 0
      ? null
      : code.length !== 13 || !/^\d+$/.test(code)
        ? t("scales.settings.why.length")
        : !isValidEan13(code)
          ? t("scales.settings.why.check")
          : !format.prefixes.some((p) => code.startsWith(p))
            ? t("scales.settings.why.prefix")
            : t("scales.settings.why.zero");

  const toggle = (p: string) => setPrefixes((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const addCustom = () => {
    const p = custom.trim();
    if (!/^\d{1,3}$/.test(p)) return;
    if (!prefixes.includes(p)) setPrefixes((cur) => [...cur, p]);
    setCustom("");
  };
  const extra = prefixes.filter((p) => !COMMON_PREFIXES.includes(p)).sort();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (problem) return;
    try {
      await save.mutateAsync(format);
      toast.success(t("scales.settings.saved"));
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  return (
    <div className="grid gap-section">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarcodeIcon className="size-4 text-primary" /> {t("scales.settings.title")}
          </CardTitle>
          <CardDescription>{t("scales.settings.body")}</CardDescription>
        </CardHeader>
        <CardContent>
          {s.isError ? (
            <InlineError title={describeError(s.error, t)} />
          ) : s.isPending ? (
            <Skeleton className="h-48" />
          ) : (
            <form onSubmit={submit} className="grid max-w-2xl gap-6">
              {error && <InlineError title={error} />}

              <Field invalid={prefixes.length === 0}>
                <FieldLabel>{t("scales.settings.prefixes")}</FieldLabel>
                <div className="flex flex-wrap gap-2" role="group" aria-label={t("scales.settings.prefixes")}>
                  {COMMON_PREFIXES.map((p) => (
                    <PrefixChip key={p} on={prefixes.includes(p)} onClick={() => toggle(p)}>
                      {p}
                    </PrefixChip>
                  ))}
                  {extra.map((p) => (
                    <PrefixChip key={p} on onClick={() => toggle(p)} removable>
                      {p}
                    </PrefixChip>
                  ))}
                </div>
                <div className="flex max-w-xs gap-2">
                  <Input
                    inputMode="numeric"
                    maxLength={3}
                    className="font-mono"
                    value={custom}
                    placeholder={t("scales.settings.otherPrefix")}
                    aria-label={t("scales.settings.otherPrefix")}
                    onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustom();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={addCustom} disabled={!/^\d{1,3}$/.test(custom)}>
                    <PlusIcon /> {t("scales.settings.add")}
                  </Button>
                </div>
                <FieldHint>{t("scales.settings.prefixesHint")}</FieldHint>
              </Field>

              <FieldRow>
                <Field>
                  <FieldLabel>{t("scales.settings.pluDigits")}</FieldLabel>
                  <FieldControl>
                    <Input inputMode="numeric" maxLength={1} value={pluDigits} onChange={(e) => setPluDigits(e.target.value.replace(/\D/g, ""))} />
                  </FieldControl>
                  <FieldHint>{t("scales.settings.pluDigitsHint")}</FieldHint>
                </Field>
                <Field>
                  <FieldLabel>{t("scales.settings.valueDigits")}</FieldLabel>
                  <FieldControl>
                    <Input inputMode="numeric" maxLength={1} value={valueDigits} onChange={(e) => setValueDigits(e.target.value.replace(/\D/g, ""))} />
                  </FieldControl>
                  <FieldHint>{t("scales.settings.valueDigitsHint")}</FieldHint>
                </Field>
              </FieldRow>

              <Field>
                <FieldLabel>{t("scales.settings.valueKind")}</FieldLabel>
                <ChipGroup<ValueKind>
                  size="sm"
                  aria-label={t("scales.settings.valueKind")}
                  value={valueKind}
                  onChange={setValueKind}
                  options={VALUE_KINDS.map((k) => ({ value: k, label: t(`scales.valueKind.${k}`) }))}
                />
                <FieldHint>{t(`scales.valueKindHint.${valueKind}`)}</FieldHint>
              </Field>

              {problemText && <InlineError title={problemText} />}

              <div className="grid gap-3 rounded-lg border bg-muted/30 p-4">
                <Field invalid={!!code && !parsed}>
                  <FieldLabel className="flex items-center gap-2">
                    <ScanBarcodeIcon className="size-4" /> {t("scales.settings.try")}
                  </FieldLabel>
                  <FieldControl>
                    <Input
                      inputMode="numeric"
                      className="max-w-xs font-mono tracking-widest"
                      maxLength={20}
                      value={sample}
                      onChange={(e) => {
                        setSampleTouched(true);
                        setSample(e.target.value);
                      }}
                    />
                  </FieldControl>
                  <FieldHint>{t("scales.settings.tryHint")}</FieldHint>
                  <FieldError>{code && !parsed && !problem ? why : null}</FieldError>
                </Field>
                {parsed && (
                  <div className="grid gap-2">
                    <BarcodeDigits
                      parts={barcodeParts(code, format)}
                      labels={{
                        prefix: t("scales.label.prefix"),
                        plu: t("scales.label.plu"),
                        value: valueKind === "price" ? t("scales.label.valuePrice") : t("scales.label.valueWeight"),
                        check: t("scales.label.check"),
                      }}
                    />
                    <p className="flex items-center gap-2 text-sm">
                      <CheckCircle2Icon className="size-4 text-success" />
                      {parsed.weightKg !== undefined
                        ? t("scales.settings.decodedWeight", { plu: parsed.plu, qty: qty(parsed.weightKg) })
                        : t("scales.settings.decodedPrice", { plu: parsed.plu, amount: money(parsed.pricePaise ?? 0) })}
                    </p>
                  </div>
                )}
                {code && !parsed && !problem && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <XCircleIcon className="size-4 text-destructive" /> {t("scales.settings.notScale")}
                  </p>
                )}
                {sampleTouched && example && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="justify-self-start"
                    onClick={() => {
                      setSampleTouched(false);
                      setSample(example);
                    }}
                  >
                    {t("scales.settings.useExample")}
                  </Button>
                )}
              </div>

              <Button type="submit" className="justify-self-start" disabled={save.isPending || !!problem}>
                {save.isPending && <Loader2Icon className="animate-spin" />}
                {t("scales.common.save")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PrefixChip({ on, onClick, removable, children }: { on: boolean; onClick: () => void; removable?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-1 rounded-full border px-3 font-mono text-sm font-medium tabular-nums transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
      {removable && <XIcon className="size-3.5" />}
    </button>
  );
}
