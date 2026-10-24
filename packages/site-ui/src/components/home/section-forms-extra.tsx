"use client";

import * as React from "react";
import { PlusIcon, RotateCcwIcon, StarIcon } from "lucide-react";
import { Button, ChipGroup, cn, Field as UiField, FieldControl, FieldLabel, Label, Switch, Textarea } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import {
  emptyDish,
  emptyStyle,
  emptyTestimonial,
  isDefaultStyle,
  SECTION_LIST_LIMITS,
  type DishForm,
  type FieldErrors,
  type FormOf,
  type SectionForm,
  type StyleForm,
  type TestimonialForm,
} from "../../lib/sections";
import { FieldError, Optional, TextField } from "../bits";
import { ImageField } from "../image-field";
import { MarkdownField } from "../markdown-field";
import { VideoField } from "../media-video-field";
import { CategoryPicker } from "../pickers";
import { CtaFields, ItemTools, moveIn } from "./form-parts";
import { coordsFromText } from "../../lib/map-link";

/*
 * Forms for the richer home sections (split / video hero, offer, gallery, logos, mosaic, FAQ, location, menu board,
 * appointment, before/after, gold rates, Instagram), the testimonial layouts, and the style panel every section shares.
 */

export interface Props<T extends SectionForm["type"]> {
  form: FormOf<T>;
  onChange: (f: FormOf<T>) => void;
  errors: FieldErrors;
  disabled?: boolean;
  idp: string;
}

/** A repeatable list: one bordered card per item with move / remove tools, and an "Add" button below. */
export function Repeat<T>({
  items,
  onChange,
  make,
  max,
  min = 1,
  title,
  addLabel,
  disabled,
  error,
  children,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  make: () => T;
  max: number;
  min?: number;
  title: (i: number) => string;
  addLabel: string;
  disabled?: boolean;
  error?: string;
  children: (item: T, set: (p: Partial<T>) => void, i: number) => React.ReactNode;
}) {
  return (
    <div className="grid gap-3">
      {items.map((it, i) => (
        <div key={i} className="grid gap-3 rounded-xl border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{title(i)}</span>
            <ItemTools i={i} n={items.length} min={min} disabled={disabled} onMove={(d) => onChange(moveIn(items, i, d))} onRemove={() => onChange(items.filter((_, j) => j !== i))} />
          </div>
          {children(it, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))), i)}
        </div>
      ))}
      <FieldError code={error} />
      <Button type="button" variant="outline" className="justify-self-start" disabled={disabled || items.length >= max} onClick={() => onChange([...items, make()])}>
        <PlusIcon /> {addLabel}
      </Button>
    </div>
  );
}

