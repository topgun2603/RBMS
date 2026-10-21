"use client";

import * as React from "react";
import { CrosshairIcon } from "lucide-react";
import { cn, Label, Textarea } from "@srirealtime/ui";
import { absoluteUrl, useI18n } from "@srirealtime/web";
import {
  emptyMember,
  emptyMilestone,
  emptyPlan,
  emptyStat,
  emptyTab,
  SECTION_LIST_LIMITS,
  type CategoryColumns,
  type CategoryLayout,
  type HotspotForm,
  type MemberForm,
  type MilestoneForm,
  type NewsletterLayout,
  type PlanForm,
  type ShelfLayout,
  type StatForm,
  type TabForm,
  type TabSource,
  type UspLayout,
} from "../../lib/sections";
import { FieldError, Optional, TextField } from "../bits";
import { ProductPicker, SlugSelect } from "../pickers";
import { CategoryLayoutThumb } from "./category-layout-thumbs";
import { CtaFields } from "./form-parts";
import { Area, Chips, Img, Repeat, Toggle, type Props } from "./section-forms-extra";

/*
 * Forms for the shelf, proof and story sections (product tabs, deal of the day, shop the look, best sellers,
 * recently viewed, recommended, stats, timeline, team, pricing, blog posts, reviews) and the layout pickers of the
 * categories, USP and newsletter sections.
 */

type T = (k: string, v?: Record<string, string | number>) => string;

const shelfLayouts = (t: T) => [
  { value: "carousel" as const, label: t("site.home.layoutCarousel") },
  { value: "grid" as const, label: t("site.home.layoutGrid") },
];

/** Digits only, at most `n` characters (counts, percentages). */
const digits = (v: string, n = 2) => v.replace(/\D/g, "").slice(0, n);

function LimitField({ id, value, onChange, max, error, disabled, label }: { id: string; value: string; onChange: (v: string) => void; max: number; error?: string; disabled?: boolean; label?: string }) {
  const { t } = useI18n();
  return (
    <TextField
      id={id}
      label={label ?? t("site.home.limit")}
      inputMode="numeric"
      value={value}
      hint={t("site.home.limitHint", { max })}
      disabled={disabled}
      error={error}
      inputClassName="w-28"
      onChange={(v) => onChange(digits(v))}
    />
  );
}

// ---------------------------------------------------------------- layouts of existing sections

/** Picker order: round rows first, then chips, grids, and the list. */
export const CATEGORY_LAYOUT_ORDER = ["circles", "rounded-squares", "story-rings", "pills", "icon-list", "cards", "tiles", "banner-row", "big-grid", "bento", "slider", "minimal-list"] as const satisfies readonly CategoryLayout[];
/** Layouts where "per row" means something (the round rows, chips and bento size themselves). */
const COLUMN_LAYOUTS: ReadonlySet<CategoryLayout> = new Set(["cards", "tiles", "banner-row", "big-grid", "slider", "minimal-list"]);

/** Layout picker for the categories section: a sketch of each layout, then per-row and counts. */
export function CategoryLayoutFields({
  layout,
  showCounts,
  columns,
  onChange,
  disabled,
  idp,
}: {
  layout: CategoryLayout;
  showCounts: boolean;
  columns: CategoryColumns;
  onChange: (p: { layout?: CategoryLayout; showCounts?: boolean; columns?: CategoryColumns }) => void;
  disabled?: boolean;
  idp: string;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <div className="grid content-start gap-2">
        <Label id={`${idp}-layout`}>{t("site.home.layout")}</Label>
        <div role="radiogroup" aria-labelledby={`${idp}-layout`} className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {CATEGORY_LAYOUT_ORDER.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={layout === v}
              disabled={disabled}
              onClick={() => onChange({ layout: v })}
              className={cn(
                "grid gap-1 rounded-xl border bg-card p-1.5 text-center text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                layout === v ? "border-primary text-primary ring-1 ring-primary" : "text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              <span className="block rounded-lg bg-muted/60 px-1 py-0.5">
                <CategoryLayoutThumb layout={v} className="h-auto w-full" />
              </span>
              <span className={cn("truncate", layout === v ? "text-primary" : "text-foreground")}>{t(`site.home.catLayout.${v}`)}</span>
            </button>
          ))}
        </div>
      </div>
      {COLUMN_LAYOUTS.has(layout) && (
        <div className="grid gap-1.5">
          <Chips<CategoryColumns>
            label={t("site.home.columns")}
            value={columns}
            onChange={(v) => onChange({ columns: v })}
            disabled={disabled}
            options={(["auto", "3", "4", "5", "6"] as const).map((v) => ({ value: v, label: v === "auto" ? t("site.home.columnsAuto") : v }))}
          />
          <p className="text-meta text-muted-foreground">{t("site.home.columnsHint")}</p>
        </div>
      )}
      <Toggle id={`${idp}-counts`} label={t("site.home.showCounts")} hint={t("site.home.showCountsHint")} checked={showCounts} onChange={(v) => onChange({ showCounts: v })} disabled={disabled} />
    </div>
  );
}

