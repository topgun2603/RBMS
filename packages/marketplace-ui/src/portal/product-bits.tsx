"use client";

import * as React from "react";
import { ArchiveIcon, ArrowLeftIcon, ArrowRightIcon, CheckCircle2Icon, ImagePlusIcon, Loader2Icon, PencilLineIcon, XIcon } from "lucide-react";
import { AnimatePresence, Button, cn, motion, Progress, StatusPill, toast, type StatusTone } from "@srirealtime/ui";
import { absoluteUrl, describeError, useI18n } from "@srirealtime/web";
import { uploadImage } from "../lib/queries";
import type { ProductImage, ProductStatus } from "../lib/types";

const STATUS: Record<ProductStatus, [StatusTone, React.ComponentType<{ className?: string }>]> = {
  draft: ["warning", PencilLineIcon],
  active: ["success", CheckCircle2Icon],
  archived: ["neutral", ArchiveIcon],
};

export function ProductStatusPill({ status, className }: { status: ProductStatus; className?: string }) {
  const { t } = useI18n();
  const [tone, icon] = STATUS[status];
  return (
    <StatusPill tone={tone} icon={icon} className={className}>
      {t(`marketplace.products.status.${status}`)}
    </StatusPill>
  );
}

export const MAX_IMAGES = 8;

/** Product photos: upload (uploads API, with progress), reorder, remove. The first photo is the cover. */
export function ImageManager({ images, onChange }: { images: ProductImage[]; onChange: (images: ProductImage[]) => void }) {
  const { t } = useI18n();
  const input = React.useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = React.useState<{ id: string; name: string; pct: number }[]>([]);
  const latest = React.useRef(images);
  latest.current = images;

  const add = async (files: FileList | null) => {
    if (!files) return;
    const room = MAX_IMAGES - latest.current.length - uploads.length;
    const list = Array.from(files).slice(0, Math.max(room, 0));
    if (files.length > list.length) toast.warning(t("marketplace.upload.limit", { max: MAX_IMAGES }));
    await Promise.all(
      list.map(async (file) => {
        if (!file.type.startsWith("image/")) return void toast.error(t("marketplace.upload.notImage"));
        if (file.size > 10 * 1024 * 1024) return void toast.error(t("marketplace.upload.tooBig"));
        const id = `${file.name}-${Math.random().toString(36).slice(2)}`;
        setUploads((u) => [...u, { id, name: file.name, pct: 0 }]);
        try {
          const f = await uploadImage(file, { onProgress: (pct) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, pct } : x))) });
          onChange([...latest.current, { url: f.url, alt: null }]);
        } catch (err) {
          toast.error(describeError(err, t));
        } finally {
          setUploads((u) => u.filter((x) => x.id !== id));
        }
      }),
    );
  };

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= images.length) return;
    const next = [...images];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        <AnimatePresence initial={false}>
          {images.map((img, i) => (
            <motion.div
              key={img.url}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className={cn("group relative aspect-square overflow-hidden rounded-xl border bg-muted", i === 0 && "ring-2 ring-primary/50")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- module packages don't use next/image */}
              <img src={absoluteUrl(img.url)} alt="" className="size-full object-cover" />
              {i === 0 && <span className="absolute top-1.5 left-1.5 rounded-md bg-primary px-1.5 py-0.5 text-[0.625rem] font-semibold text-primary-foreground">{t("marketplace.editor.cover")}</span>}
              <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <Button type="button" size="icon-sm" variant="secondary" className="size-7" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("marketplace.editor.moveLeft")}>
                  <ArrowLeftIcon className="size-3.5" />
                </Button>
                <Button type="button" size="icon-sm" variant="secondary" className="size-7" onClick={() => onChange(images.filter((_, k) => k !== i))} aria-label={t("marketplace.common.remove")}>
                  <XIcon className="size-3.5" />
                </Button>
                <Button type="button" size="icon-sm" variant="secondary" className="size-7" onClick={() => move(i, 1)} disabled={i === images.length - 1} aria-label={t("marketplace.editor.moveRight")}>
                  <ArrowRightIcon className="size-3.5" />
                </Button>
              </div>
            </motion.div>
          ))}
          {uploads.map((u) => (
            <motion.div key={u.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-2">
              <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
              <Progress value={u.pct} className="h-1.5 w-full" />
            </motion.div>
          ))}
        </AnimatePresence>
        {images.length + uploads.length < MAX_IMAGES && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-xs text-muted-foreground outline-none hover:border-primary/50 hover:bg-primary/5 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ImagePlusIcon className="size-5" />
            {t("marketplace.editor.addPhotos")}
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const files = e.target.files;
          void add(files).finally(() => (e.target.value = ""));
        }}
      />
    </div>
  );
}
