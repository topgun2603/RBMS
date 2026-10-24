"use client";

import * as React from "react";
import { ScanBarcodeIcon } from "lucide-react";
import { Alert, AlertDescription, Badge, Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label } from "@srirealtime/ui";
import { useI18n } from "../../lib/i18n";
import { AiDraftBanner } from "../ai-draft";
import { PhotoButton, postTrades, useTradesError, useTradesHelper, type Run } from "./shared";

export interface DeviceFill {
  brand: string | null;
  model: string | null;
  serial: string | null;
  imei1: string | null;
  imei2: string | null;
}
interface Flag {
  code: string;
  severity: "error" | "warn" | "info";
  field?: string;
  value?: string;
}
interface Warranty {
  found: boolean;
  itemName?: string;
  soldOn?: string | null;
  warrantyEnd?: string | null;
  state: "in_warranty" | "expired" | "no_warranty" | "not_sold" | "not_found";
  daysLeft?: number | null;
}
interface Result extends Run {
  draft: { fill: DeviceFill; read: { brand: string | null; model: string | null; serial: string | null; imeis: string[] }; imei: { value: string; valid: boolean }[]; flags: Flag[]; lowFields: string[] };
  warranty: Warranty | null;
}

export const DEVICE_LABEL_CREDITS = 15;
type FieldKey = keyof DeviceFill;
const FIELDS: FieldKey[] = ["brand", "model", "serial", "imei1", "imei2"];

/**
 * "Read from photo" for a device's box label, Settings > About screen or sticker. The IMEI check digit and serial format are
 * checked on the server; a number that fails, or that the model was unsure of, is shown but not ticked and not filled in.
 * `forWhat` decides the permission: a job card (`jobcards.manage`) or the electronics serial entry (`serials.manage`).
 */
