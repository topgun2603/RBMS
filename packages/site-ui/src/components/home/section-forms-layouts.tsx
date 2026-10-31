"use client";

import * as React from "react";
import { StarIcon } from "lucide-react";
import { ChipGroup, cn, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { useCategories, useProductsByIds } from "../../lib/queries";
import {
  emptyChapter,
  emptyFinderOption,
  emptyStory,
  emptySizeGroup,
  emptyShade,
  emptyTile,
  SECTION_LIST_LIMITS,
  type ChapterForm,
  type CompareRowForm,
  type FinderLayout,
  type FinderResults,
  type FinderOptionForm,
  type FinderQuestionForm,
  type FlashSaleSource,
  type ShelfLayout,
  type StoryForm,
  type SizeGroupForm,
  type ShadeForm,
  type SkinDepth,
  type TileForm,
  type TileLayout,
  type StoryLayout,
} from "../../lib/sections";
import { FieldError, TextField } from "../bits";
import { MarkdownField } from "../markdown-field";
import { VideoField } from "../media-video-field";
import { CategoryPicker, ProductPicker, SlugSelect } from "../pickers";
import { CtaFields } from "./form-parts";
import { Chips, Img, Repeat, Toggle, type Props } from "./section-forms-extra";

/*
 * Forms for the layout sections: flash sale, finder, stories, category shelf, sticky story and comparison. Field for
 * field with the cms schemas (lib/content.ts); cross-field rules (a sale's products, a finder answer's filter) come
 * from lib/sections `layoutChecks`.
 */

type T = (k: string, v?: Record<string, string | number>) => string;
const shelfLayouts = (t: T) => [
  { value: "carousel" as const, label: t("site.home.layoutCarousel") },
  { value: "grid" as const, label: t("site.home.layoutGrid") },
];
const digits = (v: string, n = 2) => v.replace(/\D/g, "").slice(0, n);
const money = (v: string) => v.replace(/[^\d.]/g, "").slice(0, 9);

function Limit({ id, value, onChange, max, min = 1, error, disabled, label }: { id: string; value: string; onChange: (v: string) => void; max: number; min?: number; error?: string; disabled?: boolean; label: string }) {
  const { t } = useI18n();
  return <TextField id={id} label={label} inputMode="numeric" value={value} hint={t("site.layouts.limitRange", { min, max })} disabled={disabled} error={error} inputClassName="w-28" onChange={(v) => onChange(digits(v))} />;
}

// ---------------------------------------------------------------- flash sale

export function FlashSaleFields({ form, onChange, errors, disabled, idp }: Props<"flash-sale">) {
  const { t } = useI18n();
  const set = (p: Partial<typeof form>) => onChange({ ...form, ...p });
  return (
    <div className="grid gap-4">
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional placeholder={t("site.layouts.flashTitlePlaceholder")} value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => set({ title })} />
        <TextField id={`${idp}-text`} label={t("site.home.text")} optional value={form.text} maxLength={400} disabled={disabled} error={errors.text} onChange={(text) => set({ text })} />
      </div>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextField id={`${idp}-start`} type="datetime-local" label={t("site.layouts.startsAt")} optional hint={t("site.layouts.startsAtHint")} value={form.startsAt} disabled={disabled} error={errors.startsAt} onChange={(startsAt) => set({ startsAt })} />
        <TextField id={`${idp}-end`} type="datetime-local" label={t("site.layouts.endsAt")} hint={t("site.layouts.endsAtHint")} value={form.endsAt} disabled={disabled} error={errors.endsAt} onChange={(endsAt) => set({ endsAt })} />
      </div>
      {/* Optional daily window: "every day 6–9 pm", or from 6 pm "until midnight" (end 00:00). */}
      <fieldset className="grid gap-2" data-testid="flash-daily">
        <legend className="mb-1 text-sm font-medium">{t("site.home.flash.daily")}</legend>
        <div className="flex flex-wrap items-start gap-3">
          <TextField id={`${idp}-dfrom`} type="time" label={t("site.home.flash.dailyFrom")} optional value={form.dailyFrom} disabled={disabled} error={errors.dailyFrom} inputClassName="w-36" onChange={(dailyFrom) => set({ dailyFrom })} />
          <TextField id={`${idp}-dto`} type="time" label={t("site.home.flash.dailyTo")} optional value={form.dailyTo} disabled={disabled} error={errors.dailyTo} inputClassName="w-36" onChange={(dailyTo) => set({ dailyTo })} />
        </div>
        <p className="text-meta text-muted-foreground">{t("site.home.flash.dailyHint")}</p>
      </fieldset>
      <Chips<FlashSaleSource>
        label={t("site.layouts.flashSource")}
        value={form.source}
        onChange={(source) => set({ source })}
        disabled={disabled}
        options={(["pick", "sale", "collection"] as const).map((v) => ({ value: v, label: t(`site.layouts.flashSource.${v}`) }))}
      />
      {form.source === "pick" && (
        <div className="grid content-start gap-2">
          <Label>{t("site.layouts.products")}</Label>
          <ProductPicker ids={form.productIds} onChange={(productIds) => set({ productIds })} max={SECTION_LIST_LIMITS.shelfLimit} disabled={disabled} idPrefix={idp} />
          <FieldError code={errors.productIds} />
        </div>
      )}
      {form.source === "collection" && (
        <div className="grid content-start gap-2">
          <Label htmlFor={`${idp}-col`}>{t("site.home.collection")}</Label>
          <SlugSelect id={`${idp}-col`} type="collection" value={form.collectionSlug} invalid={!!errors.collectionSlug} disabled={disabled} onChange={(collectionSlug) => set({ collectionSlug })} />
          <FieldError code={errors.collectionSlug} />
        </div>
      )}
      {form.source === "sale" && <p className="text-meta text-muted-foreground">{t("site.layouts.flashSaleHint")}</p>}
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Chips<ShelfLayout> label={t("site.home.layout")} value={form.layout} onChange={(layout) => set({ layout })} options={shelfLayouts(t)} disabled={disabled} />
        <Limit id={`${idp}-limit`} label={t("site.home.limit")} value={form.limit} onChange={(limit) => set({ limit })} max={SECTION_LIST_LIMITS.shelfLimit} error={errors.limit} disabled={disabled} />
      </div>
      <CtaFields idp={idp} label={form.ctaLabel} href={form.ctaHref} onLabel={(ctaLabel) => set({ ctaLabel })} onHref={(ctaHref) => set({ ctaHref })} errors={errors} disabled={disabled} />
      <p className="text-meta text-muted-foreground">{t("site.layouts.flashHint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------- finder

function CategorySelect({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const cats = useCategories();
  const all = (cats.data ?? []).filter((c) => c.active);
  const NONE = "__none";
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)} disabled={disabled || cats.isPending}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={t("site.common.loading")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t("site.layouts.anyCategory")}</SelectItem>
        {value && !all.some((c) => c.id === value) && <SelectItem value={value}>{t("site.pickers.missing")}</SelectItem>}
        {all.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FinderOptionFields({ o, set, errors, prefix, disabled, idp }: { o: FinderOptionForm; set: (p: Partial<FinderOptionForm>) => void; errors: Props<"finder">["errors"]; prefix: string; disabled?: boolean; idp: string }) {
  const { t } = useI18n();
  const e = (k: string) => errors[`${prefix}.${k}`];
  return (
    <div className="grid gap-3">
      <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <TextField id={`${idp}-l`} label={t("site.layouts.answer")} placeholder={t("site.layouts.answerPlaceholder")} value={o.label} maxLength={60} disabled={disabled} error={e("label")} onChange={(label) => set({ label })} />
        <Img label={t("site.layouts.answerImage")} optional value={o.imageUrl} onChange={(imageUrl) => set({ imageUrl })} aspect="aspect-[4/3]" disabled={disabled} error={e("imageUrl")} />
      </div>
      <fieldset className="grid gap-3 rounded-lg border border-dashed p-3">
        <legend className="px-1 text-xs font-semibold text-muted-foreground">{t("site.layouts.answerFilters")}</legend>
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <div className="grid content-start gap-2">
            <Label htmlFor={`${idp}-cat`}>{t("site.layouts.filterCategory")}</Label>
            <CategorySelect id={`${idp}-cat`} value={o.categoryId} onChange={(categoryId) => set({ categoryId })} disabled={disabled} />
          </div>
          <TextField id={`${idp}-tag`} label={t("site.layouts.filterTag")} optional placeholder="class-1-5" hint={t("site.layouts.filterTagHint")} value={o.tag} maxLength={40} disabled={disabled} error={e("tag")} onChange={(tag) => set({ tag: tag.toLowerCase() })} />
          <TextField id={`${idp}-kw`} label={t("site.layouts.filterKeywords")} optional hint={t("site.layouts.filterKeywordsHint")} value={o.keywords} maxLength={120} disabled={disabled} error={e("keywords")} onChange={(keywords) => set({ keywords })} />
          <TextField id={`${idp}-fn`} label={t("site.layouts.filterName")} optional placeholder={t("site.layouts.filterNamePlaceholder")} value={o.filterName} maxLength={60} disabled={disabled} error={e("filterName")} onChange={(filterName) => set({ filterName })} />
          <TextField id={`${idp}-fv`} label={t("site.layouts.filterValue")} optional placeholder={t("site.layouts.filterValuePlaceholder")} value={o.filterValue} maxLength={200} disabled={disabled} error={e("filterValue")} onChange={(filterValue) => set({ filterValue })} />
          <TextField id={`${idp}-pmin`} label={t("site.layouts.priceMin")} optional inputMode="decimal" value={o.priceMin} disabled={disabled} error={e("priceMin")} onChange={(v) => set({ priceMin: money(v) })} />
          <TextField id={`${idp}-pmax`} label={t("site.layouts.priceMax")} optional inputMode="decimal" value={o.priceMax} disabled={disabled} error={e("priceMax")} onChange={(v) => set({ priceMax: money(v) })} />
          <TextField id={`${idp}-href`} label={t("site.layouts.answerLink")} optional placeholder="/collections/class-1-5" hint={t("site.layouts.answerLinkHint")} value={o.href} disabled={disabled} error={e("href")} onChange={(href) => set({ href })} />
        </div>
        <p className="text-meta text-muted-foreground">{t("site.layouts.filterHint")}</p>
        <FieldError code={e("filter")} />
      </fieldset>
    </div>
  );
}

export function FinderFields({ form, onChange, errors, disabled, idp }: Props<"finder">) {
  const { t } = useI18n();
  const set = (p: Partial<typeof form>) => onChange({ ...form, ...p });
  return (
    <div className="grid gap-4">
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional placeholder={t("site.layouts.finderTitlePlaceholder")} value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => set({ title })} />
        <TextField id={`${idp}-text`} label={t("site.home.text")} optional value={form.text} maxLength={400} disabled={disabled} error={errors.text} onChange={(text) => set({ text })} />
      </div>
      <div className="grid items-start gap-4">
        <Chips<FinderLayout>
          label={t("site.home.layout")}
          value={form.layout}
          onChange={(layout) => set({ layout })}
          disabled={disabled}
          options={(["wizard", "chips"] as const).map((v) => ({ value: v, label: t(`site.layouts.finderLayout.${v}`) }))}
        />
        <Chips<FinderResults>
          label={t("site.layouts.finderResults")}
          value={form.results}
          onChange={(results) => set({ results })}
          disabled={disabled}
          options={(["inline", "button"] as const).map((v) => ({ value: v, label: t(`site.layouts.finderResults.${v}`) }))}
        />
        {form.results === "inline" ? (
          <Limit id={`${idp}-limit`} label={t("site.layouts.finderLimit")} value={form.limit} onChange={(limit) => set({ limit })} min={2} max={12} error={errors.limit} disabled={disabled} />
        ) : (
          <TextField id={`${idp}-btn`} label={t("site.layouts.finderButton")} optional placeholder={t("site.layouts.finderButtonPlaceholder")} value={form.buttonLabel} maxLength={60} disabled={disabled} error={errors.buttonLabel} onChange={(buttonLabel) => set({ buttonLabel })} />
        )}
      </div>
      <div className="grid items-start gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
        <Img label={t("site.layouts.finderPicture")} optional hint={t("site.layouts.finderPictureHint")} value={form.imageUrl} onChange={(imageUrl) => set({ imageUrl })} aspect="aspect-[4/5]" disabled={disabled} error={errors.imageUrl} />
        <CtaFields idp={`${idp}-cta`} label={form.ctaLabel} href={form.ctaHref} onLabel={(ctaLabel) => set({ ctaLabel })} onHref={(ctaHref) => set({ ctaHref })} errors={errors} disabled={disabled} labelText={t("site.layouts.finderSecond")} placeholder="https://wa.me/91…" />
      </div>
      <Repeat<FinderQuestionForm>
        items={form.questions}
        onChange={(questions) => set({ questions })}
        make={() => ({ label: "", options: [emptyFinderOption(), emptyFinderOption()] })}
        max={SECTION_LIST_LIMITS.finderQuestions}
        title={(i) => t("site.layouts.questionN", { n: i + 1 })}
        addLabel={t("site.layouts.addQuestion")}
        disabled={disabled}
        error={errors.questions}
      >
        {(q, setQ, qi) => (
          <>
            <TextField id={`${idp}-q${qi}`} label={t("site.layouts.question")} placeholder={t("site.layouts.questionPlaceholder")} value={q.label} maxLength={120} disabled={disabled} error={errors[`questions.${qi}.label`]} onChange={(label) => setQ({ label })} />
            <Repeat<FinderOptionForm>
              items={q.options}
              onChange={(options) => setQ({ options })}
              make={emptyFinderOption}
              min={2}
              max={SECTION_LIST_LIMITS.finderOptions}
              title={(i) => t("site.layouts.answerN", { n: i + 1 })}
              addLabel={t("site.layouts.addAnswer")}
              disabled={disabled}
              error={errors[`questions.${qi}.options`]}
            >
              {(o, setO, oi) => <FinderOptionFields o={o} set={setO} errors={errors} prefix={`questions.${qi}.options.${oi}`} disabled={disabled} idp={`${idp}-q${qi}o${oi}`} />}
            </Repeat>
          </>
        )}
      </Repeat>
      <p className="text-meta text-muted-foreground">{t("site.layouts.finderHint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------- stories

export function StoriesFields({ form, onChange, errors, disabled, idp }: Props<"stories">) {
  const { t } = useI18n();
  const set = (p: Partial<typeof form>) => onChange({ ...form, ...p });
  return (
    <div className="grid gap-4">
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => set({ title })} />
        <Chips<StoryLayout>
          label={t("site.home.layout")}
          value={form.layout}
          onChange={(layout) => set({ layout })}
          disabled={disabled}
          options={(["rings", "reels"] as const).map((v) => ({ value: v, label: t(`site.layouts.storyLayout.${v}`) }))}
        />
      </div>
      <Repeat<StoryForm>
        items={form.items}
        onChange={(items) => set({ items })}
        make={emptyStory}
        min={0}
        max={SECTION_LIST_LIMITS.stories}
        title={(i) => t("site.layouts.storyN", { n: i + 1 })}
        addLabel={t("site.layouts.addStory")}
        disabled={disabled}
        error={errors.items}
      >
        {(it, setIt, i) => (
          <div className="grid items-start gap-3 md:grid-cols-[9rem_minmax(0,1fr)]">
            <Img label={t("site.home.image")} value={it.imageUrl} onChange={(imageUrl) => setIt({ imageUrl })} aspect="aspect-[9/16]" disabled={disabled} error={errors[`items.${i}.imageUrl`]} />
            <div className="grid gap-3">
              <div className="grid items-start gap-3 sm:grid-cols-2">
                <TextField id={`${idp}-st${i}`} label={t("site.layouts.storyTitle")} value={it.title} maxLength={60} disabled={disabled} error={errors[`items.${i}.title`]} onChange={(title) => setIt({ title })} />
                <TextField id={`${idp}-sx${i}`} label={t("site.home.text")} optional value={it.text} maxLength={200} disabled={disabled} error={errors[`items.${i}.text`]} onChange={(text) => setIt({ text })} />
                <TextField id={`${idp}-sh${i}`} label={t("site.home.ctaHref")} optional placeholder="/c/new-arrivals" hint={t("site.common.linkHint")} value={it.href} disabled={disabled} error={errors[`items.${i}.href`]} onChange={(href) => setIt({ href })} />
                <TextField id={`${idp}-sc${i}`} label={t("site.home.ctaLabel")} optional placeholder={t("site.layouts.storyCtaPlaceholder")} value={it.ctaLabel} maxLength={60} disabled={disabled} error={errors[`items.${i}.ctaLabel`]} onChange={(ctaLabel) => setIt({ ctaLabel })} />
              </div>
              <VideoField id={`${idp}-sv${i}`} label={t("site.layouts.storyVideo")} hint={t("site.layouts.storyVideoHint")} value={it.videoUrl} disabled={disabled} error={errors[`items.${i}.videoUrl`]} onChange={(videoUrl) => setIt({ videoUrl })} />
            </div>
          </div>
        )}
      </Repeat>
    </div>
  );
}

// ---------------------------------------------------------------- category shelf

export function CategoryShelfFields({ form, onChange, errors, disabled, idp }: Props<"category-shelf">) {
  const { t } = useI18n();
  const set = (p: Partial<typeof form>) => onChange({ ...form, ...p });
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => set({ title })} />
      <ChipGroup<"all" | "pick">
        value={form.mode}
        onChange={(mode) => set({ mode })}
        aria-label={t("site.home.categoriesMode")}
        options={[
          { value: "all", label: t("site.layouts.shelfFirst") },
          { value: "pick", label: t("site.home.categoriesPick") },
        ]}
      />
      {form.mode === "pick" ? (
        <CategoryPicker ids={form.categoryIds} onChange={(categoryIds) => set({ categoryIds })} max={SECTION_LIST_LIMITS.shelfCategories} disabled={disabled} idPrefix={idp} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("site.layouts.shelfFirstHint")}</p>
      )}
      <FieldError code={errors.categoryIds} />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Limit id={`${idp}-limit`} label={t("site.layouts.perCategory")} value={form.limit} onChange={(limit) => set({ limit })} max={SECTION_LIST_LIMITS.shelfLimit} error={errors.limit} disabled={disabled} />
        <Toggle id={`${idp}-img`} label={t("site.layouts.shelfImages")} checked={form.showImages} onChange={(showImages) => set({ showImages })} disabled={disabled} />
      </div>
      <p className="text-meta text-muted-foreground">{t("site.layouts.shelfHint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------- sticky story

export function StickyStoryFields({ form, onChange, errors, disabled, idp }: Props<"sticky-story">) {
  const { t } = useI18n();
  const set = (p: Partial<typeof form>) => onChange({ ...form, ...p });
  return (
    <div className="grid gap-4">
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => set({ title })} />
        <Chips<"left" | "right">
          label={t("site.layouts.pictureSide")}
          value={form.imageSide}
          onChange={(imageSide) => set({ imageSide })}
          disabled={disabled}
          options={[
            { value: "left", label: t("site.home.imageLeft") },
            { value: "right", label: t("site.home.imageRight") },
          ]}
        />
      </div>
      <Repeat<ChapterForm>
        items={form.chapters}
        onChange={(chapters) => set({ chapters })}
        make={emptyChapter}
        max={SECTION_LIST_LIMITS.chapters}
        title={(i) => t("site.layouts.chapterN", { n: i + 1 })}
        addLabel={t("site.layouts.addChapter")}
        disabled={disabled}
        error={errors.chapters}
      >
        {(c, setC, i) => (
          <div className="grid items-start gap-3 md:grid-cols-[12rem_minmax(0,1fr)]">
            <div className="grid gap-3">
              <Img label={t("site.home.image")} value={c.imageUrl} onChange={(imageUrl) => setC({ imageUrl })} aspect="aspect-[4/5]" disabled={disabled} error={errors[`chapters.${i}.imageUrl`]} />
              <TextField id={`${idp}-alt${i}`} label={t("site.media.alt")} optional value={c.alt} maxLength={200} disabled={disabled} error={errors[`chapters.${i}.alt`]} onChange={(alt) => setC({ alt })} />
            </div>
            <div className="grid gap-3">
              <div className="grid items-start gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <TextField id={`${idp}-eb${i}`} label={t("site.home.eyebrow")} optional value={c.eyebrow} maxLength={60} disabled={disabled} error={errors[`chapters.${i}.eyebrow`]} onChange={(eyebrow) => setC({ eyebrow })} />
                <TextField id={`${idp}-hd${i}`} label={t("site.home.heading")} value={c.heading} maxLength={120} disabled={disabled} error={errors[`chapters.${i}.heading`]} onChange={(heading) => setC({ heading })} />
              </div>
              <MarkdownField id={`${idp}-md${i}`} label={t("site.home.text")} optional value={c.markdown} rows={4} maxLength={3000} disabled={disabled} error={errors[`chapters.${i}.markdown`]} onChange={(markdown) => setC({ markdown })} />
              <CtaFields idp={`${idp}-c${i}`} label={c.ctaLabel} href={c.ctaHref} onLabel={(ctaLabel) => setC({ ctaLabel })} onHref={(ctaHref) => setC({ ctaHref })} errors={errors} prefix={`chapters.${i}.`} disabled={disabled} />
            </div>
          </div>
        )}
      </Repeat>
      <p className="text-meta text-muted-foreground">{t("site.layouts.storyHint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------- comparison

export function ComparisonFields({ form, onChange, errors, disabled, idp }: Props<"comparison">) {
  const { t } = useI18n();
  const set = (p: Partial<typeof form>) => onChange({ ...form, ...p });
  const found = useProductsByIds(form.productIds);
  const nameOf = (id: string, i: number): string => found.data?.get(id)?.name ?? t("site.layouts.productN", { n: i + 1 });
  // Values follow their product when products are added, removed or reordered.
  const setProducts = (ids: string[]) => {
    const pos = new Map(form.productIds.map((id, i) => [id, i]));
    set({
      productIds: ids,
      highlightId: ids.includes(form.highlightId) ? form.highlightId : "",
      rows: form.rows.map((r) => ({ ...r, values: ids.map((id) => (pos.has(id) ? (r.values[pos.get(id)!] ?? "") : "")) })),
    });
  };
  return (
    <div className="grid gap-4">
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional placeholder={t("site.layouts.compareTitlePlaceholder")} value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => set({ title })} />
        <TextField id={`${idp}-text`} label={t("site.home.text")} optional value={form.text} maxLength={400} disabled={disabled} error={errors.text} onChange={(text) => set({ text })} />
      </div>
      <div className="grid content-start gap-2">
        <Label>{t("site.layouts.compareProducts")}</Label>
        <ProductPicker ids={form.productIds} onChange={setProducts} max={SECTION_LIST_LIMITS.compareProducts} disabled={disabled} idPrefix={idp} />
        <FieldError code={errors.productIds} />
      </div>
      {form.productIds.length > 0 && (
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <div className="grid content-start gap-2">
            <Label id={`${idp}-hl`}>{t("site.layouts.compareHighlight")}</Label>
            <div role="radiogroup" aria-labelledby={`${idp}-hl`} className="flex flex-wrap gap-2">
              {["", ...form.productIds].map((id, i) => (
                <button
                  key={id || "none"}
                  type="button"
                  role="radio"
                  aria-checked={form.highlightId === id}
                  disabled={disabled}
                  onClick={() => set({ highlightId: id })}
                  className={cn(
                    "inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    form.highlightId === id ? "border-primary bg-primary/10 font-medium text-primary" : "hover:border-primary/40",
                  )}
                >
                  {id && <StarIcon className="size-3.5 shrink-0" aria-hidden />}
                  <span className="truncate">{id ? nameOf(id, i - 1) : t("site.layouts.compareNoHighlight")}</span>
                </button>
              ))}
            </div>
          </div>
          <TextField id={`${idp}-hll`} label={t("site.layouts.compareBadge")} optional placeholder={t("site.layouts.compareBadgePlaceholder")} value={form.highlightLabel} maxLength={30} disabled={disabled || !form.highlightId} error={errors.highlightLabel} onChange={(highlightLabel) => set({ highlightLabel })} />
        </div>
      )}
      <Toggle id={`${idp}-rt`} label={t("site.layouts.compareRating")} checked={form.showRating} onChange={(showRating) => set({ showRating })} disabled={disabled} />
      <Repeat<CompareRowForm>
        items={form.rows}
        onChange={(rows) => set({ rows })}
        make={() => ({ label: "", values: form.productIds.map(() => "") })}
        min={0}
        max={SECTION_LIST_LIMITS.compareRows}
        title={(i) => t("site.layouts.rowN", { n: i + 1 })}
        addLabel={t("site.layouts.addRow")}
        disabled={disabled}
        error={errors.rows}
      >
        {(r, setR, ri) => (
          <div className="grid gap-3">
            <TextField id={`${idp}-r${ri}`} label={t("site.layouts.rowLabel")} placeholder={t("site.layouts.rowLabelPlaceholder")} value={r.label} maxLength={60} disabled={disabled} error={errors[`rows.${ri}.label`]} onChange={(label) => setR({ label })} />
            {form.productIds.length > 0 ? (
              <div className={cn("grid items-start gap-3", form.productIds.length > 2 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2")}>
                {form.productIds.map((id, pi) => (
                  <TextField
                    key={id}
                    id={`${idp}-r${ri}v${pi}`}
                    label={<span className="block truncate">{nameOf(id, pi)}</span>}
                    optional
                    value={r.values[pi] ?? ""}
                    maxLength={120}
                    disabled={disabled}
                    error={errors[`rows.${ri}.values.${pi}`]}
                    onChange={(v) => setR({ values: form.productIds.map((_, j) => (j === pi ? v : (r.values[j] ?? ""))) })}
                  />
                ))}
              </div>
            ) : (
              <p className="text-meta text-muted-foreground">{t("site.layouts.rowNeedsProducts")}</p>
            )}
          </div>
        )}
      </Repeat>
    </div>
  );
}

// ---------------------------------------------------------------- tiles ("shop by need")

export function TilesFields({ form, onChange, errors, disabled, idp }: Props<"tiles">) {
  const { t } = useI18n();
  const set = (p: Partial<typeof form>) => onChange({ ...form, ...p });
  return (
    <div className="grid gap-4">
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional placeholder={t("site.layouts.tilesTitlePlaceholder")} value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => set({ title })} />
        <TextField id={`${idp}-text`} label={t("site.home.text")} optional value={form.text} maxLength={400} disabled={disabled} error={errors.text} onChange={(text) => set({ text })} />
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Chips<TileLayout>
          label={t("site.home.layout")}
          value={form.layout}
          onChange={(layout) => set({ layout })}
          disabled={disabled}
          options={(["row", "grid"] as const).map((v) => ({ value: v, label: t(`site.layouts.tileLayout.${v}`) }))}
        />
        <Toggle id={`${idp}-cnt`} label={t("site.layouts.tileCounts")} checked={form.showCounts} onChange={(showCounts) => set({ showCounts })} disabled={disabled} />
      </div>
      <Repeat<TileForm>
        items={form.items}
        onChange={(items) => set({ items })}
        make={emptyTile}
        max={SECTION_LIST_LIMITS.tiles}
        title={(i) => t("site.layouts.tileN", { n: i + 1 })}
        addLabel={t("site.layouts.addTile")}
        disabled={disabled}
        error={errors.items}
      >
        {(it, setIt, i) => (
          <div className="grid items-start gap-3 md:grid-cols-[8rem_minmax(0,1fr)]">
            <Img label={t("site.home.image")} optional hint={t("site.layouts.tileImageHint")} value={it.imageUrl} onChange={(imageUrl) => setIt({ imageUrl })} aspect="aspect-square" disabled={disabled} error={errors[`items.${i}.imageUrl`]} />
            <div className="grid gap-3">
              <div className="grid items-start gap-3 sm:grid-cols-2">
                <TextField id={`${idp}-tl${i}`} label={t("site.layouts.tileLabel")} placeholder={t("site.layouts.tileLabelPlaceholder")} value={it.label} maxLength={60} disabled={disabled} error={errors[`items.${i}.label`]} onChange={(label) => setIt({ label })} />
                <TextField id={`${idp}-tn${i}`} label={t("site.layouts.tileNote")} optional placeholder={t("site.layouts.tileNotePlaceholder")} value={it.note} maxLength={160} disabled={disabled} error={errors[`items.${i}.note`]} onChange={(note) => setIt({ note })} />
              </div>
              <div className="grid items-start gap-3 sm:grid-cols-3">
                <div className="grid content-start gap-2">
                  <Label htmlFor={`${idp}-tc${i}`}>{t("site.home.collection")}</Label>
                  <SlugSelect id={`${idp}-tc${i}`} type="collection" value={it.collectionSlug} disabled={disabled} invalid={!!errors[`items.${i}.collectionSlug`]} onChange={(collectionSlug) => setIt({ collectionSlug })} />
                </div>
                <TextField id={`${idp}-tt${i}`} label={t("site.layouts.filterTag")} optional placeholder="acne" value={it.tag} maxLength={40} disabled={disabled} error={errors[`items.${i}.tag`]} onChange={(tag) => setIt({ tag: tag.toLowerCase() })} />
                <TextField id={`${idp}-th${i}`} label={t("site.home.ctaHref")} optional placeholder="/pages/…" value={it.href} disabled={disabled} error={errors[`items.${i}.href`]} onChange={(href) => setIt({ href })} />
              </div>
            </div>
          </div>
        )}
      </Repeat>
      <p className="text-meta text-muted-foreground">{t("site.layouts.tilesHint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------- size finder

export function SizeFinderFields({ form, onChange, errors, disabled, idp }: Props<"size-finder">) {
  const { t } = useI18n();
  const set = (p: Partial<typeof form>) => onChange({ ...form, ...p });
  return (
    <div className="grid gap-4">
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional placeholder={t("site.layouts.sizeTitlePlaceholder")} value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => set({ title })} />
        <TextField id={`${idp}-text`} label={t("site.home.text")} optional value={form.text} maxLength={400} disabled={disabled} error={errors.text} onChange={(text) => set({ text })} />
      </div>
      <div className="grid items-start gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
        <Img label={t("site.layouts.finderPicture")} optional hint={t("site.layouts.finderPictureHint")} value={form.imageUrl} onChange={(imageUrl) => set({ imageUrl })} aspect="aspect-[4/3]" disabled={disabled} error={errors.imageUrl} />
        <div className="grid gap-3">
          <TextField id={`${idp}-opt`} label={t("site.layouts.sizeOption")} hint={t("site.layouts.sizeOptionHint")} value={form.optionName} maxLength={60} disabled={disabled} error={errors.optionName} onChange={(optionName) => set({ optionName })} />
          <Toggle id={`${idp}-foot`} label={t("site.layouts.sizeFootToggle")} hint={t("site.layouts.sizeFootToggleHint")} checked={form.footLength} onChange={(footLength) => set({ footLength })} disabled={disabled} />
        </div>
      </div>
      <Repeat<SizeGroupForm>
        items={form.groups}
        onChange={(groups) => set({ groups })}
        make={emptySizeGroup}
        max={SECTION_LIST_LIMITS.sizeGroups}
        title={(i) => t("site.layouts.sizeGroupN", { n: i + 1 })}
        addLabel={t("site.layouts.addSizeGroup")}
        disabled={disabled}
        error={errors.groups}
      >
        {(g, setG, i) => (
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <TextField id={`${idp}-gl${i}`} label={t("site.layouts.sizeGroupLabel")} placeholder={t("site.layouts.sizeGroupPlaceholder")} value={g.label} maxLength={60} disabled={disabled} error={errors[`groups.${i}.label`]} onChange={(label) => setG({ label })} />
            <div className="grid content-start gap-2">
              <Label htmlFor={`${idp}-gc${i}`}>{t("site.layouts.filterCategory")}</Label>
              <CategorySelect id={`${idp}-gc${i}`} value={g.categoryId} onChange={(categoryId) => setG({ categoryId })} disabled={disabled} />
            </div>
            <div className="sm:col-span-2">
              <TextField id={`${idp}-gs${i}`} label={t("site.layouts.sizeValues")} hint={t("site.layouts.sizeValuesHint")} placeholder="6, 7, 8, 9, 10" value={g.sizes} maxLength={300} disabled={disabled} error={errors[`groups.${i}.sizes`]} onChange={(sizes) => setG({ sizes })} />
            </div>
          </div>
        )}
      </Repeat>
    </div>
  );
}

// ---------------------------------------------------------------- shade finder (swatches)

export function SwatchesFields({ form, onChange, errors, disabled, idp }: Props<"swatches">) {
  const { t } = useI18n();
  const set = (p: Partial<typeof form>) => onChange({ ...form, ...p });
  return (
    <div className="grid gap-4">
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional placeholder={t("site.layouts.swatchesTitlePlaceholder")} value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => set({ title })} />
        <TextField id={`${idp}-text`} label={t("site.home.text")} optional value={form.text} maxLength={400} disabled={disabled} error={errors.text} onChange={(text) => set({ text })} />
      </div>
      <div className="grid content-start gap-2">
        <Label>{t("site.layouts.products")}</Label>
        <ProductPicker ids={form.productIds} onChange={(productIds) => set({ productIds })} max={SECTION_LIST_LIMITS.swatchProducts} disabled={disabled} idPrefix={idp} />
        <FieldError code={errors.productIds} />
      </div>
      <TextField id={`${idp}-opt`} label={t("site.layouts.shadeOption")} hint={t("site.layouts.shadeOptionHint")} value={form.optionName} maxLength={60} disabled={disabled} error={errors.optionName} inputClassName="sm:w-60" onChange={(optionName) => set({ optionName })} />
      {/* Products with two options (a case's colour × phone model): the shopper picks the other option first. */}
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextField id={`${idp}-also`} label={t("site.layouts.swatchAlso")} optional hint={t("site.layouts.swatchAlsoHint")} placeholder={t("site.layouts.swatchAlsoPlaceholder")} value={form.alsoOption} maxLength={60} disabled={disabled} error={errors.alsoOption} onChange={(alsoOption) => set({ alsoOption })} />
        {form.alsoOption.trim() && (
          <TextField id={`${idp}-alsolabel`} label={t("site.layouts.swatchAlsoLabel")} optional placeholder={t("site.layouts.swatchAlsoLabelPlaceholder", { name: form.alsoOption.trim() })} value={form.alsoLabel} maxLength={60} disabled={disabled} error={errors.alsoLabel} onChange={(alsoLabel) => set({ alsoLabel })} />
        )}
      </div>
      <Repeat<ShadeForm>
        items={form.shades}
        onChange={(shades) => set({ shades })}
        make={emptyShade}
        min={0}
        max={SECTION_LIST_LIMITS.shades}
        title={(i) => form.shades[i]?.value || t("site.layouts.shadeN", { n: i + 1 })}
        addLabel={t("site.layouts.addShade")}
        disabled={disabled}
        error={errors.shades}
      >
        {(sh, setSh, i) => (
          <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <TextField id={`${idp}-sv${i}`} label={t("site.layouts.shadeValue")} placeholder="Ruby red" hint={t("site.layouts.shadeValueHint")} value={sh.value} maxLength={80} disabled={disabled} error={errors[`shades.${i}.value`]} onChange={(value) => setSh({ value })} />
            <div className="grid content-start gap-2">
              <Label htmlFor={`${idp}-sh${i}`}>{t("site.layouts.shadeColour")}</Label>
              <div className="flex items-center gap-2">
                <input id={`${idp}-sh${i}`} type="color" value={/^#[0-9a-fA-F]{6}$/.test(sh.hex) ? sh.hex : "#b0413e"} disabled={disabled} onChange={(e) => setSh({ hex: e.target.value })} className="h-10 w-12 cursor-pointer rounded-md border bg-background p-1" />
                <span className="font-mono text-xs text-muted-foreground">{sh.hex}</span>
              </div>
              <FieldError code={errors[`shades.${i}.hex`]} />
            </div>
            <div className="sm:col-span-2">
              <Chips<SkinDepth>
                label={t("site.layouts.shadeDepth")}
                value={sh.depth}
                onChange={(depth) => setSh({ depth })}
                disabled={disabled}
                options={(["", "fair", "wheatish", "dusky", "deep"] as const).map((v) => ({ value: v, label: v ? t(`site.layouts.depth.${v}`) : t("site.layouts.depthNone") }))}
              />
            </div>
          </div>
        )}
      </Repeat>
      <p className="text-meta text-muted-foreground">{t("site.layouts.swatchesHint")}</p>
    </div>
  );
}
