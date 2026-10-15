"use client";

import * as React from "react";
import { ExternalLinkIcon, FileTextIcon, ImageIcon, ReplyIcon, VideoIcon } from "lucide-react";
import { cn } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import type { TemplatePreview } from "../lib/templates";

/** What the customer will see: a WhatsApp-style bubble with header, body, footer and buttons. Unfilled slots are highlighted. */
export function TemplatePreviewCard({
  preview,
  mediaType,
  mediaLink,
  className,
}: {
  preview: TemplatePreview;
  mediaType?: "image" | "document" | "video" | null;
  mediaLink?: string | null;
  className?: string;
}) {
  const { t } = useI18n();
  const MediaIcon = mediaType === "image" ? ImageIcon : mediaType === "video" ? VideoIcon : FileTextIcon;
  return (
    <figure
      className={cn(
        "rounded-2xl bg-[oklch(0.94_0.03_150)] p-3 dark:bg-[oklch(0.27_0.03_160)]",
        "[background-image:radial-gradient(circle_at_1px_1px,oklch(0_0_0/0.05)_1px,transparent_0)] [background-size:14px_14px]",
        className,
      )}
      aria-label={t("inbox.tpl.preview")}
    >
      <div className="max-w-sm rounded-xl rounded-tl-sm bg-card p-2.5 text-sm shadow-sm" aria-live="polite">
        {mediaType && (
          <div className="mb-2 flex h-28 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
            {mediaType === "image" && mediaLink ? (
              // eslint-disable-next-line @next/next/no-img-element -- UI modules don't use next/image
              <img src={mediaLink} alt="" className="size-full object-cover" />
            ) : (
              <MediaIcon className="size-6" aria-hidden />
            )}
          </div>
        )}
        {preview.header && <p className="mb-1 font-semibold">{highlight(preview.header)}</p>}
        <p className="break-words whitespace-pre-wrap">{highlight(preview.body) || <span className="text-muted-foreground">{t("inbox.tpl.emptyBody")}</span>}</p>
        {preview.footer && <p className="mt-1 text-xs text-muted-foreground">{preview.footer}</p>}
        {preview.buttons.length > 0 && (
          <div className="mt-2 grid gap-1 border-t pt-1.5">
            {preview.buttons.map((b, i) => (
              <span key={i} className="flex items-center justify-center gap-1.5 py-1 text-xs font-medium text-info-ink">
                {b.type.toUpperCase() === "URL" ? <ExternalLinkIcon className="size-3.5" aria-hidden /> : <ReplyIcon className="size-3.5" aria-hidden />}
                {b.text}
              </span>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}

/** Marks `{{x}}` placeholders that are still empty. */
function highlight(text: string): React.ReactNode {
  const parts = text.split(/(\{\{\s*[A-Za-z0-9_]+\s*\}\})/g);
  return parts.map((p, i) =>
    /^\{\{/.test(p) ? (
      <mark key={i} className="rounded bg-warning/25 px-0.5 text-warning-ink">
        {p}
      </mark>
    ) : (
      <React.Fragment key={i}>{p}</React.Fragment>
    ),
  );
}
