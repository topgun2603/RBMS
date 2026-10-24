"use client";

import * as React from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { Button, ChipGroup, cn, Field as UiField, FieldControl, FieldLabel, Input, Label, Switch, Textarea } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { emptySlide, SECTION_LIST_LIMITS, USP_ICON_KEYS, uspIconKey, type FieldErrors, type FormOf, type SectionForm, type SlideForm } from "../../lib/sections";
import { FieldError, Optional, TextField } from "../bits";
import { ImageField } from "../image-field";
import { MarkdownField } from "../markdown-field";
import { CategoryPicker, ProductPicker, SlugSelect } from "../pickers";
import { CtaFields, ItemTools, moveIn } from "./form-parts";
import {
  AppointmentFields,
  BeforeAfterFields,
  FaqFields,
  GalleryFields,
  GoldRatesFields,
  HeroSplitFields,
  HeroVideoFields,
  InstagramFields,
  LocationFields,
  LogosFields,
  MenuBoardFields,
  MosaicFields,
  OfferFields,
  TestimonialsFields,
} from "./section-forms-extra";
import { USP_ICON_MAP } from "./section-meta";
import {
  BestsellersFields,
  BlogPostsFields,
  CategoryLayoutFields,
  DealFields,
  NewsletterLayoutFields,
  PricingFields,
  ProductTabsFields,
  RecentlyViewedFields,
  RecommendedFields,
  ReviewsSummaryFields,
  ShopTheLookFields,
  StatsFields,
  TeamFields,
  TimelineFields,
  UspLayoutFields,
} from "./section-forms-shelves";
import { CategoryShelfFields, ComparisonFields, FinderFields, FlashSaleFields, SizeFinderFields, StickyStoryFields, StoriesFields, SwatchesFields, TilesFields } from "./section-forms-layouts";

interface Props<T extends SectionForm["type"]> {
  form: FormOf<T>;
  onChange: (f: FormOf<T>) => void;
  errors: FieldErrors;
  disabled?: boolean;
  idp: string;
}

