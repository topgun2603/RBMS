"use client";

import * as React from "react";
import { PaletteIcon, RulerIcon } from "lucide-react";
import { Alert, AlertDescription, Badge, Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Textarea } from "@srirealtime/ui";
import { tOr, useI18n } from "../../lib/i18n";
import { AiDraftBanner } from "../ai-draft";
import { PhotoButton, postTrades, useTradesError, useTradesHelper, type Run } from "./shared";

interface Row {
  key: string | null;
  label: string;
  value: number | null;
  confidence: "high" | "medium" | "low";
  autofill: boolean;
  issue: string | null;
}
interface MeasureResult extends Run {
  draft: { unit: "in" | "cm" | null; unitSure: boolean; unitSaid: "in" | "cm" | "unknown"; garmentOnSheet: string | null; rows: Row[]; fill: Record<string, number>; missing: string[]; notes: string | null };
}

export const MEASURE_CREDITS = 20;
export const DESIGN_CREDITS = 15;

/**
 * "Read measurement sheet": a printed or handwritten measurement card becomes the garment's measurements. Values the model was
 * sure of (and that fit a real body in the sheet's unit) are ticked; the rest are shown unticked with the reason, for the tailor
 * to check and tick. If the unit is unclear nothing is ticked and the tailor chooses the unit.
 */
