"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, Loader2Icon, SparklesIcon, Undo2Icon, XIcon } from "lucide-react";
import { Alert, AlertDescription, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, toast } from "@srirealtime/ui";
import { useI18n } from "../../lib/i18n";
import { FESTIVE, getImg, postImg, reasonKey, useImgError, useImgHelper, type CleanStyle, type CleanupBatch, type CleanupItem, type ImagingStatus, type ProductImage } from "./shared";

export interface CleanTarget {
  productId: string;
  /** One of the product's photos; omitted = its first photo. */
  imageUrl?: string;
}

interface Props {
  /** What to clean. Give `items`, or `loadItems` to look them up when the person starts (clean all). */
  items?: CleanTarget[];
  loadItems?: () => Promise<CleanTarget[]>;
  label?: string;
  className?: string;
  variant?: "outline" | "ghost" | "secondary" | "default";
  size?: "sm" | "default" | "lg";
  testId?: string;
  /** Called when a photo is swapped in or put back, with the product's image list after the change. */
  onImages?: (productId: string, images: ProductImage[]) => void;
}

const STYLES: { key: CleanStyle; label: string }[] = [
  { key: "white", label: "web.aiImg.style.white" },
  { key: "shadow", label: "web.aiImg.style.shadow" },
  { key: "color", label: "web.aiImg.style.color" },
];

/**
 * "Clean up photo": removes the background of product photos on our server and shows before and after. The original is never
 * replaced until the owner chooses "Use cleaned", and "Use original again" undoes it. Doubtful results are marked "Needs a
 * manual check". Used for one product (its photos) and for "Clean all photos" in the products list.
 */