/** The form for one home section, matching its cms schema field for field. */
export function SectionFields(props: { form: SectionForm; onChange: (f: SectionForm) => void; errors: FieldErrors; disabled?: boolean; idp: string }) {
  const p = props as never;
  switch (props.form.type) {
    case "hero":
      return <HeroFields {...(p as Props<"hero">)} />;
    case "categories":
      return <CategoriesFields {...(p as Props<"categories">)} />;
    case "collection":
      return <CollectionFields {...(p as Props<"collection">)} />;
    case "products":
      return <ProductsFields {...(p as Props<"products">)} />;
    case "banner":
      return <BannerFields {...(p as Props<"banner">)} />;
    case "text":
      return <TextFields {...(p as Props<"text">)} />;
    case "image-text":
      return <ImageTextFields {...(p as Props<"image-text">)} />;
    case "testimonials":
      return <TestimonialsFields {...(p as Props<"testimonials">)} />;
    case "usp":
      return <UspFields {...(p as Props<"usp">)} />;
    case "newsletter":
      return <NewsletterFields {...(p as Props<"newsletter">)} />;
    case "hero-split":
      return <HeroSplitFields {...(p as Props<"hero-split">)} />;
    case "hero-video":
      return <HeroVideoFields {...(p as Props<"hero-video">)} />;
    case "offer":
      return <OfferFields {...(p as Props<"offer">)} />;
    case "gallery":
      return <GalleryFields {...(p as Props<"gallery">)} />;
    case "logos":
      return <LogosFields {...(p as Props<"logos">)} />;
    case "category-mosaic":
      return <MosaicFields {...(p as Props<"category-mosaic">)} />;
    case "faq":
      return <FaqFields {...(p as Props<"faq">)} />;
    case "location":
      return <LocationFields {...(p as Props<"location">)} />;
    case "menu-board":
      return <MenuBoardFields {...(p as Props<"menu-board">)} />;
    case "appointment":
      return <AppointmentFields {...(p as Props<"appointment">)} />;
    case "before-after":
      return <BeforeAfterFields {...(p as Props<"before-after">)} />;
    case "gold-rates":
      return <GoldRatesFields {...(p as Props<"gold-rates">)} />;
    case "instagram":
      return <InstagramFields {...(p as Props<"instagram">)} />;
    case "product-tabs":
      return <ProductTabsFields {...(p as Props<"product-tabs">)} />;
    case "deal":
      return <DealFields {...(p as Props<"deal">)} />;
    case "shop-the-look":
      return <ShopTheLookFields {...(p as Props<"shop-the-look">)} />;
    case "bestsellers":
      return <BestsellersFields {...(p as Props<"bestsellers">)} />;
    case "recently-viewed":
      return <RecentlyViewedFields {...(p as Props<"recently-viewed">)} />;
    case "recommended":
      return <RecommendedFields {...(p as Props<"recommended">)} />;
    case "stats":
      return <StatsFields {...(p as Props<"stats">)} />;
    case "timeline":
      return <TimelineFields {...(p as Props<"timeline">)} />;
    case "team":
      return <TeamFields {...(p as Props<"team">)} />;
    case "pricing-table":
      return <PricingFields {...(p as Props<"pricing-table">)} />;
    case "blog-posts":
      return <BlogPostsFields {...(p as Props<"blog-posts">)} />;
    case "reviews-summary":
      return <ReviewsSummaryFields {...(p as Props<"reviews-summary">)} />;
    case "flash-sale":
      return <FlashSaleFields {...(p as Props<"flash-sale">)} />;
    case "finder":
      return <FinderFields {...(p as Props<"finder">)} />;
    case "stories":
      return <StoriesFields {...(p as Props<"stories">)} />;
    case "category-shelf":
      return <CategoryShelfFields {...(p as Props<"category-shelf">)} />;
    case "sticky-story":
      return <StickyStoryFields {...(p as Props<"sticky-story">)} />;
    case "comparison":
      return <ComparisonFields {...(p as Props<"comparison">)} />;
    case "tiles":
      return <TilesFields {...(p as Props<"tiles">)} />;
    case "size-finder":
      return <SizeFinderFields {...(p as Props<"size-finder">)} />;
    case "swatches":
      return <SwatchesFields {...(p as Props<"swatches">)} />;
  }
}

// ---------------------------------------------------------------- hero

