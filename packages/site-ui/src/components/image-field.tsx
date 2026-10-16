"use client";

import * as React from "react";
import { ArrowLeftIcon, ArrowRightIcon, ImagePlusIcon, Link2Icon, Loader2Icon, Trash2Icon, UploadCloudIcon } from "lucide-react";
import { AnimatePresence, Button, cn, Input, motion, Progress, toast } from "@srirealtime/ui";
import { absoluteUrl, describeError, useI18n } from "@srirealtime/web";
import type { ImageForm } from "../lib/blocks";
import { uploadImage } from "../lib/queries";
import { useDragSort } from "./sortable";

const MAX_BYTES = 10 * 1024 * 1024;

function useUploader(onDone: (url: string) => void) {
  const { t } = useI18n();
  const [pending, setPending] = React.useState<{ key: string; preview: string; progress: number }[]>([]);
  const upload = async (files: FileList | File[], max = Infinity) => {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) {
      toast.error(t("site.media.notImage"));
      return;
    }
    for (const file of list.slice(0, max)) {
      if (file.size > MAX_BYTES) {
        toast.error(t("site.media.tooBig", { name: file.name }));
        continue;
      }
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      const preview = URL.createObjectURL(file);
      setPending((p) => [...p, { key, preview, progress: 0 }]);
      try {
        const done = await uploadImage(file, {
          purpose: "site",
          onProgress: (progress) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress } : x))),
        });
        onDone(done.url);
      } catch (err) {
        toast.error(t("site.media.failed", { name: file.name, reason: describeError(err, t) }));
      } finally {
        setPending((p) => p.filter((x) => x.key !== key));
        URL.revokeObjectURL(preview);
      }
    }
  };
  return { pending, upload };
}

function UrlAdder({ onAdd, disabled }: { onAdd: (url: string) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const add = () => {
    const v = url.trim();
    try {
      const u = new URL(v);
      if (!/^https?:$/.test(u.protocol)) throw new Error("protocol");
    } catch {
      toast.error(t("site.media.badUrl"));
      return;
    }
    onAdd(v);
    setUrl("");
    setOpen(false);
  };
  if (!open)
    return (
      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(true)} disabled={disabled}>
        <Link2Icon /> {t("site.media.fromUrl")}
      </Button>
    );
  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <Input
        autoFocus
        value={url}
        placeholder="https://"
        aria-label={t("site.media.urlLabel")}
        size="sm"
        className="sm:w-72"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      <Button type="button" size="sm" variant="secondary" onClick={add}>
        {t("site.media.add")}
      </Button>
    </div>
  );
}

/**
 * One image: upload (sign → PUT → complete), paste a URL, replace, remove. `aspect` sets the frame
 * ("aspect-[16/6]" for hero banners, "aspect-[4/5]" for phone images …).
 */
export function ImageField({
  value,
  onChange,
  disabled,
  aspect = "aspect-[4/3]",
  label,
  invalid,
  className,
}: {
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  aspect?: string;
  /** Accessible name for the upload button. */
  label?: string;
  invalid?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const { pending, upload } = useUploader(onChange);
  const busy = pending[0];

  return (
    <div className={cn("grid gap-2", className)}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files, 1);
          e.target.value = "";
        }}
      />
      {busy ? (
        <div className={cn("relative w-full max-w-md overflow-hidden rounded-xl bg-muted ring-1 ring-border", aspect)} aria-live="polite">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
          <img src={busy.preview} alt="" className="size-full object-cover opacity-50 blur-[1px]" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3">
            <Loader2Icon className="size-5 animate-spin text-primary" />
            <span className="text-xs font-medium">{t("site.media.uploading", { pct: busy.progress })}</span>
            <Progress value={busy.progress} className="h-1.5 w-3/4" />
          </div>
        </div>
      ) : value ? (
        <div className="flex flex-wrap items-start gap-3">
          <div className={cn("relative w-full max-w-md overflow-hidden rounded-xl bg-muted ring-1 ring-border", aspect)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- UI modules don't use next/image */}
            <img src={absoluteUrl(value)} alt="" className="size-full object-cover" />
          </div>
          <div className="flex gap-2 sm:grid">
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
              <ImagePlusIcon /> {t("site.media.replace")}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => onChange("")} disabled={disabled}>
              <Trash2Icon /> {t("site.media.remove")}
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            setOver(false);
            void upload(e.dataTransfer.files, 1);
          }}
          className={cn(
            "flex w-full max-w-md flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 px-4 py-6 text-center transition-colors",
            over && "border-primary bg-primary/5",
            invalid && "border-destructive/60",
          )}
        >
          <span className="icon-chip size-10 rounded-xl text-primary">
            <UploadCloudIcon className="size-5" />
          </span>
          <Button type="button" variant="link" className="h-auto p-0" aria-label={label} onClick={() => inputRef.current?.click()} disabled={disabled}>
            {t("site.media.choose")}
          </Button>
          <p className="text-meta text-muted-foreground">{t("site.media.dropHint")}</p>
        </div>
      )}
      {!value && !busy && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <UrlAdder onAdd={onChange} disabled={disabled} />
        </div>
      )}
    </div>
  );
}