export function UspLayoutFields({ form, onChange, errors, disabled, idp }: Props<"usp">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3">
      <Chips<UspLayout>
        label={t("site.home.layout")}
        value={form.layout}
        onChange={(layout) => onChange({ ...form, layout })}
        disabled={disabled}
        options={(["cards", "inline", "centered", "split"] as const).map((v) => ({ value: v, label: t(`site.home.uspLayout.${v}`) }))}
      />
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional placeholder={t("site.home.uspTitlePlaceholder")} value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
        <TextField id={`${idp}-text`} label={t("site.home.text")} optional value={form.text} maxLength={400} disabled={disabled} error={errors.text} onChange={(text) => onChange({ ...form, text })} />
      </div>
    </div>
  );
}

export function NewsletterLayoutFields({ form, onChange, errors, disabled }: Props<"newsletter">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3">
      <Chips<NewsletterLayout>
        label={t("site.home.layout")}
        value={form.layout}
        onChange={(layout) => onChange({ ...form, layout })}
        disabled={disabled}
        options={(["band", "split", "card", "inline"] as const).map((v) => ({ value: v, label: t(`site.home.newsletterLayout.${v}`) }))}
      />
      {form.layout === "split" && <Img label={t("site.home.image")} optional value={form.imageUrl} onChange={(imageUrl) => onChange({ ...form, imageUrl })} aspect="aspect-[4/3]" className="max-w-72" disabled={disabled} error={errors.imageUrl} />}
    </div>
  );
}

// ---------------------------------------------------------------- shelves

export function ProductTabsFields({ form, onChange, errors, disabled, idp }: Props<"product-tabs">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Chips<ShelfLayout> label={t("site.home.layout")} value={form.layout} onChange={(layout) => onChange({ ...form, layout })} options={shelfLayouts(t)} disabled={disabled} />
        <LimitField id={`${idp}-limit`} label={t("site.home.perTab")} value={form.limit} onChange={(limit) => onChange({ ...form, limit })} max={SECTION_LIST_LIMITS.shelfLimit} error={errors.limit} disabled={disabled} />
      </div>
      <Repeat<TabForm>
        items={form.tabs}
        onChange={(tabs) => onChange({ ...form, tabs })}
        make={() => emptyTab("new")}
        max={SECTION_LIST_LIMITS.tabs}
        title={(i) => t("site.home.tabN", { n: i + 1 })}
        addLabel={t("site.home.addTab")}
        disabled={disabled}
        error={errors.tabs}
      >
        {(tab, set, i) => (
          <>
            <Chips<TabSource>
              label={t("site.home.tabSource")}
              value={tab.source}
              onChange={(source) => set({ source, ...(source !== "collection" ? { collectionSlug: "" } : {}) })}
              disabled={disabled}
              options={(["new", "bestsellers", "sale", "collection"] as const).map((v) => ({ value: v, label: t(`site.home.tabSource.${v}`) }))}
            />
            <div className="grid items-start gap-3 sm:grid-cols-2">
              <TextField id={`${idp}-tl${i}`} label={t("site.home.tabLabel")} optional hint={t("site.home.tabLabelHint")} value={tab.label} maxLength={60} disabled={disabled} error={errors[`tabs.${i}.label`]} onChange={(label) => set({ label })} />
              {tab.source === "collection" && (
                <div className="grid content-start gap-2">
                  <Label htmlFor={`${idp}-tc${i}`}>{t("site.home.collection")}</Label>
                  <SlugSelect id={`${idp}-tc${i}`} type="collection" value={tab.collectionSlug} invalid={!!errors[`tabs.${i}.collectionSlug`]} disabled={disabled} onChange={(collectionSlug) => set({ collectionSlug })} />
                  <FieldError code={errors[`tabs.${i}.collectionSlug`]} />
                </div>
              )}
            </div>
          </>
        )}
      </Repeat>
      <p className="text-meta text-muted-foreground">{t("site.home.bestsellersHint")}</p>
    </div>
  );
}