function HeroFields({ form, onChange, errors, disabled, idp }: Props<"hero">) {
  const { t } = useI18n();
  const setSlide = (i: number, p: Partial<SlideForm>) => onChange({ ...form, slides: form.slides.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  return (
    <div className="grid gap-4">
      {form.slides.map((s, i) => (
        <fieldset key={i} className="grid gap-3 rounded-xl border bg-muted/20 p-3">
          <legend className="sr-only">{t("site.home.slideN", { n: i + 1 })}</legend>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{t("site.home.slideN", { n: i + 1 })}</span>
            <ItemTools i={i} n={form.slides.length} disabled={disabled} onMove={(d) => onChange({ ...form, slides: moveIn(form.slides, i, d) })} onRemove={() => onChange({ ...form, slides: form.slides.filter((_, j) => j !== i) })} />
          </div>
          <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="grid content-start gap-2">
              <Label>
                {t("site.home.image")}
                <Optional />
              </Label>
              <ImageField value={s.imageUrl} onChange={(imageUrl) => setSlide(i, { imageUrl })} aspect="aspect-[16/7]" disabled={disabled} invalid={!!errors[`slides.${i}.imageUrl`]} />
              <p className="text-meta text-muted-foreground">{t("site.home.heroImageHint")}</p>
              <FieldError code={errors[`slides.${i}.imageUrl`]} />
            </div>
            <div className="grid content-start gap-2">
              <Label>
                {t("site.home.mobileImage")}
                <Optional />
              </Label>
              <ImageField value={s.mobileImageUrl} onChange={(mobileImageUrl) => setSlide(i, { mobileImageUrl })} aspect="aspect-[4/5]" className="max-w-40" disabled={disabled} />
              <p className="text-meta text-muted-foreground">{t("site.home.mobileImageHint")}</p>
              <FieldError code={errors[`slides.${i}.mobileImageUrl`]} />
            </div>
          </div>
          <TextField id={`${idp}-s${i}-h`} label={t("site.home.heading")} optional value={s.heading} maxLength={120} disabled={disabled} error={errors[`slides.${i}.heading`]} onChange={(heading) => setSlide(i, { heading })} />
          <TextField id={`${idp}-s${i}-sub`} label={t("site.home.subheading")} optional value={s.subheading} maxLength={240} disabled={disabled} error={errors[`slides.${i}.subheading`]} onChange={(subheading) => setSlide(i, { subheading })} />
          <CtaFields idp={`${idp}-s${i}`} label={s.ctaLabel} href={s.ctaHref} onLabel={(ctaLabel) => setSlide(i, { ctaLabel })} onHref={(ctaHref) => setSlide(i, { ctaHref })} errors={errors} prefix={`slides.${i}.`} disabled={disabled} />
        </fieldset>
      ))}
      <FieldError code={errors.slides} />
      <Button type="button" variant="outline" className="justify-self-start" disabled={disabled || form.slides.length >= SECTION_LIST_LIMITS.slides} onClick={() => onChange({ ...form, slides: [...form.slides, emptySlide()] })}>
        <PlusIcon /> {t("site.home.addSlide")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- catalogue sections

function CategoriesFields({ form, onChange, errors, disabled, idp }: Props<"categories">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
      <ChipGroup<"all" | "pick">
        value={form.mode}
        onChange={(mode) => onChange({ ...form, mode })}
        aria-label={t("site.home.categoriesMode")}
        options={[
          { value: "all", label: t("site.home.categoriesAll") },
          { value: "pick", label: t("site.home.categoriesPick") },
        ]}
      />
      {form.mode === "all" ? (
        <p className="text-sm text-muted-foreground">{t("site.home.categoriesAllHint")}</p>
      ) : (
        <CategoryPicker ids={form.categoryIds} onChange={(categoryIds) => onChange({ ...form, categoryIds })} max={SECTION_LIST_LIMITS.ids} disabled={disabled} idPrefix={idp} />
      )}
      <FieldError code={errors.categoryIds} />
      <CategoryLayoutFields layout={form.layout} showCounts={form.showCounts} columns={form.columns} onChange={(p) => onChange({ ...form, ...p })} disabled={disabled} idp={idp} />
    </div>
  );
}

function CollectionFields({ form, onChange, errors, disabled, idp }: Props<"collection">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <div className="grid content-start gap-2">
        <Label htmlFor={`${idp}-col`}>{t("site.home.collection")}</Label>
        <SlugSelect id={`${idp}-col`} type="collection" value={form.collectionSlug} invalid={!!errors.collectionSlug} disabled={disabled} onChange={(collectionSlug) => onChange({ ...form, collectionSlug })} />
        <FieldError code={errors.collectionSlug} />
      </div>
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional hint={t("site.home.collectionTitleHint")} value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <Label>{t("site.home.layout")}</Label>
          <ChipGroup<"carousel" | "grid">
            value={form.layout}
            onChange={(layout) => onChange({ ...form, layout })}
            aria-label={t("site.home.layout")}
            options={[
              { value: "carousel", label: t("site.home.layoutCarousel") },
              { value: "grid", label: t("site.home.layoutGrid") },
            ]}
          />
        </div>
        <TextField
          id={`${idp}-limit`}
          label={t("site.home.limit")}
          inputMode="numeric"
          value={form.limit}
          hint={t("site.home.limitHint", { max: SECTION_LIST_LIMITS.collectionLimit })}
          disabled={disabled}
          error={errors.limit}
          inputClassName="w-28"
          onChange={(v) => onChange({ ...form, limit: v.replace(/\D/g, "").slice(0, 2) })}
        />
      </div>
    </div>
  );
}

function ProductsFields({ form, onChange, errors, disabled, idp }: Props<"products">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
      <ProductPicker ids={form.productIds} onChange={(productIds) => onChange({ ...form, productIds })} max={SECTION_LIST_LIMITS.ids} disabled={disabled} idPrefix={idp} />
      <FieldError code={errors.productIds} />
    </div>
  );
}

// ---------------------------------------------------------------- static sections

function BannerFields({ form, onChange, errors, disabled, idp }: Props<"banner">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-2">
          <Label>{t("site.home.image")}</Label>
          <ImageField value={form.imageUrl} onChange={(imageUrl) => onChange({ ...form, imageUrl })} aspect="aspect-[16/5]" disabled={disabled} invalid={!!errors.imageUrl} />
          <FieldError code={errors.imageUrl} />
        </div>
        <div className="grid content-start gap-2">
          <Label>
            {t("site.home.mobileImage")}
            <Optional />
          </Label>
          <ImageField value={form.mobileImageUrl} onChange={(mobileImageUrl) => onChange({ ...form, mobileImageUrl })} aspect="aspect-[4/3]" className="max-w-48" disabled={disabled} />
          <FieldError code={errors.mobileImageUrl} />
        </div>
      </div>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextField id={`${idp}-href`} label={t("site.home.bannerLink")} optional placeholder="/collections/sale" hint={t("site.common.linkHint")} value={form.href} disabled={disabled} error={errors.href} onChange={(href) => onChange({ ...form, href })} />
        <TextField id={`${idp}-alt`} label={t("site.media.alt")} hint={t("site.media.altHint")} value={form.alt} maxLength={200} disabled={disabled} error={errors.alt} onChange={(alt) => onChange({ ...form, alt })} />
      </div>
    </div>
  );
}

function TextFields({ form, onChange, errors, disabled, idp }: Props<"text">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-h`} label={t("site.home.heading")} optional value={form.heading} maxLength={120} disabled={disabled} error={errors.heading} onChange={(heading) => onChange({ ...form, heading })} />
      <MarkdownField id={`${idp}-md`} label={t("site.home.text")} value={form.markdown} rows={6} maxLength={10_000} disabled={disabled} error={errors.markdown} onChange={(markdown) => onChange({ ...form, markdown })} />
    </div>
  );
}

function ImageTextFields({ form, onChange, errors, disabled, idp }: Props<"image-text">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <div className="grid content-start gap-2">
        <Label>{t("site.home.image")}</Label>
        <ImageField value={form.imageUrl} onChange={(imageUrl) => onChange({ ...form, imageUrl })} aspect="aspect-[4/3]" disabled={disabled} invalid={!!errors.imageUrl} />
        <FieldError code={errors.imageUrl} />
      </div>
      <div className="grid content-start gap-2">
        <Label>{t("site.home.imageSide")}</Label>
        <ChipGroup<"left" | "right">
          value={form.imageSide}
          onChange={(imageSide) => onChange({ ...form, imageSide })}
          aria-label={t("site.home.imageSide")}
          options={[
            { value: "left", label: t("site.home.imageLeft") },
            { value: "right", label: t("site.home.imageRight") },
          ]}
        />
      </div>
      <TextField id={`${idp}-h`} label={t("site.home.heading")} value={form.heading} maxLength={120} disabled={disabled} error={errors.heading} onChange={(heading) => onChange({ ...form, heading })} />
      <MarkdownField id={`${idp}-md`} label={t("site.home.text")} optional value={form.markdown} rows={5} maxLength={10_000} disabled={disabled} error={errors.markdown} onChange={(markdown) => onChange({ ...form, markdown })} />
      <CtaFields idp={idp} label={form.ctaLabel} href={form.ctaHref} onLabel={(ctaLabel) => onChange({ ...form, ctaLabel })} onHref={(ctaHref) => onChange({ ...form, ctaHref })} errors={errors} disabled={disabled} />
    </div>
  );
}

function UspFields({ form, onChange, errors, disabled, idp }: Props<"usp">) {
  const { t } = useI18n();
  const set = (i: number, p: Partial<{ icon: string; title: string; text: string }>) => onChange({ ...form, items: form.items.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  return (
    <div className="grid gap-4">
      <UspLayoutFields form={form} onChange={onChange} errors={errors} disabled={disabled} idp={idp} />
      {form.items.map((it, i) => {
        const current = uspIconKey(it.icon);
        return (
          <div key={i} className="grid gap-3 rounded-xl border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{t("site.home.uspN", { n: i + 1 })}</span>
              <ItemTools i={i} n={form.items.length} disabled={disabled} onMove={(d) => onChange({ ...form, items: moveIn(form.items, i, d) })} onRemove={() => onChange({ ...form, items: form.items.filter((_, j) => j !== i) })} />
            </div>
            <div className="grid content-start gap-2">
              <Label id={`${idp}-icon${i}`}>{t("site.home.icon")}</Label>
              <div role="radiogroup" aria-labelledby={`${idp}-icon${i}`} className="flex flex-wrap gap-1.5">
                {USP_ICON_KEYS.map((key) => {
                  const Icon = USP_ICON_MAP[key]!;
                  const on = current === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={t(`site.home.uspIcon.${key}`)}
                      title={t(`site.home.uspIcon.${key}`)}
                      disabled={disabled}
                      onClick={() => set(i, { icon: key })}
                      className={cn(
                        "inline-flex size-10 items-center justify-center rounded-xl border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                        on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4.5" />
                    </button>
                  );
                })}
              </div>
              <FieldError code={errors[`items.${i}.icon`]} />
            </div>
            <div className="grid items-start gap-3 sm:grid-cols-2">
              <TextField id={`${idp}-t${i}`} label={t("site.home.uspTitle")} value={it.title} maxLength={60} disabled={disabled} error={errors[`items.${i}.title`]} onChange={(title) => set(i, { title })} />
              <TextField id={`${idp}-x${i}`} label={t("site.home.uspText")} optional value={it.text} maxLength={200} disabled={disabled} error={errors[`items.${i}.text`]} onChange={(text) => set(i, { text })} />
            </div>
          </div>
        );
      })}
      <FieldError code={errors.items} />
      <Button type="button" variant="outline" className="justify-self-start" disabled={disabled || form.items.length >= SECTION_LIST_LIMITS.usps} onClick={() => onChange({ ...form, items: [...form.items, { icon: "check", title: "", text: "" }] })}>
        <PlusIcon /> {t("site.home.addUsp")}
      </Button>
    </div>
  );
}

function NewsletterFields({ form, onChange, errors, disabled, idp }: Props<"newsletter">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-h`} label={t("site.home.heading")} value={form.heading} maxLength={120} disabled={disabled} error={errors.heading} onChange={(heading) => onChange({ ...form, heading })} />
      <UiField id={`${idp}-x`}>
        <FieldLabel>
          {t("site.home.text")}
          <Optional />
        </FieldLabel>
        <FieldControl>
          <Input value={form.text} maxLength={400} disabled={disabled} onChange={(e) => onChange({ ...form, text: e.target.value })} />
        </FieldControl>
        <FieldError code={errors.text} />
      </UiField>
      <NewsletterLayoutFields form={form} onChange={onChange} errors={errors} disabled={disabled} idp={idp} />
      <p className="text-meta text-muted-foreground">{t("site.home.newsletterHint")}</p>
    </div>
  );
}

