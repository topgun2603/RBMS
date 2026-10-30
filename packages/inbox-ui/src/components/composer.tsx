"use client";

import * as React from "react";
import { FileIcon, Loader2Icon, RotateCcwIcon, XIcon } from "lucide-react";
import { cn, toast } from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { fileSize } from "../lib/format";
import { FILE_MAX_BYTES, IMAGE_MAX_BYTES, uploadFile } from "../lib/uploads";
import type { UploadedFile } from "../lib/types";

/** Textarea that grows with its content up to `maxRows`; Enter sends, Shift+Enter adds a line (not on touch keyboards). */
export const AutoTextarea = React.forwardRef<
  HTMLTextAreaElement,
  Omit<React.ComponentProps<"textarea">, "onSubmit"> & { onSubmit?: () => void; maxRows?: number }
>(function AutoTextarea({ className, onSubmit, maxRows = 8, onKeyDown, value, ...props }, outer) {
  const inner = React.useRef<HTMLTextAreaElement | null>(null);
  React.useImperativeHandle(outer, () => inner.current!);
  React.useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, line * maxRows + 16)}px`;
  }, [value, maxRows]);
  return (
    <textarea
      ref={inner}
      rows={1}
      value={value}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !coarse && onSubmit) {
          e.preventDefault();
          onSubmit();
        }
      }}
      className={cn(
        "min-h-10 w-full resize-none rounded-xl border border-input bg-card px-3 py-2 text-base leading-6 shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50 md:text-sm dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
});

export interface PendingUpload {
  key: string;
  file: File;
  preview: string | null;
  progress: number;
  done: UploadedFile | null;
  error: string | null;
}

/** Uploads picked files right away (sign → PUT → complete) and tracks progress; the composer sends once all are done. */
export function useUploads(purpose: string, opts: { imagesOnly?: boolean; max?: number } = {}) {
  const { t } = useI18n();
  const [items, setItems] = React.useState<PendingUpload[]>([]);
  const controllers = React.useRef(new Map<string, AbortController>());

  const patch = (key: string, p: Partial<PendingUpload>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const start = React.useCallback(
    (item: PendingUpload) => {
      const ctrl = new AbortController();
      controllers.current.set(item.key, ctrl);
      uploadFile(item.file, { purpose, signal: ctrl.signal, onProgress: (progress) => patch(item.key, { progress }) })
        .then((done) => patch(item.key, { done, progress: 100, error: null }))
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          patch(item.key, { error: describeError(err, t) });
        });
    },
    [purpose, t],
  );

  const add = React.useCallback(
    (files: FileList | File[]) => {
      const list = [...files].slice(0, Math.max(0, (opts.max ?? 10) - items.length));
      const accepted: PendingUpload[] = [];
      for (const file of list) {
        const isImage = file.type.startsWith("image/");
        if (opts.imagesOnly && !isImage) {
          toast.error(t("inbox.upload.imagesOnly"));
          continue;
        }
        if (file.size > (isImage ? IMAGE_MAX_BYTES : FILE_MAX_BYTES)) {
          toast.error(t("inbox.upload.tooBig", { name: file.name, size: fileSize(isImage ? IMAGE_MAX_BYTES : FILE_MAX_BYTES) }));
          continue;
        }
        accepted.push({ key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, preview: isImage ? URL.createObjectURL(file) : null, progress: 0, done: null, error: null });
      }
      if (!accepted.length) return;
      setItems((prev) => [...prev, ...accepted]);
      accepted.forEach(start);
    },
    [items.length, opts.imagesOnly, opts.max, start, t],
  );

  const remove = React.useCallback((key: string) => {
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
    setItems((list) => {
      const it = list.find((i) => i.key === key);
      if (it?.preview) URL.revokeObjectURL(it.preview);
      return list.filter((i) => i.key !== key);
    });
  }, []);

  const retry = React.useCallback(
    (key: string) => {
      const it = items.find((i) => i.key === key);
      if (!it) return;
      patch(key, { error: null, progress: 0 });
      start(it);
    },
    [items, start],
  );

  const clear = React.useCallback(() => {
    setItems((list) => {
      for (const i of list) if (i.preview) URL.revokeObjectURL(i.preview);
      return [];
    });
    controllers.current.clear();
  }, []);

  const ready = items.every((i) => i.done);
  const busy = items.some((i) => !i.done && !i.error);
  return { items, add, remove, retry, clear, ready, busy };
}

/** Thumbnails of picked files with progress, retry and remove. */
export function UploadTray({ uploads }: { uploads: ReturnType<typeof useUploads> }) {
  const { t } = useI18n();
  if (!uploads.items.length) return null;
  return (
    <ul className="flex gap-2 overflow-x-auto px-1 pt-1 pb-2" aria-label={t("inbox.upload.attachments")}>
      {uploads.items.map((u) => (
        <li key={u.key} className="relative size-16 shrink-0 overflow-hidden rounded-xl border bg-muted">
          {u.preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- UI modules don't use next/image
            <img src={u.preview} alt={u.file.name} className="size-full object-cover" />
          ) : (
            <span className="flex size-full flex-col items-center justify-center gap-1 p-1 text-[0.625rem] text-muted-foreground">
              <FileIcon className="size-4" aria-hidden />
              <span className="line-clamp-2 w-full text-center break-all">{u.file.name}</span>
            </span>
          )}
          {!u.done && !u.error && (
            <span className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Loader2Icon className="size-4 animate-spin" aria-hidden />
              <span className="sr-only">{t("inbox.upload.progress", { pct: u.progress })}</span>
              <span className="absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full bg-primary transition-[width]" style={{ width: `${u.progress}%` }} />
              </span>
            </span>
          )}
          {u.error && (
            <button
              type="button"
              onClick={() => uploads.retry(u.key)}
              title={u.error}
              className="absolute inset-0 flex items-center justify-center bg-destructive/70 text-white outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("inbox.upload.retry", { name: u.file.name })}
            >
              <RotateCcwIcon className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => uploads.remove(u.key)}
            className="absolute top-0.5 right-0.5 inline-flex size-5 items-center justify-center rounded-full bg-background/90 shadow outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("inbox.common.removeNamed", { name: u.file.name })}
          >
            <XIcon className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}