export function DealFields({ form, onChange, errors, disabled, idp }: Props<"deal">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <div className="grid content-start gap-2">
        <Label>{t("site.home.dealProduct")}</Label>
        <ProductPicker ids={form.productId ? [form.productId] : []} onChange={(ids) => onChange({ ...form, productId: ids[ids.length - 1] ?? "" })} max={1} disabled={disabled} idPrefix={idp} />
        <FieldError code={errors.productId} />
      </div>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextField id={`${idp}-title`} label={t("site.home.eyebrow")} optional placeholder={t("site.home.dealTitlePlaceholder")} value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
        <TextField id={`${idp}-end`} type="datetime-local" label={t("site.home.endsAt")} optional hint={t("site.home.dealEndsHint")} value={form.endsAt} disabled={disabled} error={errors.endsAt} onChange={(endsAt) => onChange({ ...form, endsAt })} />
      </div>
      <Area id={`${idp}-x`} label={t("site.home.text")} optional value={form.text} maxLength={400} rows={2} disabled={disabled} error={errors.text} onChange={(text) => onChange({ ...form, text })} />
    </div>
  );
}

/** Picture + dots: click the picture to drop a dot there, then pick its product (x / y can be typed too). */
export function ShopTheLookFields({ form, onChange, errors, disabled, idp }: Props<"shop-the-look">) {
  const { t } = useI18n();
  const src = absoluteUrl(form.imageUrl || null);
  const full = form.hotspots.length >= SECTION_LIST_LIMITS.hotspots;
  const place = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || full) return;
    const r = e.currentTarget.getBoundingClientRect();
    const pct = (v: number) => String(Math.round(Math.max(0, Math.min(100, v)) * 10) / 10);
    onChange({ ...form, hotspots: [...form.hotspots, { x: pct(((e.clientX - r.left) / r.width) * 100), y: pct(((e.clientY - r.top) / r.height) * 100), productId: "" }] });
  };
  return (
    <div className="grid gap-4">
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
        <TextField id={`${idp}-alt`} label={t("site.media.alt")} hint={t("site.media.altHint")} value={form.alt} maxLength={200} disabled={disabled} error={errors.alt} onChange={(alt) => onChange({ ...form, alt })} />
      </div>
      <Area id={`${idp}-x`} label={t("site.home.text")} optional value={form.text} maxLength={400} rows={2} disabled={disabled} error={errors.text} onChange={(text) => onChange({ ...form, text })} />
      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Img label={t("site.home.image")} value={form.imageUrl} onChange={(imageUrl) => onChange({ ...form, imageUrl })} aspect="aspect-[4/3]" disabled={disabled} error={errors.imageUrl} />
        {src && (
          <div className="grid content-start gap-2">
            <Label>{t("site.home.placeDots")}</Label>
            <button
              type="button"
              onClick={place}
              disabled={disabled || full}
              aria-label={t("site.home.placeDotsHint")}
              className="relative block w-full cursor-crosshair overflow-hidden rounded-xl border outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- editor */}
              <img src={src} alt="" className="block h-auto w-full" />
              {form.hotspots.map((h, i) => (
                <span
                  key={i}
                  aria-hidden
                  className="absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-xs font-bold text-neutral-900 shadow ring-2 ring-primary"
                  style={{ left: `${Number(h.x) || 0}%`, top: `${Number(h.y) || 0}%` }}
                >
                  {i + 1}
                </span>
              ))}
            </button>
            <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
              <CrosshairIcon className="size-3.5" aria-hidden /> {t("site.home.placeDotsHint")}
            </p>
          </div>
        )}
      </div>
      <Repeat<HotspotForm>
        items={form.hotspots}
        onChange={(hotspots) => onChange({ ...form, hotspots })}
        make={() => ({ x: "50", y: "50", productId: "" })}
        max={SECTION_LIST_LIMITS.hotspots}
        title={(i) => t("site.home.dotN", { n: i + 1 })}
        addLabel={t("site.home.addDot")}
        disabled={disabled}
        error={errors.hotspots}
      >
        {(h, set, i) => (
          <>
            <ProductPicker ids={h.productId ? [h.productId] : []} onChange={(ids) => set({ productId: ids[ids.length - 1] ?? "" })} max={1} disabled={disabled} idPrefix={`${idp}-h${i}`} />
            <FieldError code={errors[`hotspots.${i}.productId`]} />
            <div className="grid grid-cols-2 items-start gap-3 sm:max-w-sm">
              <TextField id={`${idp}-hx${i}`} label={t("site.home.dotX")} inputMode="decimal" value={h.x} disabled={disabled} error={errors[`hotspots.${i}.x`]} onChange={(x) => set({ x: x.replace(/[^\d.]/g, "").slice(0, 5) })} />
              <TextField id={`${idp}-hy${i}`} label={t("site.home.dotY")} inputMode="decimal" value={h.y} disabled={disabled} error={errors[`hotspots.${i}.y`]} onChange={(y) => set({ y: y.replace(/[^\d.]/g, "").slice(0, 5) })} />
            </div>
          </>
        )}
      </Repeat>
    </div>
  );
}