export function DeviceLabelButton({
  forWhat,
  onApply,
  className,
}: {
  forWhat: "jobcard" | "serial";
  onApply: (fill: Partial<DeviceFill>, warranty: Warranty | null) => void;
  className?: string;
}) {
  const { t, formatDate } = useI18n();
  const { show } = useTradesHelper("device-label-read", forWhat === "serial" ? "serials.manage" : "jobcards.manage");
  const errText = useTradesError();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [res, setRes] = React.useState<Result | null>(null);
  const [vals, setVals] = React.useState<Record<FieldKey, string>>({ brand: "", model: "", serial: "", imei1: "", imei2: "" });
  const [pick, setPick] = React.useState<Record<FieldKey, boolean>>({ brand: false, model: false, serial: false, imei1: false, imei2: false });
  if (!show) return null;

  const read = async (photos: { mediaType: string; data: string }[]) => {
    setBusy(true);
    setError(null);
    setRes(null);
    try {
      const r = await postTrades<Result>("device-label", { images: photos, for: forWhat });
      setRes(r);
      const d = r.draft;
      setVals({ brand: d.read.brand ?? "", model: d.read.model ?? "", serial: d.read.serial ?? "", imei1: d.read.imeis[0] ?? "", imei2: d.read.imeis[1] ?? "" });
      setPick({ brand: !!d.fill.brand, model: !!d.fill.model, serial: !!d.fill.serial, imei1: !!d.fill.imei1, imei2: !!d.fill.imei2 });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    const out: Partial<DeviceFill> = {};
    for (const k of FIELDS) if (pick[k] && vals[k].trim()) out[k] = vals[k].trim();
    onApply(out, res?.warranty ?? null);
    setOpen(false);
  };
  const flagFor = (k: FieldKey) => res?.draft.flags.find((f) => f.field === k && f.severity !== "info");
  const w = res?.warranty;

  return (
    <>
      <Button type="button" size="sm" variant="outline" className={className} onClick={() => setOpen(true)}>
        <ScanBarcodeIcon /> {t("web.aiTrades.device.button")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("web.aiTrades.device.title")}</DialogTitle>
            <DialogDescription>{t("web.aiTrades.device.intro")}</DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!res && (
            <div className="grid gap-2">
              <PhotoButton label={busy ? t("web.aiTrades.reading") : t("web.aiTrades.choosePhoto")} busy={busy} onPhotos={read} onError={setError} />
              <p className="text-meta text-muted-foreground">{t("web.aiTrades.credits", { count: DEVICE_LABEL_CREDITS })}</p>
            </div>
          )}
          {res && (
            <div className="grid gap-3">
              <AiDraftBanner runId={res.runId} credits={res.credits} mock={res.provider === "mock"} />
              <div className="grid gap-2">
                {FIELDS.map((k) => {
                  const flag = flagFor(k);
                  const isImei = k === "imei1" || k === "imei2";
                  if (!vals[k] && !pick[k]) return null;
                  const valid = isImei ? res.draft.imei.find((i) => i.value === vals[k])?.valid : undefined;
                  return (
                    <div key={k} className="grid gap-1 rounded-md border p-2">
                      <div className="flex items-center gap-2">
                        <Checkbox id={`dl-${k}`} checked={pick[k]} onCheckedChange={(v) => setPick((p) => ({ ...p, [k]: v === true }))} aria-label={t(`web.aiTrades.device.field.${k}`)} />
                        <Label htmlFor={`dl-${k}`} className="flex-1 text-sm font-medium">
                          {t(`web.aiTrades.device.field.${k}`)}
                        </Label>
                        {valid === true && <Badge variant="secondary">{t("web.aiTrades.device.imeiOk")}</Badge>}
                        {valid === false && <Badge variant="destructive">{t("web.aiTrades.device.imeiBad")}</Badge>}
                        {res.draft.lowFields.includes(k === "imei1" || k === "imei2" ? "imei" : k) && <Badge variant="outline">{t("web.aiTrades.lowConfidence")}</Badge>}
                      </div>
                      <Input
                        aria-label={t(`web.aiTrades.device.field.${k}`)}
                        value={vals[k]}
                        inputMode={isImei ? "numeric" : undefined}
                        className="font-mono"
                        onChange={(e) => setVals((p) => ({ ...p, [k]: e.target.value }))}
                      />
                      {flag && <p className="text-meta text-destructive">{t(`web.aiTrades.device.flag.${flag.code}`)}</p>}
                    </div>
                  );
                })}
              </div>
              {res.draft.flags.some((f) => f.code === "unreadable") && <p className="text-sm text-destructive">{t("web.aiTrades.unreadable")}</p>}
              {w && (
                <Alert>
                  <AlertDescription>
                    {w.state === "not_found" && t("web.aiTrades.device.warranty.notFound")}
                    {w.state === "not_sold" && t("web.aiTrades.device.warranty.notSold", { item: w.itemName ?? "" })}
                    {w.state === "no_warranty" && t("web.aiTrades.device.warranty.none", { item: w.itemName ?? "" })}
                    {(w.state === "in_warranty" || w.state === "expired") && w.warrantyEnd && w.soldOn && (
                      <>
                        {t(w.state === "in_warranty" ? "web.aiTrades.device.warranty.active" : "web.aiTrades.device.warranty.expired", {
                          item: w.itemName ?? "",
                          sold: formatDate(w.soldOn),
                          end: formatDate(w.warrantyEnd),
                          days: w.daysLeft ?? 0,
                        })}
                      </>
                    )}
                    <span className="mt-1 block text-meta text-muted-foreground">{t("web.aiTrades.device.warranty.source")}</span>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("web.common.close")}
            </Button>
            {res && (
              <>
                <PhotoButton variant="outline" label={t("web.aiTrades.retake")} busy={busy} onPhotos={read} onError={setError} />
                <Button type="button" onClick={apply} disabled={!FIELDS.some((k) => pick[k] && vals[k].trim())}>
                  {t("web.aiTrades.useChecked")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