export function Toggle({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border bg-card px-3 py-2.5">
      <span className="grid gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {hint && <span className="text-meta text-muted-foreground">{hint}</span>}
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

export function Chips<V extends string>({ label, value, onChange, options, disabled }: { label: string; value: V; onChange: (v: V) => void; options: { value: V; label: string }[]; disabled?: boolean }) {
  return (
    <div className="grid content-start gap-2">
      <Label>{label}</Label>
      <ChipGroup<V> value={value} onChange={(v) => !disabled && onChange(v)} aria-label={label} options={options} />
    </div>
  );
}

export function Img({ label, value, onChange, error, optional, aspect, hint, disabled, className }: { label: string; value: string; onChange: (v: string) => void; error?: string; optional?: boolean; aspect: string; hint?: string; disabled?: boolean; className?: string }) {
  return (
    <div className={cn("grid content-start gap-2", className)}>
      <Label>
        {label}
        {optional && <Optional />}
      </Label>
      <ImageField value={value} onChange={onChange} aspect={aspect} disabled={disabled} invalid={!!error} label={label} />
      {hint && <p className="text-meta text-muted-foreground">{hint}</p>}
      <FieldError code={error} />
    </div>
  );
}

export function Area({ id, label, value, onChange, error, optional, rows = 3, maxLength, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; optional?: boolean; rows?: number; maxLength: number; disabled?: boolean }) {
  return (
    <UiField id={id}>
      <FieldLabel>
        {label}
        {optional && <Optional />}
      </FieldLabel>
      <FieldControl>
        <Textarea rows={rows} value={value} maxLength={maxLength} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      </FieldControl>
      <FieldError code={error} />
    </UiField>
  );
}

const sideOptions = (t: (k: string) => string) => [
  { value: "left" as const, label: t("site.home.imageLeft") },
  { value: "right" as const, label: t("site.home.imageRight") },
];

// ---------------------------------------------------------------- testimonials

export function TestimonialsFields({ form, onChange, errors, disabled, idp }: Props<"testimonials">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
      <Chips
        label={t("site.home.layout")}
        value={form.layout}
        onChange={(layout) => onChange({ ...form, layout })}
        disabled={disabled}
        options={[
          { value: "carousel", label: t("site.home.layoutCarousel") },
          { value: "cards", label: t("site.home.layoutCards") },
          { value: "single", label: t("site.home.layoutSingle") },
        ]}
      />
      <Repeat<TestimonialForm>
        items={form.items}
        onChange={(items) => onChange({ ...form, items })}
        make={emptyTestimonial}
        max={SECTION_LIST_LIMITS.testimonials}
        title={(i) => t("site.home.testimonialN", { n: i + 1 })}
        addLabel={t("site.home.addTestimonial")}
        disabled={disabled}
        error={errors.items}
      >
        {(it, set, i) => (
          <>
            <Area id={`${idp}-q${i}`} label={t("site.home.quote")} value={it.quote} maxLength={600} disabled={disabled} error={errors[`items.${i}.quote`]} onChange={(quote) => set({ quote })} />
            <div className="grid items-start gap-3 sm:grid-cols-2">
              <TextField id={`${idp}-n${i}`} label={t("site.home.customerName")} placeholder={t("site.home.customerNamePlaceholder")} value={it.name} maxLength={80} disabled={disabled} error={errors[`items.${i}.name`]} onChange={(name) => set({ name })} />
              <TextField id={`${idp}-r${i}`} label={t("site.home.role")} optional placeholder={t("site.home.rolePlaceholder")} value={it.role} maxLength={80} disabled={disabled} error={errors[`items.${i}.role`]} onChange={(role) => set({ role })} />
            </div>
            <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="grid content-start gap-2">
                <Label id={`${idp}-rt${i}`}>
                  {t("site.home.rating")}
                  <Optional />
                </Label>
                <div role="radiogroup" aria-labelledby={`${idp}-rt${i}`} className="flex flex-wrap gap-1">
                  {["", "1", "2", "3", "4", "5"].map((v) => (
                    <button
                      key={v || "none"}
                      type="button"
                      role="radio"
                      aria-checked={it.rating === v}
                      disabled={disabled}
                      onClick={() => set({ rating: v })}
                      className={cn(
                        "inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-lg border px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        it.rating === v ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {v ? (
                        <>
                          {v} <StarIcon className="size-3.5" aria-hidden />
                        </>
                      ) : (
                        t("site.home.ratingNone")
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <Img label={t("site.home.photo")} optional value={it.photoUrl} onChange={(photoUrl) => set({ photoUrl })} aspect="aspect-square" className="w-28" disabled={disabled} error={errors[`items.${i}.photoUrl`]} />
            </div>
          </>
        )}
      </Repeat>
    </div>
  );
}

// ---------------------------------------------------------------- heroes and offer

export function HeroSplitFields({ form, onChange, errors, disabled, idp }: Props<"hero-split">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Img label={t("site.home.image")} optional value={form.imageUrl} onChange={(imageUrl) => onChange({ ...form, imageUrl })} aspect="aspect-[4/5]" hint={t("site.home.splitImageHint")} disabled={disabled} error={errors.imageUrl} />
        <Chips label={t("site.home.imageSide")} value={form.imageSide} onChange={(imageSide) => onChange({ ...form, imageSide })} options={sideOptions(t)} disabled={disabled} />
      </div>
      <TextField id={`${idp}-eb`} label={t("site.home.eyebrow")} optional hint={t("site.home.eyebrowHint")} value={form.eyebrow} maxLength={60} disabled={disabled} error={errors.eyebrow} onChange={(eyebrow) => onChange({ ...form, eyebrow })} />
      <TextField id={`${idp}-h`} label={t("site.home.heading")} value={form.heading} maxLength={120} disabled={disabled} error={errors.heading} onChange={(heading) => onChange({ ...form, heading })} />
      <Area id={`${idp}-x`} label={t("site.home.text")} optional value={form.text} maxLength={400} disabled={disabled} error={errors.text} onChange={(text) => onChange({ ...form, text })} />
      <CtaFields idp={idp} label={form.ctaLabel} href={form.ctaHref} onLabel={(ctaLabel) => onChange({ ...form, ctaLabel })} onHref={(ctaHref) => onChange({ ...form, ctaHref })} errors={errors} disabled={disabled} />
      <CtaFields
        idp={idp}
        field="cta2"
        labelText={t("site.home.cta2Label")}
        placeholder="/search"
        label={form.cta2Label}
        href={form.cta2Href}
        onLabel={(cta2Label) => onChange({ ...form, cta2Label })}
        onHref={(cta2Href) => onChange({ ...form, cta2Href })}
        errors={errors}
        disabled={disabled}
      />
    </div>
  );
}

export function HeroVideoFields({ form, onChange, errors, disabled, idp }: Props<"hero-video">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <VideoField id={`${idp}-v`} label={t("site.media.videoSelected")} hint={t("site.home.videoHint")} value={form.videoUrl} disabled={disabled} error={errors.videoUrl} onChange={(videoUrl) => onChange({ ...form, videoUrl })} />
      <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Img label={t("site.home.poster")} optional value={form.posterUrl} onChange={(posterUrl) => onChange({ ...form, posterUrl })} aspect="aspect-[16/9]" hint={t("site.home.posterHint")} disabled={disabled} error={errors.posterUrl} />
        <TextField
          id={`${idp}-ov`}
          label={t("site.home.overlay")}
          inputMode="numeric"
          hint={t("site.home.overlayHint")}
          value={form.overlay}
          inputClassName="w-24"
          disabled={disabled}
          error={errors.overlay}
          onChange={(v) => onChange({ ...form, overlay: v.replace(/\D/g, "").slice(0, 2) })}
        />
      </div>
      <TextField id={`${idp}-h`} label={t("site.home.heading")} value={form.heading} maxLength={120} disabled={disabled} error={errors.heading} onChange={(heading) => onChange({ ...form, heading })} />
      <Area id={`${idp}-x`} label={t("site.home.text")} optional value={form.text} maxLength={400} disabled={disabled} error={errors.text} onChange={(text) => onChange({ ...form, text })} />
      <CtaFields idp={idp} label={form.ctaLabel} href={form.ctaHref} onLabel={(ctaLabel) => onChange({ ...form, ctaLabel })} onHref={(ctaHref) => onChange({ ...form, ctaHref })} errors={errors} disabled={disabled} />
    </div>
  );
}

export function OfferFields({ form, onChange, errors, disabled, idp }: Props<"offer">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-eb`} label={t("site.home.eyebrow")} optional placeholder={t("site.samples.offerEyebrow")} value={form.eyebrow} maxLength={60} disabled={disabled} error={errors.eyebrow} onChange={(eyebrow) => onChange({ ...form, eyebrow })} />
      <TextField id={`${idp}-h`} label={t("site.home.heading")} value={form.heading} maxLength={120} disabled={disabled} error={errors.heading} onChange={(heading) => onChange({ ...form, heading })} />
      <Area id={`${idp}-x`} label={t("site.home.text")} optional value={form.text} maxLength={400} rows={2} disabled={disabled} error={errors.text} onChange={(text) => onChange({ ...form, text })} />
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextField
          id={`${idp}-code`}
          label={t("site.home.offerCode")}
          optional
          hint={t("site.home.offerCodeHint")}
          placeholder="DIWALI20"
          value={form.code}
          maxLength={40}
          disabled={disabled}
          error={errors.code}
          inputClassName="font-mono uppercase"
          onChange={(code) => onChange({ ...form, code: code.toUpperCase().replace(/\s/g, "") })}
        />
        <TextField id={`${idp}-end`} type="datetime-local" label={t("site.home.endsAt")} optional hint={t("site.home.endsAtHint")} value={form.endsAt} disabled={disabled} error={errors.endsAt} onChange={(endsAt) => onChange({ ...form, endsAt })} />
      </div>
      <CtaFields idp={idp} label={form.ctaLabel} href={form.ctaHref} onLabel={(ctaLabel) => onChange({ ...form, ctaLabel })} onHref={(ctaHref) => onChange({ ...form, ctaHref })} errors={errors} disabled={disabled} />
    </div>
  );
}

// ---------------------------------------------------------------- pictures

export function GalleryFields({ form, onChange, errors, disabled, idp }: Props<"gallery">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
      <Chips
        label={t("site.home.layout")}
        value={form.layout}
        onChange={(layout) => onChange({ ...form, layout })}
        disabled={disabled}
        options={[
          { value: "grid", label: t("site.home.layoutGrid") },
          { value: "masonry", label: t("site.home.layoutMasonry") },
          { value: "carousel", label: t("site.home.layoutCarousel") },
        ]}
      />
      <Repeat
        items={form.images}
        onChange={(images) => onChange({ ...form, images })}
        make={() => ({ url: "", alt: "", caption: "", href: "" })}
        max={SECTION_LIST_LIMITS.gallery}
        title={(i) => t("site.home.imageN", { n: i + 1 })}
        addLabel={t("site.home.addImage")}
        disabled={disabled}
        error={errors.images}
      >
        {(it, set, i) => (
          <div className="grid items-start gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Img label={t("site.home.image")} value={it.url} onChange={(url) => set({ url })} aspect="aspect-square" disabled={disabled} error={errors[`images.${i}.url`]} />
            <div className="grid gap-3">
              <TextField id={`${idp}-alt${i}`} label={t("site.media.alt")} hint={t("site.media.altHint")} value={it.alt} maxLength={200} disabled={disabled} error={errors[`images.${i}.alt`]} onChange={(alt) => set({ alt })} />
              <TextField id={`${idp}-cap${i}`} label={t("site.home.caption")} optional value={it.caption} maxLength={200} disabled={disabled} error={errors[`images.${i}.caption`]} onChange={(caption) => set({ caption })} />
              <TextField id={`${idp}-href${i}`} label={t("site.home.imageLink")} optional placeholder="/collections/new" value={it.href} disabled={disabled} error={errors[`images.${i}.href`]} onChange={(href) => set({ href })} />
            </div>
          </div>
        )}
      </Repeat>
    </div>
  );
}

export function LogosFields({ form, onChange, errors, disabled, idp }: Props<"logos">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
      <Toggle id={`${idp}-gray`} label={t("site.home.grayscale")} hint={t("site.home.grayscaleHint")} checked={form.grayscale} onChange={(grayscale) => onChange({ ...form, grayscale })} disabled={disabled} />
      <Repeat
        items={form.items}
        onChange={(items) => onChange({ ...form, items })}
        make={() => ({ imageUrl: "", name: "", href: "" })}
        max={SECTION_LIST_LIMITS.logos}
        title={(i) => t("site.home.logoN", { n: i + 1 })}
        addLabel={t("site.home.addLogo")}
        disabled={disabled}
        error={errors.items}
      >
        {(it, set, i) => (
          <div className="grid items-start gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <Img
              label={t("site.home.logo")}
              optional
              value={it.imageUrl}
              onChange={(imageUrl) => set({ imageUrl })}
              aspect="aspect-[3/2]"
              disabled={disabled}
              error={errors[`items.${i}.imageUrl`]}
            />
            <div className="grid gap-3">
              <TextField id={`${idp}-ln${i}`} label={t("site.home.brandName")} hint={it.imageUrl ? undefined : t("site.home.logoTextHint")} value={it.name} maxLength={80} disabled={disabled} error={errors[`items.${i}.name`]} onChange={(name) => set({ name })} />
              <TextField id={`${idp}-lh${i}`} label={t("site.home.logoLink")} optional placeholder="/search?q=brand" value={it.href} disabled={disabled} error={errors[`items.${i}.href`]} onChange={(href) => set({ href })} />
            </div>
          </div>
        )}
      </Repeat>
    </div>
  );
}

export function InstagramFields({ form, onChange, errors, disabled, idp }: Props<"instagram">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
        <TextField id={`${idp}-ig`} label={t("site.home.handle")} hint={t("site.home.handleHint")} placeholder="@yourshop" value={form.handle} maxLength={31} disabled={disabled} error={errors.handle} onChange={(handle) => onChange({ ...form, handle: handle.trim() })} />
      </div>
      <p className="text-meta text-muted-foreground">{t("site.home.instagramHint")}</p>
      <Repeat
        items={form.images}
        onChange={(images) => onChange({ ...form, images })}
        make={() => ({ url: "", alt: "", href: "" })}
        max={SECTION_LIST_LIMITS.instagram}
        title={(i) => t("site.home.imageN", { n: i + 1 })}
        addLabel={t("site.home.addImage")}
        disabled={disabled}
        error={errors.images}
      >
        {(it, set, i) => (
          <div className="grid items-start gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <Img label={t("site.home.image")} value={it.url} onChange={(url) => set({ url })} aspect="aspect-square" disabled={disabled} error={errors[`images.${i}.url`]} />
            <div className="grid gap-3">
              <TextField id={`${idp}-ia${i}`} label={t("site.media.alt")} value={it.alt} maxLength={200} disabled={disabled} error={errors[`images.${i}.alt`]} onChange={(alt) => set({ alt })} />
              <TextField id={`${idp}-ih${i}`} label={t("site.home.postLink")} optional placeholder="https://www.instagram.com/p/…" value={it.href} disabled={disabled} error={errors[`images.${i}.href`]} onChange={(href) => set({ href })} />
            </div>
          </div>
        )}
      </Repeat>
    </div>
  );
}

export function BeforeAfterFields({ form, onChange, errors, disabled, idp }: Props<"before-after">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
      <Area id={`${idp}-x`} label={t("site.home.text")} optional value={form.text} rows={2} maxLength={400} disabled={disabled} error={errors.text} onChange={(text) => onChange({ ...form, text })} />
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <div className="grid gap-3">
          <Img label={t("site.home.before")} value={form.beforeUrl} onChange={(beforeUrl) => onChange({ ...form, beforeUrl })} aspect="aspect-[4/3]" disabled={disabled} error={errors.beforeUrl} />
          <TextField id={`${idp}-bl`} label={t("site.home.beforeLabel")} optional placeholder={t("site.home.before")} value={form.beforeLabel} maxLength={40} disabled={disabled} error={errors.beforeLabel} onChange={(beforeLabel) => onChange({ ...form, beforeLabel })} />
        </div>
        <div className="grid gap-3">
          <Img label={t("site.home.after")} value={form.afterUrl} onChange={(afterUrl) => onChange({ ...form, afterUrl })} aspect="aspect-[4/3]" disabled={disabled} error={errors.afterUrl} />
          <TextField id={`${idp}-al`} label={t("site.home.afterLabel")} optional placeholder={t("site.home.after")} value={form.afterLabel} maxLength={40} disabled={disabled} error={errors.afterLabel} onChange={(afterLabel) => onChange({ ...form, afterLabel })} />
        </div>
      </div>
      <p className="text-meta text-muted-foreground">{t("site.home.beforeAfterHint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------- catalogue, info

export function MosaicFields({ form, onChange, errors, disabled, idp }: Props<"category-mosaic">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
      <p className="text-sm text-muted-foreground">{t("site.home.mosaicHint", { max: SECTION_LIST_LIMITS.mosaic })}</p>
      <CategoryPicker ids={form.categoryIds} onChange={(categoryIds) => onChange({ ...form, categoryIds })} max={SECTION_LIST_LIMITS.mosaic} disabled={disabled} idPrefix={idp} />
      <FieldError code={errors.categoryIds} />
    </div>
  );
}

export function FaqFields({ form, onChange, errors, disabled, idp }: Props<"faq">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
      <Repeat
        items={form.items}
        onChange={(items) => onChange({ ...form, items })}
        make={() => ({ q: "", a: "" })}
        max={SECTION_LIST_LIMITS.faq}
        title={(i) => t("site.home.questionN", { n: i + 1 })}
        addLabel={t("site.home.addQuestion")}
        disabled={disabled}
        error={errors.items}
      >
        {(it, set, i) => (
          <>
            <TextField id={`${idp}-q${i}`} label={t("site.home.question")} value={it.q} maxLength={300} disabled={disabled} error={errors[`items.${i}.q`]} onChange={(q) => set({ q })} />
            <MarkdownField id={`${idp}-a${i}`} label={t("site.home.answer")} value={it.a} rows={3} maxLength={3000} disabled={disabled} error={errors[`items.${i}.a`]} onChange={(a) => set({ a })} />
          </>
        )}
      </Repeat>
    </div>
  );
}

export function LocationFields({ form, onChange, errors, disabled, idp }: Props<"location">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
      <Area id={`${idp}-addr`} label={t("site.home.address")} optional value={form.address} maxLength={500} disabled={disabled} error={errors.address} onChange={(address) => onChange({ ...form, address })} />
      <p className="-mt-2 text-meta text-muted-foreground">{t("site.home.locationHint")}</p>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextField id={`${idp}-ph`} type="tel" label={t("site.home.phone")} optional placeholder="+91 98765 43210" value={form.phone} maxLength={20} disabled={disabled} error={errors.phone} onChange={(phone) => onChange({ ...form, phone })} />
        <TextField id={`${idp}-wa`} type="tel" label={t("site.home.whatsapp")} optional placeholder="+91 98765 43210" value={form.whatsapp} maxLength={20} disabled={disabled} error={errors.whatsapp} onChange={(whatsapp) => onChange({ ...form, whatsapp })} />
        <TextField id={`${idp}-geo`} label={t("site.home.coords")} optional hint={t("site.home.coordsHint")} placeholder="9.9252, 78.1198" value={form.coords} maxLength={400} disabled={disabled} error={errors.coords} onChange={(raw) => onChange({ ...form, coords: coordsFromText(raw) ?? raw })} />
        <TextField id={`${idp}-map`} label={t("site.home.mapLink")} optional hint={t("site.home.mapLinkHint")} placeholder="https://maps.app.goo.gl/…" value={form.mapLink} disabled={disabled} error={errors.mapLink} onChange={(mapLink) => onChange({ ...form, mapLink })} />
      </div>
      <Repeat
        items={form.hours}
        onChange={(hours) => onChange({ ...form, hours })}
        make={() => ({ label: "", value: "" })}
        max={SECTION_LIST_LIMITS.hours}
        min={0}
        title={(i) => t("site.home.hoursN", { n: i + 1 })}
        addLabel={t("site.home.addHours")}
        disabled={disabled}
        error={errors.hours}
      >
        {(it, set, i) => (
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <TextField id={`${idp}-hl${i}`} label={t("site.home.hoursLabel")} placeholder={t("site.samples.hoursWeek")} value={it.label} maxLength={40} disabled={disabled} error={errors[`hours.${i}.label`]} onChange={(label) => set({ label })} />
            <TextField id={`${idp}-hv${i}`} label={t("site.home.hoursValue")} placeholder={t("site.samples.hoursWeekValue")} value={it.value} maxLength={60} disabled={disabled} error={errors[`hours.${i}.value`]} onChange={(value) => set({ value })} />
          </div>
        )}
      </Repeat>
    </div>
  );
}

// ---------------------------------------------------------------- trades

const priceInput = (v: string) => v.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 10);

export function MenuBoardFields({ form, onChange, errors, disabled, idp }: Props<"menu-board">) {
  const { t } = useI18n();
  const diets = [
    { value: "" as const, label: t("site.home.dietNone") },
    { value: "veg" as const, label: t("site.home.dietVeg") },
    { value: "nonveg" as const, label: t("site.home.dietNonveg") },
    { value: "egg" as const, label: t("site.home.dietEgg") },
  ];
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
      <Repeat
        items={form.groups}
        onChange={(groups) => onChange({ ...form, groups })}
        make={() => ({ name: "", items: [emptyDish()] })}
        max={SECTION_LIST_LIMITS.menuGroups}
        title={(i) => t("site.home.groupN", { n: i + 1 })}
        addLabel={t("site.home.addGroup")}
        disabled={disabled}
        error={errors.groups}
      >
        {(g, setG, gi) => (
          <>
            <TextField id={`${idp}-g${gi}`} label={t("site.home.groupName")} placeholder={t("site.samples.menuGroup")} value={g.name} maxLength={60} disabled={disabled} error={errors[`groups.${gi}.name`]} onChange={(name) => setG({ name })} />
            <Repeat<DishForm>
              items={g.items}
              onChange={(items) => setG({ items })}
              make={emptyDish}
              max={SECTION_LIST_LIMITS.dishes}
              title={(i) => t("site.home.dishN", { n: i + 1 })}
              addLabel={t("site.home.addDish")}
              disabled={disabled}
              error={errors[`groups.${gi}.items`]}
            >
              {(d, set, di) => {
                const p = `groups.${gi}.items.${di}`;
                return (
                  <>
                    <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                      <TextField id={`${idp}-d${gi}-${di}`} label={t("site.home.dishName")} value={d.name} maxLength={80} disabled={disabled} error={errors[`${p}.name`]} onChange={(name) => set({ name })} />
                      <TextField id={`${idp}-dp${gi}-${di}`} label={t("site.home.price")} optional inputMode="decimal" placeholder="120" value={d.price} disabled={disabled} error={errors[`${p}.price`]} onChange={(v) => set({ price: priceInput(v) })} />
                    </div>
                    <TextField id={`${idp}-dd${gi}-${di}`} label={t("site.home.dishDescription")} optional value={d.description} maxLength={200} disabled={disabled} error={errors[`${p}.description`]} onChange={(description) => set({ description })} />
                    <Chips label={t("site.home.diet")} value={d.diet} onChange={(diet) => set({ diet })} options={diets} disabled={disabled} />
                  </>
                );
              }}
            </Repeat>
          </>
        )}
      </Repeat>
      <CtaFields idp={idp} label={form.ctaLabel} href={form.ctaHref} onLabel={(ctaLabel) => onChange({ ...form, ctaLabel })} onHref={(ctaHref) => onChange({ ...form, ctaHref })} errors={errors} disabled={disabled} />
    </div>
  );
}

export function AppointmentFields({ form, onChange, errors, disabled, idp }: Props<"appointment">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-h`} label={t("site.home.heading")} value={form.heading} maxLength={120} disabled={disabled} error={errors.heading} onChange={(heading) => onChange({ ...form, heading })} />
      <Area id={`${idp}-x`} label={t("site.home.text")} optional value={form.text} rows={2} maxLength={400} disabled={disabled} error={errors.text} onChange={(text) => onChange({ ...form, text })} />
      <Repeat
        items={form.services}
        onChange={(services) => onChange({ ...form, services })}
        make={() => ({ name: "", duration: "", price: "" })}
        max={SECTION_LIST_LIMITS.services}
        min={0}
        title={(i) => t("site.home.serviceN", { n: i + 1 })}
        addLabel={t("site.home.addService")}
        disabled={disabled}
        error={errors.services}
      >
        {(v, set, i) => (
          <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
            <TextField id={`${idp}-sn${i}`} label={t("site.home.serviceName")} value={v.name} maxLength={80} disabled={disabled} error={errors[`services.${i}.name`]} onChange={(name) => set({ name })} />
            <TextField id={`${idp}-sd${i}`} label={t("site.home.duration")} optional placeholder={t("site.home.durationPlaceholder")} value={v.duration} maxLength={40} disabled={disabled} error={errors[`services.${i}.duration`]} onChange={(duration) => set({ duration })} />
            <TextField id={`${idp}-sp${i}`} label={t("site.home.price")} optional inputMode="decimal" value={v.price} disabled={disabled} error={errors[`services.${i}.price`]} onChange={(p) => set({ price: priceInput(p) })} />
          </div>
        )}
      </Repeat>
      <CtaFields idp={idp} label={form.ctaLabel} href={form.ctaHref} placeholder="/book" onLabel={(ctaLabel) => onChange({ ...form, ctaLabel })} onHref={(ctaHref) => onChange({ ...form, ctaHref })} errors={errors} disabled={disabled} />
      <p className="text-meta text-muted-foreground">{t("site.home.appointmentHint")}</p>
    </div>
  );
}

export function GoldRatesFields({ form, onChange, errors, disabled, idp }: Props<"gold-rates">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
      <Area id={`${idp}-x`} label={t("site.home.text")} optional value={form.text} rows={2} maxLength={400} disabled={disabled} error={errors.text} onChange={(text) => onChange({ ...form, text })} />
      <Toggle id={`${idp}-silver`} label={t("site.home.showSilver")} checked={form.showSilver} onChange={(showSilver) => onChange({ ...form, showSilver })} disabled={disabled} />
      <p className="text-meta text-muted-foreground">{t("site.home.goldHint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------- style panel (every section)

/**
 * The look of one section: background, spacing, width, alignment, entrance animation, and hiding on phones or larger
 * screens. Everything left at "Theme" keeps the store theme's default.
 */
export function StyleFields({ value, onChange, errors, disabled, idp }: { value: StyleForm | undefined; onChange: (v: StyleForm) => void; errors: FieldErrors; disabled?: boolean; idp: string }) {
  const { t } = useI18n();
  const v = value ?? emptyStyle();
  const set = (p: Partial<StyleForm>) => onChange({ ...v, ...p });
  const theme = t("site.style.default");
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-meta text-muted-foreground">{t("site.style.hint")}</p>
        <Button type="button" variant="ghost" size="sm" disabled={disabled || isDefaultStyle(v)} onClick={() => onChange(emptyStyle())}>
          <RotateCcwIcon /> {t("site.style.reset")}
        </Button>
      </div>
      <div className="grid content-start gap-2">
        <Label id={`${idp}-bg`}>{t("site.style.background")}</Label>
        <div role="radiogroup" aria-labelledby={`${idp}-bg`} className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {(["", "brand", "muted", "dark", "gradient", "image"] as const).map((bg) => (
            <button
              key={bg || "none"}
              type="button"
              role="radio"
              aria-checked={v.background === bg || (bg === "" && v.background === "none")}
              disabled={disabled}
              onClick={() => set({ background: bg })}
              className={cn(
                "grid gap-1.5 rounded-xl border bg-card p-1.5 text-center text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                v.background === bg ? "border-primary ring-1 ring-primary" : "hover:border-primary/40",
              )}
            >
              <span aria-hidden className={cn("block h-8 rounded-lg ring-1 ring-border/60", SWATCH[bg || "none"])} />
              {bg ? t(`site.style.bg.${bg}`) : theme}
            </button>
          ))}
        </div>
      </div>
      {v.background === "image" && (
        <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Img label={t("site.style.bgImage")} value={v.imageUrl} onChange={(imageUrl) => set({ imageUrl })} aspect="aspect-[16/7]" disabled={disabled} error={errors["style.imageUrl"]} />
          <TextField
            id={`${idp}-ov`}
            label={t("site.home.overlay")}
            optional
            inputMode="numeric"
            hint={t("site.home.overlayHint")}
            placeholder="45"
            value={v.overlay}
            inputClassName="w-24"
            disabled={disabled}
            error={errors["style.overlay"]}
            onChange={(o) => set({ overlay: o.replace(/\D/g, "").slice(0, 2) })}
          />
        </div>
      )}
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Chips
          label={t("site.style.padding")}
          value={v.padding}
          onChange={(padding) => set({ padding })}
          disabled={disabled}
          options={[
            { value: "", label: theme },
            { value: "compact", label: t("site.style.pad.compact") },
            { value: "spacious", label: t("site.style.pad.spacious") },
          ]}
        />
        <Chips
          label={t("site.style.width")}
          value={v.width}
          onChange={(width) => set({ width })}
          disabled={disabled}
          options={[
            { value: "", label: theme },
            { value: "contained", label: t("site.style.width.contained") },
            { value: "full", label: t("site.style.width.full") },
          ]}
        />
        <Chips
          label={t("site.style.align")}
          value={v.align}
          onChange={(align) => set({ align })}
          disabled={disabled}
          options={[
            { value: "", label: theme },
            { value: "start", label: t("site.style.align.start") },
            { value: "center", label: t("site.style.align.center") },
          ]}
        />
        <Chips
          label={t("site.style.animation")}
          value={v.animation}
          onChange={(animation) => set({ animation })}
          disabled={disabled}
          options={[
            { value: "", label: theme },
            { value: "fade", label: t("site.style.anim.fade") },
            { value: "rise", label: t("site.style.anim.rise") },
            { value: "none", label: t("site.style.anim.none") },
          ]}
        />
      </div>
      {v.animation && v.animation !== "none" && <p className="-mt-2 text-meta text-muted-foreground">{t("site.style.motionHint")}</p>}
      <Chips
        label={t("site.style.span")}
        value={v.span}
        onChange={(span) => set({ span })}
        disabled={disabled}
        options={[
          { value: "", label: t("site.style.span.full") },
          { value: "half", label: t("site.style.span.half") },
        ]}
      />
      {v.span === "half" && <p className="-mt-2 text-meta text-muted-foreground">{t("site.style.spanHint")}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <Toggle id={`${idp}-hm`} label={t("site.style.hideOnMobile")} checked={v.hideOnMobile} onChange={(hideOnMobile) => set({ hideOnMobile, ...(hideOnMobile ? { hideOnDesktop: false } : {}) })} disabled={disabled} />
        <Toggle id={`${idp}-hd`} label={t("site.style.hideOnDesktop")} checked={v.hideOnDesktop} onChange={(hideOnDesktop) => set({ hideOnDesktop, ...(hideOnDesktop ? { hideOnMobile: false } : {}) })} disabled={disabled} />
      </div>
    </div>
  );
}

/** Little previews of each background (the admin's own brand colour stands in for the shop's). */
const SWATCH: Record<string, string> = {
  none: "bg-background",
  brand: "bg-primary",
  muted: "bg-primary/10",
  dark: "bg-neutral-900",
  gradient: "bg-gradient-to-r from-primary to-primary/50",
  image: "bg-[linear-gradient(135deg,var(--muted)_25%,transparent_25%,transparent_50%,var(--muted)_50%,var(--muted)_75%,transparent_75%)] bg-[length:10px_10px]",
};