export function ShelfFields({ form, onChange, errors, disabled, idp, hint }: Props<"bestsellers"> & { hint: string }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Chips<ShelfLayout> label={t("site.home.layout")} value={form.layout} onChange={(layout) => onChange({ ...form, layout })} options={shelfLayouts(t)} disabled={disabled} />
        <LimitField id={`${idp}-limit`} value={form.limit} onChange={(limit) => onChange({ ...form, limit })} max={SECTION_LIST_LIMITS.shelfLimit} error={errors.limit} disabled={disabled} />
      </div>
      <p className="text-meta text-muted-foreground">{hint}</p>
    </div>
  );
}

export function BestsellersFields(p: Props<"bestsellers">) {
  const { t } = useI18n();
  return <ShelfFields {...p} hint={t("site.home.bestsellersHint")} />;
}

export function RecommendedFields(p: Props<"recommended">) {
  const { t } = useI18n();
  return <ShelfFields {...(p as unknown as Props<"bestsellers">)} hint={t("site.home.recommendedHint")} />;
}

export function RecentlyViewedFields({ form, onChange, errors, disabled, idp }: Props<"recently-viewed">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional placeholder={t("site.home.recentPlaceholder")} value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
      <p className="text-meta text-muted-foreground">{t("site.home.recentHint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------- story and proof

function TitleText({ form, onChange, errors, disabled, idp }: { form: { title: string; text: string }; onChange: (p: { title?: string; text?: string }) => void; errors: Record<string, string>; disabled?: boolean; idp: string }) {
  const { t } = useI18n();
  return (
    <>
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ title })} />
      <Area id={`${idp}-text`} label={t("site.home.text")} optional value={form.text} maxLength={400} rows={2} disabled={disabled} error={errors.text} onChange={(text) => onChange({ text })} />
    </>
  );
}

export function StatsFields({ form, onChange, errors, disabled, idp }: Props<"stats">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TitleText form={form} onChange={(p) => onChange({ ...form, ...p })} errors={errors} disabled={disabled} idp={idp} />
      <Repeat<StatForm>
        items={form.items}
        onChange={(items) => onChange({ ...form, items })}
        make={emptyStat}
        max={SECTION_LIST_LIMITS.stats}
        title={(i) => t("site.home.statN", { n: i + 1 })}
        addLabel={t("site.home.addStat")}
        disabled={disabled}
        error={errors.items}
      >
        {(it, set, i) => (
          <div className="grid items-start gap-3 sm:grid-cols-[6rem_minmax(0,1fr)_6rem]">
            <TextField id={`${idp}-sp${i}`} label={t("site.home.statPrefix")} optional placeholder="₹" value={it.prefix} maxLength={8} disabled={disabled} error={errors[`items.${i}.prefix`]} onChange={(prefix) => set({ prefix })} />
            <TextField id={`${idp}-sv${i}`} label={t("site.home.statValue")} inputMode="decimal" placeholder="10000" value={it.value} disabled={disabled} error={errors[`items.${i}.value`]} onChange={(value) => set({ value: value.replace(/[^\d.,]/g, "").slice(0, 13) })} />
            <TextField id={`${idp}-ss${i}`} label={t("site.home.statSuffix")} optional placeholder="+" value={it.suffix} maxLength={12} disabled={disabled} error={errors[`items.${i}.suffix`]} onChange={(suffix) => set({ suffix })} />
            <TextField id={`${idp}-sl${i}`} label={t("site.home.statLabel")} className="sm:col-span-3" value={it.label} maxLength={60} disabled={disabled} error={errors[`items.${i}.label`]} onChange={(label) => set({ label })} />
          </div>
        )}
      </Repeat>
    </div>
  );
}

