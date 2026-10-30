"use client";

import * as React from "react";
import { AlertTriangleIcon, CheckCircle2Icon, DownloadIcon, FileTextIcon, InfoIcon, Loader2Icon, UploadCloudIcon } from "lucide-react";
import { Button, ChipGroup, cn, Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, toast } from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { useImportReviews } from "../lib/queries";
import type { ReviewImportResult } from "../lib/types";

const MAX_BYTES = 4 * 1024 * 1024;
const SAMPLE =
  "sku,rating,title,text,name,city,date,source,source_url,photos\n" +
  'SAREE-001,5,Lovely colour,"Soft cotton, colour same as the photo.",Priya Sharma,Madurai,2026-03-14,in_store,,\n' +
  "SAREE-002,4,Good fit,Stitching is neat. Delivery took 4 days.,K. Murugan,Salem,14/02/2026,google,https://maps.app.goo.gl/example,\n";

/** Rows shown in the check result (problem rows first); the counts always cover the whole file. */
const SHOW_ROWS = 200;

/**
 * "Import reviews": CSV upload → check (dry run: every row validated, nothing saved) → import the valid rows. Rows
 * with problems are skipped; importing the same file again finds the saved rows as duplicates.
 */
export function ImportReviewsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, formatNumber } = useI18n();
  const run = useImportReviews();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<{ name: string; csv: string } | null>(null);
  const [status, setStatus] = React.useState<"approved" | "pending">("approved");
  const [result, setResult] = React.useState<ReviewImportResult | null>(null);
  const [over, setOver] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setFile(null);
      setResult(null);
      setStatus("approved");
    }
  }, [open]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name) && f.type !== "text/csv") return toast.error(t("site.reviews.imp.notCsv"));
    if (f.size > MAX_BYTES) return toast.error(t("site.reviews.imp.tooBig"));
    const csv = await f.text();
    setFile({ name: f.name, csv });
    setResult(null);
    await check(csv);
  };

  const check = async (csv: string) => {
    try {
      setResult(await run.mutateAsync({ mode: "check", csv, status }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const doImport = async () => {
    if (!file) return;
    try {
      const r = await run.mutateAsync({ mode: "import", csv: file.csv, status });
      toast.success(t("site.reviews.imp.done", { count: r.imported }), r.invalid ? { description: t("site.reviews.imp.doneSkipped", { count: r.invalid }) } : undefined);
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const sample = () => {
    const url = URL.createObjectURL(new Blob([SAMPLE], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "reviews-sample.csv" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const rows = result ? [...result.rows].sort((a, b) => Number(b.errors.length > 0) - Number(a.errors.length > 0) || a.line - b.line).slice(0, SHOW_ROWS) : [];
  const busy = run.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" closeLabel={t("site.reviews.close")} className="w-full gap-0 sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle>{t("site.reviews.imp.title")}</SheetTitle>
          <SheetDescription>{t("site.reviews.imp.body")}</SheetDescription>
        </SheetHeader>
        <div className="grid flex-1 content-start gap-5 overflow-y-auto p-4">
          <div className="grid gap-2 rounded-xl bg-muted/50 p-3 text-meta text-muted-foreground ring-1 ring-border/60 ring-inset">
            <p>{t("site.reviews.imp.columns")}</p>
            <p>{t("site.reviews.imp.sources")}</p>
            <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={sample}>
              <DownloadIcon /> {t("site.reviews.imp.sample")}
            </Button>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void pick(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              "grid place-items-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              over ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40",
            )}
          >
            {file ? <FileTextIcon className="size-6 text-primary" aria-hidden /> : <UploadCloudIcon className="size-6 text-muted-foreground" aria-hidden />}
            <span className="font-medium">{file ? file.name : t("site.reviews.imp.choose")}</span>
            <span className="text-meta text-muted-foreground">{file ? t("site.reviews.imp.replace") : t("site.reviews.imp.chooseHint")}</span>
          </button>

          <div className="grid gap-2">
            <p className="text-sm font-medium">{t("site.reviews.f.status")}</p>
            <ChipGroup<"approved" | "pending">
              size="sm"
              aria-label={t("site.reviews.f.status")}
              value={status}
              onChange={setStatus}
              options={[
                { value: "approved", label: t("site.reviews.f.publish") },
                { value: "pending", label: t("site.reviews.f.hold") },
              ]}
            />
          </div>

          {busy && !result && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> {t("site.reviews.imp.checking")}
            </p>
          )}

          {result?.error && (
            <p role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" /> {result.error}
            </p>
          )}

          {result && !result.error && (
            <section aria-label={t("site.reviews.imp.result")} className="grid gap-3">
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 font-medium text-foreground">
                  <CheckCircle2Icon className="size-4 text-success" /> {t("site.reviews.imp.ready", { count: result.valid })}
                </span>
                {result.invalid > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 font-medium text-foreground">
                    <AlertTriangleIcon className="size-4 text-destructive" /> {t("site.reviews.imp.problems", { count: result.invalid })}
                  </span>
                )}
              </div>
              {result.invalid > 0 && <p className="text-meta text-muted-foreground">{t("site.reviews.imp.skipNote")}</p>}
              {/* One block per row (problem rows first): stays readable on a phone, unlike a wide table. */}
              <ul className="divide-y overflow-hidden rounded-xl ring-1 ring-border">
                {rows.map((r) => (
                  <li key={r.line} className={cn("grid gap-1 px-3 py-2.5 text-sm", r.errors.length > 0 && "bg-destructive/5")}>
                    <div className="flex min-w-0 items-center gap-x-3 gap-y-0.5">
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{t("site.reviews.imp.line")} {r.line}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{r.product || "—"}</span>
                      <span className="shrink-0 tabular-nums">{r.rating ? `${r.rating}★` : "—"}</span>
                      <span className="max-w-[35%] shrink-0 truncate text-muted-foreground">{r.name || "—"}</span>
                    </div>
                    {r.errors.length ? (
                      <ul className="grid gap-0.5 text-xs text-destructive">
                        {r.errors.map((e, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" aria-hidden /> {e}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-success-ink">
                        <CheckCircle2Icon className="size-3.5" aria-hidden /> {t("site.reviews.imp.ok")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {result.rows.length > SHOW_ROWS && <p className="text-meta text-muted-foreground">{t("site.reviews.imp.more", { shown: formatNumber(SHOW_ROWS), total: formatNumber(result.rows.length) })}</p>}
            </section>
          )}

          <p className="flex items-start gap-2 text-meta text-muted-foreground">
            <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("site.reviews.imp.honesty")}
          </p>
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("site.common.cancel")}
          </Button>
          <Button type="button" disabled={busy || !result || !!result.error || result.valid === 0} onClick={() => void doImport()}>
            {busy && result && <Loader2Icon className="animate-spin" />}
            {t("site.reviews.imp.import", { count: result?.valid ?? 0 })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