export function MeasurementSheetButton({
  garment,
  keys,
  onApply,
  className,
}: {
  garment: string;
  /** The measurement keys the form currently has (a reading can only fill these). */
  keys: string[];
  onApply: (values: Record<string, number>, unit: "in" | "cm") => void;
  className?: string;
}) {
  const { t } = useI18n();
  const { show } = useTradesHelper("measurement-read", "jobcards.manage");
  const errText = useTradesError();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [res, setRes] = React.useState<MeasureResult | null>(null);
  const [vals, setVals] = React.useState<Record<string, string>>({});
  const [pick, setPick] = React.useState<Record<string, boolean>>({});
  const [unit, setUnit] = React.useState<"in" | "cm" | null>(null);
  if (!show) return null;

  const read = async (photos: { mediaType: string; data: string }[]) => {
    setBusy(true);
    setError(null);
    try {
      const r = await postTrades<MeasureResult>("measurements", { images: photos, garment });
      setRes(r);
      setUnit(r.draft.unit);
      const v: Record<string, string> = {};
      const p: Record<string, boolean> = {};
      for (const row of r.draft.rows) {
        if (!row.key || row.value === null) continue;
        v[row.key] = String(row.value);
        p[row.key] = row.autofill && keys.includes(row.key);
      }
      setVals(v);
      setPick(p);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const rows = (res?.draft.rows ?? []).filter((r) => r.key && r.value !== null);
  const outside = (res?.draft.rows ?? []).filter((r) => !r.key);
  const chosen = rows.filter((r) => pick[r.key!] && keys.includes(r.key!) && Number(vals[r.key!]) > 0);
  const apply = () => {
    if (!unit) return;
    onApply(Object.fromEntries(chosen.map((r) => [r.key!, Number(vals[r.key!])])), unit);
    setOpen(false);
  };

  return (
    <>
      <Button type="button" size="sm" variant="outline" className={className} onClick={() => setOpen(true)}>
        <RulerIcon /> {t("web.aiTrades.measure.button")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("web.aiTrades.measure.title")}</DialogTitle>
            <DialogDescription>{t("web.aiTrades.measure.intro")}</DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!res && (
            <div className="grid gap-2">
              <PhotoButton label={busy ? t("web.aiTrades.reading") : t("web.aiTrades.choosePhoto")} busy={busy} onPhotos={read} onError={setError} />
              <p className="text-meta text-muted-foreground">{t("web.aiTrades.credits", { count: MEASURE_CREDITS })}</p>
            </div>
          )}
          {res && (
            <div className="grid gap-3">
              <AiDraftBanner runId={res.runId} credits={res.credits} mock={res.provider === "mock"} />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{t("web.aiTrades.measure.unit")}</span>
                {(["in", "cm"] as const).map((u) => (
                  <Button key={u} type="button" size="sm" variant={unit === u ? "default" : "outline"} aria-pressed={unit === u} onClick={() => setUnit(u)}>
                    {t(u === "in" ? "web.aiTrades.measure.inches" : "web.aiTrades.measure.cm")}
                  </Button>
                ))}
                {!res.draft.unitSure && <Badge variant="outline">{t(res.draft.unitSaid === "unknown" ? "web.aiTrades.measure.unitUnknown" : "web.aiTrades.measure.unitDisagrees")}</Badge>}
              </div>
              {res.draft.garmentOnSheet && res.draft.garmentOnSheet !== garment && <p className="text-meta text-amber-700 dark:text-amber-400">{t("web.aiTrades.measure.otherGarment", { garment: res.draft.garmentOnSheet })}</p>}
              <div className="grid gap-2">
                {rows.map((r) => {
                  const k = r.key!;
                  const inForm = keys.includes(k);
                  return (
                    <div key={k} className="grid grid-cols-[auto_1fr_6rem] items-center gap-2 rounded-md border p-2">
                      <Checkbox checked={!!pick[k]} disabled={!inForm} onCheckedChange={(v) => setPick((p) => ({ ...p, [k]: v === true }))} aria-label={tOr(t, `jobcards.measure.${k}`, k)} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{tOr(t, `jobcards.measure.${k}`, k)}</div>
                        <div className="flex flex-wrap gap-1 text-meta text-muted-foreground">
                          {r.label && r.label.toLowerCase() !== k.toLowerCase() && <span>{r.label}</span>}
                          {r.issue ? <span className="text-destructive">{t(`web.aiTrades.measure.issue.${r.issue}`)}</span> : r.confidence !== "high" ? <span>{t(`web.aiTrades.measure.conf.${r.confidence}`)}</span> : null}
                          {!inForm && <span>{t("web.aiTrades.measure.issue.not_in_form")}</span>}
                        </div>
                      </div>
                      <Input
                        aria-label={tOr(t, `jobcards.measure.${k}`, k)}
                        inputMode="decimal"
                        className="tabular-nums"
                        value={vals[k] ?? ""}
                        onChange={(e) => setVals((p) => ({ ...p, [k]: e.target.value.replace(/[^\d.]/g, "") }))}
                      />
                    </div>
                  );
                })}
                {rows.length === 0 && <p className="text-sm text-muted-foreground">{t("web.aiTrades.measure.none")}</p>}
              </div>
              {outside.length > 0 && <p className="text-meta text-muted-foreground">{t("web.aiTrades.measure.other", { items: outside.map((o) => `${o.label || "?"}${o.value !== null ? ` ${o.value}` : ""}`).join(", ") })}</p>}
              <p className="text-meta text-muted-foreground">{t("web.aiTrades.measure.verify")}</p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("web.common.close")}
            </Button>
            {res && (
              <>
                <PhotoButton variant="outline" label={t("web.aiTrades.retake")} busy={busy} onPhotos={read} onError={setError} />
                <Button type="button" disabled={!unit || chosen.length === 0} onClick={apply}>
                  {t("web.aiTrades.measure.use", { count: chosen.length })}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface DesignResult extends Run {
  draft: { parts: Record<string, string>; text: string; suspicious: boolean; readable: boolean };
}

/** "Design reference": a photo the customer brought becomes short design notes (neck, sleeve, lining, piping, work) for the style box. */
export function DesignNotesButton({ onApply, className }: { onApply: (text: string) => void; className?: string }) {
  const { t, locale } = useI18n();
  const { show } = useTradesHelper("design-notes", "jobcards.manage");
  const errText = useTradesError();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [res, setRes] = React.useState<DesignResult | null>(null);
  const [text, setText] = React.useState("");
  if (!show) return null;
  const read = async (photos: { mediaType: string; data: string }[]) => {
    setBusy(true);
    setError(null);
    try {
      const r = await postTrades<DesignResult>("design-notes", { images: photos, language: locale === "ta" ? "ta" : "en" });
      setRes(r);
      setText(r.draft.text);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button type="button" size="sm" variant="outline" className={className} onClick={() => setOpen(true)}>
        <PaletteIcon /> {t("web.aiTrades.design.button")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("web.aiTrades.design.title")}</DialogTitle>
            <DialogDescription>{t("web.aiTrades.design.intro")}</DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!res && (
            <div className="grid gap-2">
              <PhotoButton label={busy ? t("web.aiTrades.reading") : t("web.aiTrades.choosePhoto")} busy={busy} onPhotos={read} onError={setError} />
              <p className="text-meta text-muted-foreground">{t("web.aiTrades.credits", { count: DESIGN_CREDITS })}</p>
            </div>
          )}
          {res && (
            <div className="grid gap-3">
              <AiDraftBanner runId={res.runId} credits={res.credits} mock={res.provider === "mock"} />
              {res.draft.suspicious && <p className="text-sm text-amber-700 dark:text-amber-400">{t("web.aiTrades.injection")}</p>}
              <Textarea aria-label={t("web.aiTrades.design.notes")} rows={5} maxLength={900} value={text} onChange={(e) => setText(e.target.value)} />
              <p className="text-meta text-muted-foreground">{t("web.aiTrades.design.verify")}</p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("web.common.close")}
            </Button>
            {res && (
              <Button
                type="button"
                disabled={!text.trim()}
                onClick={() => {
                  onApply(text.trim());
                  setOpen(false);
                }}
              >
                {t("web.aiTrades.design.add")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