export function TimelineFields({ form, onChange, errors, disabled, idp }: Props<"timeline">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TitleText form={form} onChange={(p) => onChange({ ...form, ...p })} errors={errors} disabled={disabled} idp={idp} />
      <Repeat<MilestoneForm>
        items={form.items}
        onChange={(items) => onChange({ ...form, items })}
        make={emptyMilestone}
        max={SECTION_LIST_LIMITS.timeline}
        title={(i) => t("site.home.milestoneN", { n: i + 1 })}
        addLabel={t("site.home.addMilestone")}
        disabled={disabled}
        error={errors.items}
      >
        {(it, set, i) => (
          <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1fr)_9rem]">
            <div className="grid gap-3">
              <div className="grid items-start gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                <TextField id={`${idp}-mw${i}`} label={t("site.home.when")} placeholder="1985" value={it.when} maxLength={40} disabled={disabled} error={errors[`items.${i}.when`]} onChange={(when) => set({ when })} />
                <TextField id={`${idp}-mt${i}`} label={t("site.home.heading")} value={it.title} maxLength={120} disabled={disabled} error={errors[`items.${i}.title`]} onChange={(title) => set({ title })} />
              </div>
              <Area id={`${idp}-mx${i}`} label={t("site.home.text")} optional value={it.text} maxLength={600} rows={2} disabled={disabled} error={errors[`items.${i}.text`]} onChange={(text) => set({ text })} />
            </div>
            <Img label={t("site.home.photo")} optional value={it.imageUrl} onChange={(imageUrl) => set({ imageUrl })} aspect="aspect-[16/10]" disabled={disabled} error={errors[`items.${i}.imageUrl`]} />
          </div>
        )}
      </Repeat>
    </div>
  );
}

export function TeamFields({ form, onChange, errors, disabled, idp }: Props<"team">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TitleText form={form} onChange={(p) => onChange({ ...form, ...p })} errors={errors} disabled={disabled} idp={idp} />
      <Repeat<MemberForm>
        items={form.members}
        onChange={(members) => onChange({ ...form, members })}
        make={emptyMember}
        max={SECTION_LIST_LIMITS.team}
        title={(i) => t("site.home.memberN", { n: i + 1 })}
        addLabel={t("site.home.addMember")}
        disabled={disabled}
        error={errors.members}
      >
        {(m, set, i) => (
          <div className="grid items-start gap-3 md:grid-cols-[8rem_minmax(0,1fr)]">
            <Img label={t("site.home.photo")} optional value={m.photoUrl} onChange={(photoUrl) => set({ photoUrl })} aspect="aspect-[4/5]" disabled={disabled} error={errors[`members.${i}.photoUrl`]} />
            <div className="grid gap-3">
              <div className="grid items-start gap-3 sm:grid-cols-2">
                <TextField id={`${idp}-mn${i}`} label={t("site.home.memberName")} value={m.name} maxLength={80} disabled={disabled} error={errors[`members.${i}.name`]} onChange={(name) => set({ name })} />
                <TextField id={`${idp}-mr${i}`} label={t("site.home.memberRole")} optional value={m.role} maxLength={80} disabled={disabled} error={errors[`members.${i}.role`]} onChange={(role) => set({ role })} />
              </div>
              <Area id={`${idp}-mb${i}`} label={t("site.home.memberBio")} optional value={m.bio} maxLength={300} rows={2} disabled={disabled} error={errors[`members.${i}.bio`]} onChange={(bio) => set({ bio })} />
              <div className="grid items-start gap-3 sm:grid-cols-2">
                {(["instagram", "facebook", "linkedin", "website"] as const).map((k) => (
                  <TextField key={k} id={`${idp}-m${k}${i}`} label={t(`site.home.social.${k}`)} optional placeholder="https://…" value={m[k]} disabled={disabled} error={errors[`members.${i}.${k}`]} onChange={(v) => set({ [k]: v } as Partial<MemberForm>)} />
                ))}
              </div>
            </div>
          </div>
        )}
      </Repeat>
    </div>
  );
}