export function CleanPhotosButton({ items, loadItems, label, className, variant = "outline", size = "lg", testId, onImages }: Props) {
  const { t } = useI18n();
  const { show } = useImgHelper("image-cleanup");
  const errText = useImgError();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [style, setStyle] = React.useState<CleanStyle>("white");
  const [color, setColor] = React.useState(FESTIVE[0]!.hex);
  const [batchId, setBatchId] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const status = useQuery({ queryKey: ["ai-img", "status"], queryFn: () => getImg<ImagingStatus>("status"), enabled: open, staleTime: 30_000, retry: false });
  const batch = useQuery({
    queryKey: ["ai-img", "batch", batchId],
    queryFn: () => getImg<CleanupBatch>(`cleanups/batch/${batchId}`),
    enabled: !!batchId,
    refetchInterval: (q) => (q.state.data?.finished ? false : 1200),
  });
  const b = batch.data;
  if (!show) return null;

  const reset = () => {
    setBatchId(null);
    setError(null);
    setBusy(null);
  };
  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const list = items ?? (await loadItems?.()) ?? [];
      if (list.length === 0) throw new Error("none");
      const r = await postImg<{ batchId: string }>("cleanups", { items: list, style, color: style === "color" ? color : undefined });
      setBatchId(r.batchId);
    } catch (e) {
      setError(e instanceof Error && e.message === "none" ? t("web.aiImg.nothing") : errText(e));
    } finally {
      setStarting(false);
    }
  };
  const act = async (it: CleanupItem, what: "apply" | "revert" | "discard") => {
    setBusy(it.id);
    setError(null);
    try {
      const r = await postImg<{ images?: ProductImage[] }>(`cleanups/${it.id}/${what}`);
      if (r.images) onImages?.(it.productId, r.images);
      await batch.refetch();
      void qc.invalidateQueries({ queryKey: ["catalog"] });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const applyReady = async () => {
    if (!batchId) return;
    setBusy("all");
    try {
      const r = await postImg<{ applied: number; skipped: number }>(`cleanups/batch/${batchId}/apply-ready`);
      toast.success(t("web.aiImg.appliedMany", { count: r.applied }));
      await batch.refetch();
      void qc.invalidateQueries();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const price = status.data?.creditsPerImage ?? 0;
  const notInstalled = status.data && !status.data.installed;

  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} data-testid={testId ?? "clean-photos"} onClick={() => setOpen(true)}>
        <SparklesIcon /> {label ?? t("web.aiImg.button")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (starting) return;
          setOpen(o);
          if (!o && b?.finished) reset();
        }}
      >
        <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("web.aiImg.title")}</DialogTitle>
            <DialogDescription>{t("web.aiImg.intro")}</DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {notInstalled && (
            <Alert variant="destructive">
              <AlertDescription>{t("web.aiImg.notInstalled")}</AlertDescription>
            </Alert>
          )}

          {!batchId && (
            <div className="grid gap-4">
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">{t("web.aiImg.backdrop")}</legend>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("web.aiImg.backdrop")}>
                  {STYLES.map((s) => (
                    <Button key={s.key} type="button" role="radio" aria-checked={style === s.key} variant={style === s.key ? "default" : "outline"} size="sm" onClick={() => setStyle(s.key)}>
                      {t(s.label)}
                    </Button>
                  ))}
                </div>
                {style === "color" && (
                  <div className="flex flex-wrap items-center gap-2" aria-label={t("web.aiImg.festive")}>
                    {FESTIVE.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        aria-label={t(`web.aiImg.festive.${f.key}`)}
                        aria-pressed={color === f.hex}
                        title={t(`web.aiImg.festive.${f.key}`)}
                        onClick={() => setColor(f.hex)}
                        className={`size-9 rounded-full ring-1 ring-border ${color === f.hex ? "outline-2 outline-offset-2 outline-primary" : ""}`}
                        style={{ background: f.hex }}
                      />
                    ))}
                    <label className="flex items-center gap-2 text-sm">
                      {t("web.aiImg.custom")}
                      <Input type="color" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} className="h-9 w-14 p-1" />
                    </label>
                  </div>
                )}
              </fieldset>
              <p className="text-meta text-muted-foreground">{price > 0 ? t("web.aiImg.priced", { credits: price }) : t("web.aiImg.free")}</p>
              <p className="text-meta text-muted-foreground">{t("web.aiImg.keeps")}</p>
            </div>
          )}

          {batchId && b && !b.finished && (
            <div className="grid gap-2" role="status" aria-live="polite">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Loader2Icon className="size-4 animate-spin" /> {t("web.aiImg.progress", { done: b.done, total: b.total })}
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${b.total ? Math.max(4, Math.round((100 * b.done) / b.total)) : 4}%` }} />
              </div>
            </div>
          )}

          {b && (
            <div className="grid gap-3">
              {b.finished && (
                <p className="text-sm" role="status">
                  {t("web.aiImg.summary", { ready: b.ready, check: b.check, failed: b.failed })}
                </p>
              )}
              <ul className="grid gap-3 sm:grid-cols-2">
                {b.items.map((it) => (
                  <li key={it.id} className="grid gap-2 rounded-xl p-2 ring-1 ring-border" data-testid="clean-item" data-status={it.status}>
                    <div className="grid grid-cols-2 gap-2">
                      <figure className="grid gap-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={it.originalUrl} alt={t("web.aiImg.before")} className="aspect-square w-full rounded-lg bg-muted object-contain" />
                        <figcaption className="text-meta text-muted-foreground">{t("web.aiImg.before")}</figcaption>
                      </figure>
                      <figure className="grid gap-1">
                        {it.cleanedUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.cleanedUrl} alt={t("web.aiImg.after")} className="aspect-square w-full rounded-lg bg-muted object-contain" />
                        ) : (
                          <div className="grid aspect-square w-full place-items-center rounded-lg bg-muted text-muted-foreground">
                            {it.status === "queued" || it.status === "running" ? <Loader2Icon className="size-5 animate-spin" /> : <XIcon className="size-5" />}
                          </div>
                        )}
                        <figcaption className="text-meta text-muted-foreground">{t("web.aiImg.after")}</figcaption>
                      </figure>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge it={it} />
                      {it.needsCheck && <span className="text-meta text-muted-foreground">{it.reasons.map((r) => t(reasonKey(r))).join(" ")}</span>}
                      {it.status === "failed" && <span className="text-meta text-destructive">{it.error === "no_product_found" ? t("web.aiImg.noProduct") : t("web.aiImg.failed")}</span>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(it.status === "ready" || it.status === "check") && (
                        <>
                          <Button type="button" size="sm" disabled={busy !== null} onClick={() => void act(it, "apply")} data-testid="clean-apply">
                            <CheckIcon /> {t("web.aiImg.use")}
                          </Button>
                          <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void act(it, "discard")}>
                            {t("web.aiImg.keep")}
                          </Button>
                        </>
                      )}
                      {it.status === "applied" && (
                        <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void act(it, "revert")} data-testid="clean-revert">
                          <Undo2Icon /> {t("web.aiImg.undo")}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter className="gap-2">
            {!batchId && (
              <Button type="button" onClick={() => void start()} disabled={starting || !!notInstalled} data-testid="clean-start">
                {starting ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} {t("web.aiImg.start")}
              </Button>
            )}
            {b?.finished && b.ready > 0 && (
              <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void applyReady()}>
                {t("web.aiImg.useAll", { count: b.ready })}
              </Button>
            )}
            {b?.finished && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                {t("web.aiImg.done")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatusBadge({ it }: { it: CleanupItem }) {
  const { t } = useI18n();
  switch (it.status) {
    case "queued":
    case "running":
      return <Badge variant="secondary">{t("web.aiImg.status.running")}</Badge>;
    case "ready":
      return <Badge variant="secondary">{t("web.aiImg.status.ready")}</Badge>;
    case "check":
      return <Badge variant="destructive">{t("web.aiImg.status.check")}</Badge>;
    case "applied":
      return <Badge>{t("web.aiImg.status.applied")}</Badge>;
    case "discarded":
      return <Badge variant="outline">{t("web.aiImg.status.kept")}</Badge>;
    default:
      return <Badge variant="destructive">{t("web.aiImg.status.failed")}</Badge>;
  }
}
