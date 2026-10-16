"use client";

import * as React from "react";
import { ArrowLeftIcon, ArrowRightIcon, GripVerticalIcon, ImagePlusIcon, Link2Icon, Loader2Icon, StarIcon, Trash2Icon, UploadCloudIcon } from "lucide-react";
import { AnimatePresence, Button, cn, Input, motion, Progress, toast } from "@srirealtime/ui";
import { absoluteUrl, describeError, useI18n } from "@srirealtime/web";
import { uploadImage } from "../lib/queries";
import type { ProductImage } from "../lib/types";
import { useDragSort } from "./sortable";

const MAX_IMAGES = 20;
const MAX_BYTES = 10 * 1024 * 1024;

interface PendingUpload {
  key: string;
  name: string;
  preview: string;
  progress: number;
}

/**
 * Product images: upload (sign → PUT → complete, public, purpose "product"), drag to reorder (or the arrow buttons),
 * alt text, remove. The first image is the main one.
 */
export function ImageManager({
  value,
  onChange,
  disabled,
  max = MAX_IMAGES,
  single,
}: {
  value: ProductImage[];
  onChange: (v: ProductImage[]) => void;
  disabled?: boolean;
  max?: number;
  /** One image only (categories, collections): no reordering, no alt list. */
  single?: boolean;
}) {
  const { t } = useI18n();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState<PendingUpload[]>([]);
  const [fileOver, setFileOver] = React.useState(false);
  const [urlOpen, setUrlOpen] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const latest = React.useRef(value);
  latest.current = value;
  const limit = single ? 1 : max;

  const sort = useDragSort(value, (img) => img.url, onChange);

  const upload = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) {
      toast.error(t("commerce.media.notImage"));
      return;
    }
    const room = limit - latest.current.length - pending.length;
    const chosen = single ? list.slice(0, 1) : list.slice(0, Math.max(0, room));
    if (!single && chosen.length < list.length) toast.warning(t("commerce.media.tooMany", { max: limit }));
    for (const file of chosen) {
      if (file.size > MAX_BYTES) {
        toast.error(t("commerce.media.tooBig", { name: file.name }));
        continue;
      }
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      const preview = URL.createObjectURL(file);
      setPending((p) => [...p, { key, name: file.name, preview, progress: 0 }]);
      try {
        const done = await uploadImage(file, {
          purpose: "product",
          onProgress: (progress) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress } : x))),
        });
        const img: ProductImage = { url: done.url, alt: "" };
        onChange(single ? [img] : [...latest.current, img]);
      } catch (err) {
        toast.error(t("commerce.media.failed", { name: file.name, reason: describeError(err, t) }));
      } finally {
        setPending((p) => p.filter((x) => x.key !== key));
        URL.revokeObjectURL(preview);
      }
    }
  };

  const addUrl = () => {
    const v = url.trim();
    try {
      const u = new URL(v);
      if (!/^https?:$/.test(u.protocol)) throw new Error("protocol");
    } catch {
      toast.error(t("commerce.media.badUrl"));
      return;
    }
    if (value.some((i) => i.url === v)) return;
    onChange(single ? [{ url: v, alt: "" }] : [...value, { url: v, alt: "" }]);
    setUrl("");
    setUrlOpen(false);
  };

  const full = value.length + pending.length >= limit;

  const dropZone = (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setFileOver(true);
      }}
      onDragLeave={() => setFileOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setFileOver(false);
        void upload(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 px-4 text-center transition-colors",
        single ? "aspect-[4/3] w-full max-w-56" : value.length === 0 ? "py-10" : "aspect-square",
        fileOver && "border-primary bg-primary/5",
      )}
    >
      <span className="icon-chip size-10 rounded-xl text-primary">
        <UploadCloudIcon className="size-5" />
      </span>
      <div className="space-y-0.5">
        <Button type="button" variant="link" className="h-auto p-0" onClick={() => inputRef.current?.click()} disabled={disabled || full}>
          {t("commerce.media.choose")}
        </Button>
        {(value.length === 0 || single) && <p className="text-meta text-muted-foreground">{t("commerce.media.dropHint")}</p>}
      </div>
    </div>
  );

  return (
    <div className="grid gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={!single}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = "";
        }}
      />

      {single && value[0] ? (
        <div className="flex items-start gap-3">
          <div className="relative aspect-[4/3] w-full max-w-56 overflow-hidden rounded-xl bg-muted ring-1 ring-border">
            {/* eslint-disable-next-line @next/next/no-img-element -- UI modules don't use next/image */}
            <img src={absoluteUrl(value[0].url)} alt="" className="size-full object-cover" />
          </div>
          <div className="grid gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
              <ImagePlusIcon /> {t("commerce.media.replace")}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => onChange([])} disabled={disabled}>
              <Trash2Icon /> {t("commerce.media.remove")}
            </Button>
          </div>
        </div>
      ) : single && pending[0] ? (
        <UploadingTile p={pending[0]} className="aspect-[4/3] w-full max-w-56" />
      ) : single ? (
        dropZone
      ) : value.length === 0 && pending.length === 0 ? (
        dropZone
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label={t("commerce.media.listLabel")}>
          <AnimatePresence initial={false}>
            {value.map((img, i) => (
              <motion.li
                key={img.url}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18 }}
                className="group grid content-start gap-1.5"
              >
                <div
                  {...(disabled ? {} : sort.itemProps(img.url))}
                  className={cn(
                    "relative aspect-square cursor-grab overflow-hidden rounded-xl bg-muted ring-1 ring-border transition-[box-shadow,opacity] active:cursor-grabbing",
                    "data-[dragging]:opacity-40 data-[over]:ring-2 data-[over]:ring-primary",
                    i === 0 && "ring-2 ring-primary/60",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- UI modules don't use next/image */}
                  <img src={absoluteUrl(img.url)} alt={img.alt || ""} className="pointer-events-none size-full object-cover" draggable={false} />
                  {i === 0 && (
                    <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground shadow-sm">
                      <StarIcon className="size-3 fill-current" /> {t("commerce.media.main")}
                    </span>
                  )}
                  <span className="absolute top-2 right-2 hidden rounded-md bg-background/80 p-1 text-muted-foreground backdrop-blur group-hover:inline-flex" aria-hidden>
                    <GripVerticalIcon className="size-4" />
                  </span>
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                    <div className="flex gap-1">
                      <IconBtn label={t("commerce.media.moveLeft")} disabled={disabled || i === 0} onClick={() => sort.move(i, -1)}>
                        <ArrowLeftIcon />
                      </IconBtn>
                      <IconBtn label={t("commerce.media.moveRight")} disabled={disabled || i === value.length - 1} onClick={() => sort.move(i, 1)}>
                        <ArrowRightIcon />
                      </IconBtn>
                    </div>
                    <IconBtn label={t("commerce.media.removeN", { n: i + 1 })} disabled={disabled} onClick={() => onChange(value.filter((x) => x.url !== img.url))}>
                      <Trash2Icon />
                    </IconBtn>
                  </div>
                </div>
                <Input
                  value={img.alt ?? ""}
                  disabled={disabled}
                  maxLength={200}
                  aria-label={t("commerce.media.altFor", { n: i + 1 })}
                  placeholder={t("commerce.media.alt")}
                  size="sm"
                  className="text-xs"
                  onChange={(e) => onChange(value.map((x) => (x.url === img.url ? { ...x, alt: e.target.value } : x)))}
                />
              </motion.li>
            ))}
            {pending.map((p) => (
              <motion.li key={p.key} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <UploadingTile p={p} className="aspect-square" />
              </motion.li>
            ))}
          </AnimatePresence>
          {!full && <li>{dropZone}</li>}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {!single && <span>{t("commerce.media.hint", { max: limit })}</span>}
        {urlOpen ? (
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Input
              autoFocus
              value={url}
              placeholder="https://"
              aria-label={t("commerce.media.urlLabel")}
              size="sm"
              className="sm:w-72"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addUrl();
                } else if (e.key === "Escape") setUrlOpen(false);
              }}
            />
            <Button type="button" size="sm" variant="secondary" onClick={addUrl}>
              {t("commerce.media.add")}
            </Button>
          </div>
        ) : (
          !full && (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setUrlOpen(true)} disabled={disabled}>
              <Link2Icon /> {t("commerce.media.fromUrl")}
            </Button>
          )
        )}
      </div>
    </div>
  );
}

function UploadingTile({ p, className }: { p: PendingUpload; className?: string }) {
  const { t } = useI18n();
  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-muted ring-1 ring-border", className)} aria-live="polite">
      {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
      <img src={p.preview} alt="" className="size-full object-cover opacity-50 blur-[1px]" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3">
        <Loader2Icon className="size-5 animate-spin text-primary" />
        <span className="text-xs font-medium">{t("commerce.media.uploading", { pct: p.progress })}</span>
        <Progress value={p.progress} className="h-1.5 w-3/4" />
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-md bg-background/90 text-foreground shadow-sm outline-none transition hover:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}