export function PricingFields({ form, onChange, errors, disabled, idp }: Props<"pricing-table">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TitleText form={form} onChange={(p) => onChange({ ...form, ...p })} errors={errors} disabled={disabled} idp={idp} />
      <Repeat<PlanForm>
        items={form.plans}
        onChange={(plans) => onChange({ ...form, plans })}
        make={emptyPlan}
        max={SECTION_LIST_LIMITS.plans}
        title={(i) => t("site.home.planN", { n: i + 1 })}
        addLabel={t("site.home.addPlan")}
        disabled={disabled}
        error={errors.plans}
      >
        {(p, set, i) => {
          const featureError = Object.entries(errors).find(([k]) => k.startsWith(`plans.${i}.features`))?.[1];
          return (
            <>
              <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
                <TextField id={`${idp}-pn${i}`} label={t("site.home.planName")} value={p.name} maxLength={60} disabled={disabled} error={errors[`plans.${i}.name`]} onChange={(name) => set({ name })} />
                <TextField id={`${idp}-pp${i}`} label={t("site.home.planPrice")} optional inputMode="decimal" placeholder="1500" value={p.price} disabled={disabled} error={errors[`plans.${i}.price`]} onChange={(price) => set({ price })} />
                <TextField id={`${idp}-pd${i}`} label={t("site.home.planPeriod")} optional placeholder={t("site.home.planPeriodPlaceholder")} value={p.period} maxLength={30} disabled={disabled} error={errors[`plans.${i}.period`]} onChange={(period) => set({ period })} />
              </div>
              <TextField id={`${idp}-pde${i}`} label={t("site.home.planDescription")} optional value={p.description} maxLength={200} disabled={disabled} error={errors[`plans.${i}.description`]} onChange={(description) => set({ description })} />
              <div className="grid content-start gap-2">
                <Label htmlFor={`${idp}-pf${i}`}>
                  {t("site.home.planFeatures")}
                  <Optional />
                </Label>
                <Textarea id={`${idp}-pf${i}`} rows={4} value={p.features} disabled={disabled} onChange={(e) => set({ features: e.target.value })} aria-invalid={!!featureError} className={cn(featureError && "border-destructive")} />
                <p className="text-meta text-muted-foreground">{t("site.home.planFeaturesHint", { max: SECTION_LIST_LIMITS.planFeatures })}</p>
                <FieldError code={featureError} />
              </div>
              <div className="grid items-start gap-3 sm:grid-cols-2">
                <Toggle id={`${idp}-ph${i}`} label={t("site.home.planHighlight")} hint={t("site.home.planHighlightHint")} checked={p.highlight} onChange={(highlight) => onChange({ ...form, plans: form.plans.map((x, j) => ({ ...x, highlight: j === i ? highlight : highlight ? false : x.highlight })) })} disabled={disabled} />
                <TextField id={`${idp}-pb${i}`} label={t("site.home.planBadge")} optional placeholder={t("site.home.planBadgePlaceholder")} value={p.badge} maxLength={30} disabled={disabled} error={errors[`plans.${i}.badge`]} onChange={(badge) => set({ badge })} />
              </div>
              <CtaFields idp={`${idp}-p${i}`} label={p.ctaLabel} href={p.ctaHref} onLabel={(ctaLabel) => set({ ctaLabel })} onHref={(ctaHref) => set({ ctaHref })} errors={errors} prefix={`plans.${i}.`} disabled={disabled} placeholder="/book" />
            </>
          );
        }}
      </Repeat>
      <FieldError code={errors.plans} />
    </div>
  );
}

export function BlogPostsFields({ form, onChange, errors, disabled, idp }: Props<"blog-posts">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <LimitField id={`${idp}-limit`} value={form.limit} onChange={(limit) => onChange({ ...form, limit })} max={SECTION_LIST_LIMITS.blogLimit} error={errors.limit} disabled={disabled} />
        <TextField id={`${idp}-tag`} label={t("site.home.blogTag")} optional hint={t("site.home.blogTagHint")} value={form.tag} maxLength={40} disabled={disabled} error={errors.tag} onChange={(tag) => onChange({ ...form, tag: tag.toLowerCase() })} />
      </div>
      <p className="text-meta text-muted-foreground">{t("site.home.blogHint")}</p>
    </div>
  );
}

export function ReviewsSummaryFields({ form, onChange, errors, disabled, idp }: Props<"reviews-summary">) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <TextField id={`${idp}-title`} label={t("site.home.sectionTitle")} optional value={form.title} maxLength={120} disabled={disabled} error={errors.title} onChange={(title) => onChange({ ...form, title })} />
      <LimitField id={`${idp}-limit`} value={form.limit} onChange={(limit) => onChange({ ...form, limit })} max={SECTION_LIST_LIMITS.reviewsLimit} error={errors.limit} disabled={disabled} />
      <p className="text-meta text-muted-foreground">{t("site.home.reviewsHint")}</p>
    </div>
  );
}
