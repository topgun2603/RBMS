"use client";

import * as React from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { exclusiveOf } from "@srirealtime/gst";
import { BadgePercentIcon, EyeIcon, FileTextIcon, ImagesIcon, PencilIcon, PlusIcon, SearchIcon, TagsIcon, Trash2Icon } from "lucide-react";
import { Badge, Button, cn, Input, InputGroup, InputGroupAddon, InputGroupInput, Label, Switch, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from "@srirealtime/ui";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage, useI18n } from "@srirealtime/web";
import { CategorySelect } from "../category-select";
import { GstRateSelect, MoneyInput, Optional, Section } from "../bits";
import { ImageManager } from "../image-manager";
import { Markdown } from "../markdown";
import { ChipsInput } from "../tag-input";
import { discountPct, money, rupeesToPaise, slugify } from "../../lib/format";
import type { ProductFormValues } from "./model";
import { IdentifiersFields } from "./sections-variants";

type Ctx = { canManage: boolean; variantsOn: boolean; multi: boolean; isNew: boolean };

// ---------------------------------------------------------------- basics

export function BasicsSection() {
  const { t } = useI18n();
  const form = useFormContext<ProductFormValues>();
  const [tab, setTab] = React.useState("write");
  const description = useWatch({ control: form.control, name: "description" });
  return (
    <Section id="basics" icon={FileTextIcon} title={t("commerce.editor.basics")} description={t("commerce.editor.basicsHint")}>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("commerce.editor.name")}</FormLabel>
            <FormControl>
              <Input className="text-base" autoComplete="off" placeholder={t("commerce.editor.namePlaceholder")} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <Tabs value={tab} onValueChange={setTab} className="gap-2">
              <div className="flex items-center justify-between gap-2">
                <FormLabel>
                  {t("commerce.editor.description")}
                  <Optional />
                </FormLabel>
                <TabsList className="h-8">
                  <TabsTrigger value="write" className="h-6 px-2 text-xs">
                    <PencilIcon className="size-3" /> {t("commerce.editor.write")}
                  </TabsTrigger>
                  <TabsTrigger value="preview" className="h-6 px-2 text-xs">
                    <EyeIcon className="size-3" /> {t("commerce.editor.preview")}
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="write" className="mt-0">
                <FormControl>
                  <Textarea rows={7} className="min-h-40 font-mono text-sm leading-relaxed" placeholder={t("commerce.editor.descriptionPlaceholder")} {...field} />
                </FormControl>
              </TabsContent>
              <TabsContent value="preview" className="mt-0">
                <div className="min-h-40 rounded-md border bg-muted/20 px-4 py-3">
                  {description.trim() ? <Markdown source={description} /> : <p className="text-sm text-muted-foreground">{t("commerce.editor.nothingToPreview")}</p>}
                </div>
              </TabsContent>
            </Tabs>
            <FormDescription>{t("commerce.editor.markdownHint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="categoryId"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="product-category">{t("commerce.editor.category")}</FormLabel>
              <CategorySelect id="product-category" value={field.value} onChange={field.onChange} className="w-full" aria-label={t("commerce.editor.category")} />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="brand"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t("commerce.editor.brand")}
                <Optional />
              </FormLabel>
              <FormControl>
                <Input autoComplete="off" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- media

export function MediaSection() {
  const { t } = useI18n();
  const form = useFormContext<ProductFormValues>();
  return (
    <Section id="media" icon={ImagesIcon} title={t("commerce.editor.media")} description={t("commerce.editor.mediaHint")}>
      <FormField
        control={form.control}
        name="images"
        render={({ field }) => <ImageManager value={field.value.map((i) => ({ url: i.url, alt: i.alt ?? "" }))} onChange={field.onChange} />}
      />
    </Section>
  );
}

// ---------------------------------------------------------------- pricing & tax

export function PricingSection({ canManage, multi }: Ctx) {
  const { t } = useI18n();
  const form = useFormContext<ProductFormValues>();
  const [gstRate, taxInclusive, first] = useWatch({ control: form.control, name: ["gstRate", "taxInclusive", "variants.0"] });

  return (
    <Section id="pricing" icon={BadgePercentIcon} title={t("commerce.editor.pricing")} description={multi ? t("commerce.editor.pricingMultiHint") : t("commerce.editor.pricingHint")}>
      {!multi && (
        <div className="grid items-start gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="variants.0.price"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("commerce.editor.price")}</FormLabel>
                <FormControl>
                  <MoneyInput className="text-base font-semibold" disabled={!canManage} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="variants.0.mrp"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t("commerce.editor.mrp")}
                  <Optional />
                </FormLabel>
                <FormControl>
                  <MoneyInput disabled={!canManage} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {canManage && (
            <FormField
              control={form.control}
              name="variants.0.cost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("commerce.editor.cost")}
                    <Optional />
                  </FormLabel>
                  <FormControl>
                    <MoneyInput {...field} />
                  </FormControl>
                  <FormDescription>{t("commerce.editor.costHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>
      )}
      {!multi && <IdentifiersFields />}

      <div className="grid items-start gap-4 sm:grid-cols-3">
        <FormField
          control={form.control}
          name="gstRate"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="product-gst-rate">{t("commerce.editor.gstRate")}</FormLabel>
              <GstRateSelect id="product-gst-rate" value={field.value} onChange={field.onChange} className="w-full" aria-label={t("commerce.editor.gstRate")} />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="hsn"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t("commerce.editor.hsn")}
                <Optional />
              </FormLabel>
              <FormControl>
                <Input inputMode="numeric" maxLength={8} className="font-mono" autoComplete="off" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="unit"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("commerce.editor.unit")}</FormLabel>
              <FormControl>
                <Input list="commerce-units" autoComplete="off" {...field} />
              </FormControl>
              <datalist id="commerce-units">
                {["pcs", "nos", "pair", "set", "box", "pack", "kg", "g", "m", "l", "ml", "dozen"].map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="taxInclusive"
        render={({ field }) => (
          <FormItem className="flex flex-row items-center justify-between gap-4 rounded-xl border bg-muted/20 px-4 py-3">
            <div className="space-y-0.5">
              <FormLabel htmlFor="tax-inclusive" className="text-sm">
                {t("commerce.editor.taxInclusive")}
              </FormLabel>
              <FormDescription>{t("commerce.editor.taxInclusiveHint")}</FormDescription>
            </div>
            <FormControl>
              <Switch id="tax-inclusive" checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          </FormItem>
        )}
      />

      <PriceBreakdown price={rupeesToPaise(first?.price ?? "")} mrp={rupeesToPaise(first?.mrp ?? "")} cost={canManage ? rupeesToPaise(first?.cost ?? "") : null} gstRate={Number(gstRate)} inclusive={taxInclusive} label={multi ? first?.title || undefined : undefined} />
    </Section>
  );
}

/** Live GST breakdown: what the customer pays, taxable value, CGST + SGST, and margin when the cost is known. */
export function PriceBreakdown({
  price,
  mrp,
  cost,
  gstRate,
  inclusive,
  label,
}: {
  price: number | null;
  mrp: number | null;
  cost: number | null;
  gstRate: number;
  inclusive: boolean;
  label?: string;
}) {
  const { t } = useI18n();
  if (price === null) {
    return <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">{t("commerce.editor.breakdownEmpty")}</p>;
  }
  const taxable = exclusiveOf(price, gstRate, inclusive);
  const gst = inclusive ? price - taxable : Math.round((price * gstRate) / 100);
  const pays = taxable + gst;
  const half = Math.round(gst / 2);
  const margin = cost !== null ? taxable - cost : null;
  const off = discountPct(price, mrp);
  return (
    <div className="overflow-hidden rounded-xl border bg-gradient-to-br from-primary/[0.06] to-transparent" aria-live="polite">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("commerce.editor.breakdown")}</p>
        {label && <Badge variant="secondary">{label}</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">{t("commerce.editor.customerPays")}</dt>
          <dd className="font-heading text-lg font-bold tabular-nums">{money(pays)}</dd>
          {off !== null && <dd className="text-xs font-medium text-success-ink">{t("commerce.editor.offMrp", { pct: off })}</dd>}
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("commerce.editor.taxable")}</dt>
          <dd className="font-semibold tabular-nums">{money(taxable)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("commerce.editor.gstAmount", { rate: gstRate })}</dt>
          <dd className="font-semibold tabular-nums">{money(gst)}</dd>
          {gst > 0 && <dd className="text-xs text-muted-foreground tabular-nums">CGST {money(half)} + SGST {money(gst - half)}</dd>}
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("commerce.editor.margin")}</dt>
          {margin === null ? (
            <dd className="text-xs text-muted-foreground">{t("commerce.editor.marginUnknown")}</dd>
          ) : (
            <dd className={cn("font-semibold tabular-nums", margin < 0 ? "text-danger-ink" : "text-success-ink")}>
              {money(margin)}
              {taxable > 0 && <span className="ml-1 text-xs font-normal">({Math.round((margin / taxable) * 100)}%)</span>}
            </dd>
          )}
        </div>
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------- organisation

const ATTRIBUTE_SUGGESTIONS = ["Fabric", "Material", "Colour", "Pattern", "Fit", "Occasion", "Care", "Origin", "Warranty"];

export function OrganisationSection() {
  const { t } = useI18n();
  const form = useFormContext<ProductFormValues>();
  const attrs = useFieldArray({ control: form.control, name: "attributes" });
  return (
    <Section id="organisation" icon={TagsIcon} title={t("commerce.editor.organisation")} description={t("commerce.editor.organisationHint")}>
      <FormField
        control={form.control}
        name="tags"
        render={({ field }) => (
          <FormItem>
            <FormLabel htmlFor="product-tags">{t("commerce.editor.tags")}</FormLabel>
            <ChipsInput
              id="product-tags"
              value={field.value}
              onChange={field.onChange}
              max={30}
              normalize={(s) => s.trim().toLowerCase().slice(0, 40)}
              placeholder={t("commerce.editor.tagsPlaceholder")}
            />
            <FormDescription>{t("commerce.editor.tagsHint")}</FormDescription>
          </FormItem>
        )}
      />
      <div className="grid gap-2">
        <Label>{t("commerce.editor.attributes")}</Label>
        {attrs.fields.length === 0 && <p className="text-meta text-muted-foreground">{t("commerce.editor.attributesEmpty")}</p>}
        <datalist id="commerce-attribute-names">
          {ATTRIBUTE_SUGGESTIONS.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <div className="grid gap-2">
          {attrs.fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-start gap-2">
              <FormField
                control={form.control}
                name={`attributes.${i}.key`}
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input list="commerce-attribute-names" placeholder={t("commerce.editor.attributeName")} aria-label={t("commerce.editor.attributeNameN", { n: i + 1 })} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`attributes.${i}.value`}
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input placeholder={t("commerce.editor.attributeValue")} aria-label={t("commerce.editor.attributeValueN", { n: i + 1 })} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="button" variant="ghost" size="icon" onClick={() => attrs.remove(i)} aria-label={t("commerce.editor.removeAttribute", { n: i + 1 })}>
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => attrs.append({ key: "", value: "" })} disabled={attrs.fields.length >= 50}>
          <PlusIcon /> {t("commerce.editor.addAttribute")}
        </Button>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- SEO

const stripMarkdown = (s: string) =>
  s
    .replace(/[#*`>_]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

export function SeoSection({ isNew }: Ctx) {
  const { t } = useI18n();
  const form = useFormContext<ProductFormValues>();
  const [name, slug, seoTitle, seoDescription, description] = useWatch({ control: form.control, name: ["name", "slug", "seoTitle", "seoDescription", "description"] });
  const autoSlug = slugify(name);
  const shownSlug = slug.trim() || autoSlug || "…";
  const title = (seoTitle.trim() || name.trim() || t("commerce.editor.untitled")).slice(0, 70);
  const desc = (seoDescription.trim() || stripMarkdown(description)).slice(0, 160) || t("commerce.editor.seoNoDescription");
  const host = typeof window === "undefined" ? "" : window.location.host;

  return (
    <Section id="seo" icon={SearchIcon} title={t("commerce.editor.seo")} description={t("commerce.editor.seoHint")}>
      <div className="rounded-xl border bg-card p-4 shadow-xs" aria-label={t("commerce.editor.seoPreview")}>
        <p className="mb-2 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">{t("commerce.editor.seoPreview")}</p>
        <div className="flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-muted text-xs font-bold text-primary">{host.slice(0, 1).toUpperCase() || "S"}</span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm">{host || "shop"}</p>
            <p className="mt-0.5 truncate text-meta text-muted-foreground">
              {host} › products › {shownSlug}
            </p>
          </div>
        </div>
        <p className="mt-2 line-clamp-1 text-lg leading-snug text-[#1a0dab] dark:text-[#8ab4f8]">{title}</p>
        <p className="line-clamp-2 text-sm text-muted-foreground">{desc}</p>
      </div>
      <FormField
        control={form.control}
        name="slug"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("commerce.editor.slug")}</FormLabel>
            <InputGroup>
              <InputGroupAddon>/products/</InputGroupAddon>
              <FormControl>
                <InputGroupInput
                  className="font-mono"
                  placeholder={autoSlug || "p-…"}
                  autoComplete="off"
                  {...field}
                  onChange={(e) => field.onChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                />
              </FormControl>
            </InputGroup>
            <FormDescription>{isNew ? t("commerce.editor.slugHintNew") : t("commerce.editor.slugHint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="seoTitle"
        render={({ field }) => (
          <FormItem>
            <FormLabel aside={<Counter n={field.value.length} max={70} />}>{t("commerce.editor.seoTitle")}</FormLabel>
            <FormControl>
              <Input placeholder={name || undefined} maxLength={120} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="seoDescription"
        render={({ field }) => (
          <FormItem>
            <FormLabel aside={<Counter n={field.value.length} max={160} />}>{t("commerce.editor.seoDescription")}</FormLabel>
            <FormControl>
              <Textarea rows={3} maxLength={320} placeholder={t("commerce.editor.seoDescriptionPlaceholder")} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </Section>
  );
}

function Counter({ n, max }: { n: number; max: number }) {
  return <span className={cn("text-xs tabular-nums", n > max ? "text-warning-ink" : "text-muted-foreground")}>{`${n}/${max}`}</span>;
}

export type { Ctx as SectionCtx };
