"use client";

import * as React from "react";
import { CameraIcon, FileUpIcon, Loader2Icon, ScanLineIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@srirealtime/ui";
import { useI18n, useSettingsHref } from "@srirealtime/web";
import {
  SCAN_BILL_CREDITS,
  SCAN_RECEIPT_CREDITS,
  ScanFileError,
  prepareScan,
  scanErrorKind,
  useScanBill,
  useScanReceipt,
  type BillDraft,
  type ReceiptDraft,
  type ScanErrorKind,
  type ScanResult,
} from "../../lib/ai-scan";

type Kind = "bill" | "receipt";
type Props<K extends Kind> = {
  kind: K;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The draft, plus the files that were read (so the receipt photo can be attached to the expense). */
  onDraft: (result: ScanResult<K extends "bill" ? BillDraft : ReceiptDraft>, files: File[]) => void;
};

/**
 * "Scan supplier bill" / "Scan receipt": pick or take a photo (or a PDF), the AI reads it and the parent fills its form
 * with the draft. Shows what it costs before scanning and a clear message when AI is off, credits are used up or the
 * photo cannot be read. Nothing is saved here.
 */
export function ScanDialog<K extends Kind>({ kind, open, onOpenChange, onDraft }: Props<K>) {
  const { t } = useI18n();
  const settingsHref = useSettingsHref();
  const bill = useScanBill();
  const receipt = useScanReceipt();
  const [error, setError] = React.useState<{ kind: ScanErrorKind | "file"; file?: string; text?: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const camera = React.useRef<HTMLInputElement>(null);
  const picker = React.useRef<HTMLInputElement>(null);
  const credits = kind === "bill" ? SCAN_BILL_CREDITS : SCAN_RECEIPT_CREDITS;

  React.useEffect(() => {
    if (open) {
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const run = async (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const body = await prepareScan(files);
      const result = kind === "bill" ? await bill.mutateAsync(body) : await receipt.mutateAsync(body);
      onDraft(result as never, files);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ScanFileError) setError({ kind: "file", file: err.kind });
      else setError({ kind: scanErrorKind(err), text: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const key = kind === "bill" ? "bill" : "receipt";
  const message = (): string => {
    if (!error) return "";
    if (error.kind === "file") return t(`billing.ai.err.file.${error.file}`);
    if (error.kind === "other") return error.text || t("billing.ai.err.other");
    return t(`billing.ai.err.${error.kind}`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLineIcon className="size-5 text-primary" aria-hidden /> {t(`billing.ai.${key}.title`)}
          </DialogTitle>
          <DialogDescription>{t(`billing.ai.${key}.hint`)}</DialogDescription>
        </DialogHeader>

        {busy ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center" role="status" aria-live="polite">
            <Loader2Icon className="size-8 animate-spin text-primary" aria-hidden />
            <p className="font-medium">{t(`billing.ai.${key}.reading`)}</p>
            <p className="text-meta text-muted-foreground">{t("billing.ai.readingHint")}</p>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" size="lg" className="h-12" onClick={() => camera.current?.click()}>
                <CameraIcon /> {t("billing.ai.takePhoto")}
              </Button>
              <Button type="button" size="lg" variant="outline" className="h-12" onClick={() => picker.current?.click()}>
                <FileUpIcon /> {t("billing.ai.choose")}
              </Button>
            </div>
            <p className="text-center text-meta text-muted-foreground">{t("billing.ai.cost", { n: credits })}</p>
            <p className="flex items-start gap-1.5 text-meta text-muted-foreground">
              <ShieldCheckIcon className="mt-px size-3.5 shrink-0" aria-hidden /> {t("billing.ai.privacy")}
            </p>
            {error && (
              <div role="alert" className="grid gap-1.5 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                <p className="flex items-start gap-2">
                  <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> <span>{message()}</span>
                </p>
                {error.kind === "off" && (
                  <a className="ml-6 font-medium underline" href={settingsHref("ai")}>
                    {t("billing.ai.openSettings")}
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} data-testid="scan-camera" onChange={(e) => { void run(e.target.files); e.target.value = ""; }} />
        <input ref={picker} type="file" accept="image/*,application/pdf" multiple className="sr-only" tabIndex={-1} data-testid="scan-file" onChange={(e) => { void run(e.target.files); e.target.value = ""; }} />
      </DialogContent>
    </Dialog>
  );
}