/** Gallery block images: upload several, reorder (drag or arrows), alt text and caption each. */
export function GalleryField({
  value,
  onChange,
  max,
  disabled,
}: {
  value: ImageForm[];
  onChange: (v: ImageForm[]) => void;
  max: number;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const latest = React.useRef(value);
  latest.current = value;
  const { pending, upload } = useUploader((url) => onChange([...latest.current, { url, alt: "", caption: "" }]));
  const keyed = value.map((v, i) => ({ ...v, k: `${v.url}#${i}` }));
  const sort = useDragSort(keyed, (x) => x.k, (next) => onChange(next.map(({ k: _k, ...rest }) => rest)));
  const full = value.length + pending.length >= max;
  const patch = (i: number, p: Partial<ImageForm>) => onChange(value.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <div className="grid gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files, Math.max(0, max - value.length - pending.length));
          e.target.value = "";
        }}
      />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label={t("site.blocks.gallery")}>
        <AnimatePresence initial={false}>
          {keyed.map((img, i) => (
            <motion.li key={img.k} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="grid content-start gap-1.5">
              <div
                {...(disabled ? {} : sort.itemProps(img.k))}
                className="group relative aspect-square cursor-grab overflow-hidden rounded-xl bg-muted ring-1 ring-border data-[dragging]:opacity-40 data-[over]:ring-2 data-[over]:ring-primary"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- UI modules don't use next/image */}
                <img src={absoluteUrl(img.url)} alt={img.alt} className="pointer-events-none size-full object-cover" draggable={false} />
                <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5">
                  <div className="flex gap-1">
                    <IconBtn label={t("site.common.moveLeft")} disabled={disabled || i === 0} onClick={() => sort.move(i, -1)}>
                      <ArrowLeftIcon />
                    </IconBtn>
                    <IconBtn label={t("site.common.moveRight")} disabled={disabled || i === value.length - 1} onClick={() => sort.move(i, 1)}>
                      <ArrowRightIcon />
                    </IconBtn>
                  </div>
                  <IconBtn label={t("site.media.removeN", { n: i + 1 })} disabled={disabled} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                    <Trash2Icon />
                  </IconBtn>
                </div>
              </div>
              <Input value={img.alt} disabled={disabled} maxLength={200} aria-label={t("site.media.altFor", { n: i + 1 })} placeholder={t("site.media.alt")} size="sm" className="text-xs" onChange={(e) => patch(i, { alt: e.target.value })} />
              <Input value={img.caption} disabled={disabled} maxLength={300} aria-label={t("site.media.captionFor", { n: i + 1 })} placeholder={t("site.media.caption")} size="sm" className="text-xs" onChange={(e) => patch(i, { caption: e.target.value })} />
            </motion.li>
          ))}
          {pending.map((p) => (
            <motion.li key={p.key} layout className="relative aspect-square overflow-hidden rounded-xl bg-muted ring-1 ring-border">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
              <img src={p.preview} alt="" className="size-full object-cover opacity-50" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3">
                <Loader2Icon className="size-5 animate-spin text-primary" />
                <Progress value={p.progress} className="h-1.5 w-3/4" />
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
        {!full && (
          <li>
            <button
              type="button"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 text-sm text-primary outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <UploadCloudIcon className="size-5" />
              {t("site.media.choose")}
            </button>
          </li>
        )}
      </ul>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{t("site.media.galleryHint", { max })}</span>
        {!full && <UrlAdder onAdd={(url) => onChange([...value, { url, alt: "", caption: "" }])} disabled={disabled} />}
      </div>
    </div>
  );
}

export function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
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
