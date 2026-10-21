"use client";

import * as React from "react";
import { Loader2Icon, RefreshCwIcon, Trash2Icon, VideoIcon, XIcon } from "lucide-react";
import { Button, cn, Progress, toast } from "@srirealtime/ui";
import { absoluteUrl, describeError, useI18n } from "@srirealtime/web";
import { checkMediaFile, useRefreshMedia, VIDEO_TYPES } from "../lib/media-library";
import { uploadImage } from "../lib/queries";
import { TextField } from "./bits";
import { LibraryButton } from "./image-field";

/**
 * The hero video: upload an MP4 / WebM (up to 50 MB, with progress and cancel), pick an earlier upload from the media
 * library, or paste a link. Shows the clip muted and looping once set.
 */
export function VideoField({
  id,
  label,
  hint,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (url: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const abort = React.useRef<AbortController | null>(null);
  const refresh = useRefreshMedia();
  const [over, setOver] = React.useState(false);
  const [busy, setBusy] = React.useState<{ name: string; progress: number } | null>(null);
  React.useEffect(() => () => abort.current?.abort(), []);

  const upload = async (files: FileList | File[]) => {
    const file = [...files][0];
    if (!file) return;
    const problem = checkMediaFile(file, "video");
    if (problem) {
      toast.error(problem === "type" ? t("site.media.notVideo") : t("site.media.videoTooBig", { name: file.name }));
      return;
    }
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy({ name: file.name, progress: 0 });
    try {
      const done = await uploadImage(file, { purpose: "site", signal: ctrl.signal, onProgress: (progress) => setBusy((b) => (b ? { ...b, progress } : b)) });
      onChange(done.url);
      refresh();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) toast.error(t("site.media.failed", { name: file.name, reason: describeError(err, t) }));
    } finally {
      abort.current = null;
      setBusy(null);
    }
  };

  return (
    <div className="grid content-start gap-2" data-video-field>
      <input
        ref={inputRef}
        type="file"
        accept={VIDEO_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = "";
        }}
      />
      <span className="text-sm font-medium">{label}</span>
      {busy ? (
        <div className="flex w-full max-w-md flex-col items-center justify-center gap-2 rounded-xl bg-muted px-4 py-8 ring-1 ring-border" aria-live="polite">
          <Loader2Icon className="size-5 animate-spin text-primary" />
          <span className="max-w-full truncate text-xs font-medium">{busy.name}</span>
          <span className="text-xs">{t("site.media.uploading", { pct: busy.progress })}</span>
          <Progress value={busy.progress} className="h-1.5 w-3/4" />
          <Button type="button" variant="ghost" size="sm" onClick={() => abort.current?.abort()}>
            <XIcon /> {t("site.common.cancel")}
          </Button>
        </div>
      ) : value ? (
        <div className="flex flex-wrap items-start gap-3">
          <div className="relative aspect-video w-full max-w-md overflow-hidden rounded-xl bg-black ring-1 ring-border">
            <video key={value} src={absoluteUrl(value)} muted loop autoPlay playsInline preload="metadata" className="size-full object-cover" aria-label={t("site.media.videoSelected")} />
          </div>
          <div className="flex gap-2 sm:grid">
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
              <RefreshCwIcon /> {t("site.media.replace")}
            </Button>
            <LibraryButton kind="video" onPick={onChange} disabled={disabled} />
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
            if (!disabled) void upload(e.dataTransfer.files);
          }}
          className={cn(
            "flex w-full max-w-md flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 px-4 py-6 text-center transition-colors",
            over && "border-primary bg-primary/5",
            error && "border-destructive/60",
          )}
        >
          <span className="icon-chip size-10 rounded-xl text-primary">
            <VideoIcon className="size-5" />
          </span>
          <Button type="button" variant="link" className="h-auto p-0" aria-label={label} onClick={() => inputRef.current?.click()} disabled={disabled}>
            {t("site.media.chooseVideo")}
          </Button>
          <p className="text-meta text-muted-foreground">{t("site.media.videoDropHint")}</p>
          <LibraryButton kind="video" onPick={onChange} disabled={disabled} />
        </div>
      )}
      {/* The link stays editable: a video hosted elsewhere (CDN, Drive) works too. */}
      <TextField id={id} label={t("site.media.fromVideoUrl")} hint={hint} placeholder="https://…/shop.mp4" value={value} disabled={disabled || !!busy} error={error} onChange={onChange} />
    </div>
  );
}