/** One-line summary for a collapsed section row. */
export function sectionSummary(f: SectionForm, t: (k: string, v?: Record<string, string | number>) => string): string {
  switch (f.type) {
    case "hero":
      return f.slides[0]?.heading || t("site.home.slides", { count: f.slides.length });
    case "categories":
      return f.title || (f.mode === "all" ? t("site.home.categoriesAll") : t("site.home.categoriesCount", { count: f.categoryIds.length }));
    case "collection":
      return f.title || f.collectionSlug || t("site.home.noCollection");
    case "products":
      return f.title || t("site.home.productsCount", { count: f.productIds.length });
    case "banner":
      return f.alt || f.href || "";
    case "text":
      return f.heading || f.markdown.slice(0, 60);
    case "image-text":
      return f.heading;
    case "testimonials":
      return f.title || t("site.home.testimonialsCount", { count: f.items.length });
    case "usp":
      return f.items.map((i) => i.title).filter(Boolean).join(" · ");
    case "newsletter":
      return f.heading;
    case "hero-split":
    case "hero-video":
    case "offer":
    case "appointment":
      return f.heading;
    case "gallery":
      return f.title || t("site.home.imagesCount", { count: f.images.length });
    case "logos":
      return f.title || f.items.map((i) => i.name).filter(Boolean).join(" · ");
    case "category-mosaic":
      return f.title || (f.categoryIds.length ? t("site.home.categoriesCount", { count: f.categoryIds.length }) : t("site.home.mosaicAuto"));
    case "faq":
      return f.title || t("site.home.questionsCount", { count: f.items.length });
    case "location":
      return f.address.split(/\r?\n/)[0] || f.title;
    case "menu-board":
      return f.title || f.groups.map((g) => g.name).filter(Boolean).join(" · ");
    case "before-after":
    case "gold-rates":
      return f.title;
    case "instagram":
      return f.handle ? `@${f.handle.replace(/^@/, "")}` : f.title;
    case "product-tabs":
      return f.title || f.tabs.map((x) => x.label || t(`site.home.tabSource.${x.source}`)).join(" · ");
    case "deal":
      return f.title || (f.productId ? t("site.home.productsCount", { count: 1 }) : t("site.home.dealPick"));
    case "shop-the-look":
      return f.title || t("site.home.dotsCount", { count: f.hotspots.length });
    case "bestsellers":
    case "recommended":
      return f.title || t(`site.home.type.${f.type}`);
    case "recently-viewed":
      return f.title || t("site.home.type.recently-viewed");
    case "stats":
      return f.title || f.items.map((i) => `${i.prefix}${i.value}${i.suffix} ${i.label}`.trim()).filter(Boolean).join(" · ");
    case "timeline":
      return f.title || f.items.map((i) => i.when).filter(Boolean).join(" → ");
    case "team":
      return f.title || f.members.map((m) => m.name).filter(Boolean).join(" · ");
    case "pricing-table":
      return f.title || f.plans.map((p) => p.name).filter(Boolean).join(" · ");
    case "blog-posts":
    case "reviews-summary":
      return f.title || t(`site.home.type.${f.type}`);
    case "flash-sale":
      return f.title || (f.source === "pick" ? t("site.home.productsCount", { count: f.productIds.length }) : t(`site.layouts.flashSource.${f.source}`));
    case "finder":
      return f.title || f.questions.map((q) => q.label).filter(Boolean).join(" · ");
    case "stories":
      return f.title || t("site.layouts.storiesCount", { count: f.items.length });
    case "category-shelf":
      return f.title || (f.mode === "all" ? t("site.layouts.shelfFirst") : t("site.home.categoriesCount", { count: f.categoryIds.length }));
    case "sticky-story":
      return f.title || f.chapters.map((c) => c.heading).filter(Boolean).join(" → ");
    case "comparison":
      return f.title || t("site.home.productsCount", { count: f.productIds.length });
    case "tiles":
      return f.title || f.items.map((i) => i.label).filter(Boolean).join(" · ");
    case "size-finder":
      return f.title || f.groups.map((g) => g.label).filter(Boolean).join(" · ");
    case "swatches":
      return f.title || t("site.layouts.shadesCount", { count: f.shades.length });
  }
}
