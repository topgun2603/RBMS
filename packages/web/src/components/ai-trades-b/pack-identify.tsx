"use client";

import * as React from "react";
import { Alert, AlertDescription } from "@srirealtime/ui";
import { useI18n } from "../../lib/i18n";
import { AiDraftBanner } from "../ai-draft";
import { PhotoPicker, postB, useBError, useBHelper, type Photo } from "./shared";

export interface PackDraft {
  name: string;
  brand: string | null;
  product: string;
  size: string | null;
  unit: string;
  /** Paise. */
  mrp: number | null;
  price: number | null;
  barcode: string | null;
  categoryId: string | null;
  confidence: "low" | "medium" | "high";
  hsn: { hsn: string; description: string; gstRate: number } | null;
  existing: { id: string; name: string; match: string } | null;
  flags: string[];
}
export interface PackResult {
  draft: PackDraft;
  runId: string;
  credits: number;
}

/**
 * "Photo of the pack" for the counter's quick-add form: one photo, one vision call (about 4 to 8 seconds), and the form is filled
 * with a DRAFT (name, brand and size, printed MRP, category, usual GST). The cashier checks it and saves as usual. Shows a spinner
 * while it reads and the shared draft banner afterwards.
 */
export function PackPhotoButton({ onDraft, onClear, className }: { onDraft: (r: PackResult) => void; onClear?: () => void; className?: string }) {
  const { t } = useI18n();
  const { show } = useBHelper("pack-identify", "catalogue.manage");
  const errText = useBError();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [res, setRes] = React.useState<PackResult | null>(null);
  if (!show) return null;
  const read = async ([photo]: Photo[]) => {
    if (!photo) return;
    setBusy(true);
    setError(null);
    setRes(null);
    try {
      const r = await postB<PackResult>("pack", { image: { mediaType: photo.mediaType, data: photo.data } });
      setRes(r);
      onDraft(r);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
      URL.revokeObjectURL(photo.url);
    }
  };
  return (
    <div className={className ?? "grid gap-2"} data-slot="pack-photo">
      <div className="flex flex-wrap items-center gap-2">
        <PhotoPicker label={busy ? t("web.aiB.pack.reading") : t("web.aiB.pack.button")} busy={busy} onPhotos={(p) => void read(p)} onError={setError} variant="outline" size="sm" testId="ai-b-pack-input" />
        <span className="text-meta text-muted-foreground">{t("web.aiB.pack.hint")}</span>
      </div>
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("web.aiB.pack.wait")}
        </p>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {res && (
        <>
          {res.draft.existing && (
            <Alert>
              <AlertDescription>{t("web.aiB.pack.existing", { name: res.draft.existing.name })}</AlertDescription>
            </Alert>
          )}
          <AiDraftBanner runId={res.runId} credits={res.credits} readOnly onOutcome={() => onClear?.()} />
          <p className="text-meta text-muted-foreground">{t("web.aiB.pack.check")}</p>
        </>
      )}
    </div>
  );
}
