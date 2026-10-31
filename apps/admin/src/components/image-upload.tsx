"use client";

import * as React from "react";
import { ImageIcon, Loader2Icon, UploadIcon, XIcon } from "lucide-react";
import { Button, cn, Progress, toast } from "@rbms/ui";
import { absoluteUrl } from "@/lib/api";
import { describeError, useI18n } from "@/lib/i18n";
import { uploadFile } from "@/lib/upload";

export interface ImageUploadProps {
  value: string | null;
  onChange: (url: string | null) => void;
  purpose: string;
  /** Public by default: logos, favicons and avatars are served to everyone. */
  visibility?: "public" | "private";
  accept?: string;
  maxBytes?: number;
  shape?: "square" | "circle" | "wide";
  checkerboard?: boolean;
  dark?: boolean;
  className?: string;
}

/** Thumbnail + upload/replace/remove buttons, using the uploads sign → PUT → complete flow. */
export function ImageUpload({
  value,
  onChange,
  purpose,
  visibility = "public",
  accept = "image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon",
  maxBytes = 2 * 1024 * 1024,
  shape = "square",
  dark,
  className,
}: ImageUploadProps) {
  const { t } = useI18n();
  const input = React.useRef<HTMLInputElement>(null);
  const [progress, setProgress] = React.useState<number | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > maxBytes) {
      toast.error(t("admin.files.tooLarge", { max: `${Math.round(maxBytes / 1024 / 1024)} MB` }));
      return;
    }
    setProgress(0);
    try {
      const f = await uploadFile(file, { purpose, visibility, onProgress: setProgress });
      onChange(absoluteUrl(f.url));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden border",
          shape === "circle" ? "size-14 rounded-full" : shape === "wide" ? "h-14 w-28 rounded-md" : "size-14 rounded-md",
          dark
            ? "bg-neutral-900"
            : "bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:12px_12px]",
        )}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary uploaded URLs
          <img src={value} alt="" className="size-full object-contain p-1" />
        ) : (
          <ImageIcon className="size-5 text-muted-foreground" />
        )}
        {progress !== null && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Loader2Icon className="size-4 animate-spin" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" size="sm" variant="outline" disabled={progress !== null} onClick={() => input.current?.click()}>
            <UploadIcon /> {value ? t("admin.files.replace") : t("admin.files.upload")}
          </Button>
          {value && (
            <Button type="button" size="sm" variant="ghost" disabled={progress !== null} onClick={() => onChange(null)}>
              <XIcon /> {t("admin.common.remove")}
            </Button>
          )}
        </div>
        {progress !== null && <Progress value={progress} className="h-1" />}
      </div>
      <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
    </div>
  );
}
