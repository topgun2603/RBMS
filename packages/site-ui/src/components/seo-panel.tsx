"use client";

import * as React from "react";
import { SearchIcon } from "lucide-react";
import { cn, Label, Switch, Textarea } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import type { SeoFields } from "../lib/types";
import { FieldError, Optional, Section, TextField } from "./bits";
import { ImageField } from "./image-field";

export interface SeoForm {
  title: string;
  description: string;
  imageUrl: string;
  noindex: boolean;
}

export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 320;
/** Lengths Google usually shows before cutting with "…". */
const SNIPPET_TITLE = 60;
const SNIPPET_DESCRIPTION = 160;

export const toSeoForm = (s: SeoFields | null | undefined): SeoForm => ({
  title: s?.title ?? "",
  description: s?.description ?? "",
  imageUrl: s?.imageUrl ?? "",
  noindex: !!s?.noindex,
});

/** `seoSchema` input; null when every field is empty (no override). */
export function fromSeoForm(f: SeoForm): SeoFields | null {
  const out: SeoFields = {
    ...(f.title.trim() ? { title: f.title.trim() } : {}),
    ...(f.description.trim() ? { description: f.description.trim() } : {}),
    ...(f.imageUrl.trim() ? { imageUrl: f.imageUrl.trim() } : {}),
    ...(f.noindex ? { noindex: true } : {}),
  };
  return Object.keys(out).length ? out : null;
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Search-engine fields with a live Google result preview. */
export function SeoPanel({
  value,
  onChange,
  fallbackTitle,
  fallbackDescription,
  url,
  errors,
  disabled,
  idPrefix,
}: {
  value: SeoForm;
  onChange: (v: SeoForm) => void;
  /** What search engines see when the override is empty (the page title, excerpt …). */
  fallbackTitle: string;
  fallbackDescription?: string;
  /** Full storefront URL of the page. */
  url: string;
  errors?: Record<string, string>;
  disabled?: boolean;
  idPrefix: string;
}) {
  const { t } = useI18n();
  const set = <K extends keyof SeoForm>(k: K, v: SeoForm[K]) => onChange({ ...value, [k]: v });
  const title = value.title.trim() || fallbackTitle;
  const description = value.description.trim() || fallbackDescription || "";
  let host = url;
  try {
    const u = new URL(url);
    host = `${u.host}${u.pathname === "/" ? "" : u.pathname.split("/").filter(Boolean).map((p) => ` › ${p}`).join("")}`;
  } catch {
    // keep as is
  }

  return (
    <Section id={`${idPrefix}-seo`} icon={SearchIcon} tone="text-info-ink" title={t("site.seo.title")} description={t("site.seo.subtitle")}>
      <figure className="grid grid-cols-[minmax(0,1fr)] gap-1 rounded-xl border bg-background p-4" aria-label={t("site.seo.previewLabel")}>
        <figcaption className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("site.seo.preview")}</figcaption>
        <p className="truncate text-xs text-[#4d5156] dark:text-[#bdc1c6]">{host}</p>
        <p className="text-lg leading-snug text-[#1a0dab] dark:text-[#8ab4f8]">{cut(title || t("site.seo.untitled"), SNIPPET_TITLE)}</p>
        <p className={cn("text-sm text-[#4d5156] dark:text-[#bdc1c6]", !description && "italic")}>
          {description ? cut(description, SNIPPET_DESCRIPTION) : t("site.seo.noDescription")}
        </p>
        {value.noindex && <p className="mt-1 text-xs font-medium text-warning-ink">{t("site.seo.noindexNote")}</p>}
      </figure>

      <TextField
        id={`${idPrefix}-seo-title`}
        label={t("site.seo.metaTitle")}
        optional
        value={value.title}
        placeholder={fallbackTitle}
        maxLength={SEO_TITLE_MAX}
        disabled={disabled}
        error={errors?.title}
        hint={t("site.seo.count", { n: value.title.length, max: SNIPPET_TITLE })}
        onChange={(v) => set("title", v)}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-2">
        <Label htmlFor={`${idPrefix}-seo-desc`}>
          {t("site.seo.metaDescription")}
          <Optional />
        </Label>
        <Textarea
          id={`${idPrefix}-seo-desc`}
          rows={3}
          value={value.description}
          placeholder={fallbackDescription}
          maxLength={SEO_DESCRIPTION_MAX}
          disabled={disabled}
          aria-invalid={!!errors?.description}
          onChange={(e) => set("description", e.target.value)}
        />
        <p className={cn("text-xs", value.description.length > SNIPPET_DESCRIPTION ? "text-warning-ink" : "text-muted-foreground")}>
          {t("site.seo.count", { n: value.description.length, max: SNIPPET_DESCRIPTION })}
        </p>
        <FieldError code={errors?.description} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-2">
        <Label>
          {t("site.seo.image")}
          <Optional />
        </Label>
        <ImageField value={value.imageUrl} onChange={(v) => set("imageUrl", v)} aspect="aspect-[1200/630]" disabled={disabled} invalid={!!errors?.imageUrl} />
        <p className="text-meta text-muted-foreground">{t("site.seo.imageHint")}</p>
        <FieldError code={errors?.imageUrl} />
      </div>
      <Label htmlFor={`${idPrefix}-noindex`} className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3 font-normal">
        <span className="grid gap-0.5">
          <span className="text-sm font-medium">{t("site.seo.noindex")}</span>
          <span className="text-xs text-muted-foreground">{t("site.seo.noindexHint")}</span>
        </span>
        <Switch id={`${idPrefix}-noindex`} checked={value.noindex} disabled={disabled} onCheckedChange={(v) => set("noindex", v)} />
      </Label>
    </Section>
  );
}
