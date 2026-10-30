"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { APPAREL_FOOTWEAR_GST_RULE, exclusiveOf, gstRateAtPrice } from "@rbms/gst";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  BadgePercentIcon,
  BoxesIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  FileTextIcon,
  ImagesIcon,
  Layers3Icon,
  Loader2Icon,
  MoreVerticalIcon,
  PackageIcon,
  PackagePlusIcon,
  ReceiptIcon,
  SaveIcon,
  SearchIcon,
  StoreIcon,
  TagsIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import {
  AnimatePresence,
  Button,
  Card,
  Checkbox,
  ChipGroup,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Label,
  motion,
  toast,
} from "@rbms/ui";
import {
  api,
  ApiError,
  ConfirmDialog,
  describeError,
  Form,
  isFeatureDisabled,
  Page,
  PageHeading,
  useFeature,
  useI18n,
  useModuleHref,
  type Translator,
} from "@rbms/web";
import { ProductStatusPill, ProductThumb } from "../bits";
import { useUnsavedGuard } from "../unsaved-guard";
import { useCanManageCatalogue } from "../../lib/access";
import { comboKey, discountPct, money, parseQty, priceRange, rupeesToPaise } from "../../lib/format";
import { ck, useAdjustStock, useCategories, useCreateProduct, useDeleteProduct, useDeleteVariant, useGenerateVariants, useUpdateProduct, useUpdateVariant } from "../../lib/queries";
import { useCatalogStock } from "../../lib/stock";
import type { Channel, Product, ProductStatus } from "../../lib/types";
import {
  createPayload,
  fingerprint,
  optionsKey,
  productFormSchema,
  productPatch,
  toFormValues,
  usesVariants,
  variantPatch,
  variantToRow,
  type ProductFormValues,
} from "./model";
import { BasicsSection, MediaSection, OrganisationSection, PricingSection, SeoSection } from "./sections-basic";
import { InventorySection, VariantsSection } from "./sections-variants";

/** 403s that aren't feature switches mean the member lacks a permission (e.g. `catalogue.manage`). */
function saveError(err: unknown, t: Translator): string {
  if (err instanceof ApiError && err.status === 403 && !isFeatureDisabled(err)) return t("commerce.errors.noPermission");
  return describeError(err, t);
}

const SECTIONS = [
  { id: "basics", icon: FileTextIcon, label: "commerce.editor.basics" },
  { id: "media", icon: ImagesIcon, label: "commerce.editor.media" },
  { id: "pricing", icon: BadgePercentIcon, label: "commerce.editor.pricing" },
  { id: "variants", icon: Layers3Icon, label: "commerce.editor.variants", feature: "variants" },
  { id: "inventory", icon: BoxesIcon, label: "commerce.editor.inventory", feature: "inventory" },
  { id: "organisation", icon: TagsIcon, label: "commerce.editor.organisation" },
  { id: "seo", icon: SearchIcon, label: "commerce.editor.seo" },
] as const;

/** Which section a field path belongs to (to scroll to the first error). */
function sectionOf(path: string): string {
  if (/^(name|description|brand|categoryId)/.test(path)) return "basics";
  if (path.startsWith("images")) return "media";
  if (/^(gstRate|hsn|unit|taxInclusive)/.test(path)) return "pricing";
  if (path.startsWith("options") || /^variants\.[1-9]/.test(path)) return "variants";
  if (path.startsWith("variants.0")) return "pricing";
  if (path.startsWith("attributes") || path.startsWith("tags")) return "organisation";
  return "seo";
}

function firstErrorPath(errors: object, prefix = ""): string | null {
  for (const [k, v] of Object.entries(errors)) {
    if (!v || typeof v !== "object") continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if ("message" in v && typeof (v as { message?: unknown }).message === "string") return path;
    const inner = firstErrorPath(v as object, path);
    if (inner) return inner;
  }
  return null;
}

const countErrors = (errors: object): number =>
  Object.values(errors).reduce<number>((n, v) => {
    if (!v || typeof v !== "object") return n;
    if ("message" in v && typeof (v as { message?: unknown }).message === "string") return n + 1;
    return n + countErrors(v as object);
  }, 0);

export function ProductEditor({ product }: { product?: Product }) {
  const { t, formatDate } = useI18n();
  const href = useModuleHref();
  const qc = useQueryClient();
  const isNew = !product;
  const variantsOn = useFeature("catalogue.variants");
  const inventoryOn = useFeature("inventory");
  const canManage = useCanManageCatalogue();

  const [server, setServer] = React.useState<Product | null>(product ?? null);
  const form = useForm<ProductFormValues>({ resolver: zodResolver(productFormSchema), defaultValues: toFormValues(product), mode: "onTouched" });
  const values = useWatch({ control: form.control }) as ProductFormValues;

  const baseline = React.useMemo(() => fingerprint(toFormValues(server)), [server]);
  const openingTyped = isNew && (values.variants ?? []).some((v) => (v.openingQty ?? "").trim() !== "");
  const dirty = fingerprint(values) !== baseline || openingTyped;
  const multi = usesVariants(values);

  const create = useCreateProduct();
  const update = useUpdateProduct();
  const generate = useGenerateVariants();
  const updateVariant = useUpdateVariant();
  const deleteVariant = useDeleteVariant();
  const deleteProduct = useDeleteProduct();
  const adjust = useAdjustStock();
  const stock = useCatalogStock();
  const categories = useCategories();
  const [saving, setSaving] = React.useState(false);
  const [confirm, setConfirm] = React.useState<"archive" | "delete" | null>(null);

  const guard = useUnsavedGuard(dirty && !saving);

  /** Server copy changed (save, generate, delete variant): it becomes the new "saved" state. */
  const adopt = React.useCallback(
    (p: Product, keepEdits: boolean) => {
      setServer(p);
      qc.setQueryData(ck.product(p.id), p);
      if (!keepEdits) {
        form.reset(toFormValues(p));
        return;
      }
      // Keep what the user typed for variants that still exist; add the new ones from the server.
      const current = form.getValues("variants");
      const byId = new Map(current.filter((r) => r.id).map((r) => [r.id!, r]));
      const rows = [...p.variants].sort((a, b) => a.position - b.position).map((v) => byId.get(v.id) ?? variantToRow(v));
      form.setValue("variants", rows, { shouldDirty: true });
      form.setValue(
        "options",
        p.options.map((o) => ({ name: o.name, values: [...o.values] })),
        { shouldDirty: true },
      );
    },
    [form, qc],
  );

  const onGenerate = React.useCallback(
    async (options: ProductFormValues["options"]) => {
      if (!server) return;
      try {
        const before = server.variants.length;
        const p = await generate.mutateAsync({ id: server.id, options: options.map((o) => ({ name: o.name.trim(), values: o.values })) });
        adopt(p, true);
        toast.success(t("commerce.variants.generatedServer", { count: p.variants.length - before }));
      } catch (err) {
        toast.error(saveError(err, t));
      }
    },
    [server, generate, adopt, t],
  );

  const onDeleteVariant = React.useCallback(
    async (variantId: string) => {
      if (!server) return;
      await deleteVariant.mutateAsync(variantId);
      const next = { ...server, variants: server.variants.filter((v) => v.id !== variantId) };
      setServer(next);
      qc.setQueryData(ck.product(next.id), next);
      form.setValue(
        "variants",
        form.getValues("variants").filter((r) => r.id !== variantId),
        { shouldDirty: true },
      );
    },
    [server, deleteVariant, form, qc],
  );

  const saveOpeningStock = async (p: Product, v: ProductFormValues) => {
    if (!inventoryOn) return;
    const multiRows = usesVariants(v) && variantsOn;
    const jobs: Promise<unknown>[] = [];
    v.variants.forEach((row, i) => {
      const n = parseQty(row.openingQty);
      if (n === null || n <= 0) return;
      const target = multiRows ? p.variants.find((x) => comboKey(x.optionValues) === row.key) : i === 0 ? p.variants[0] : undefined;
      if (target) jobs.push(adjust.mutateAsync({ itemId: target.id, body: { mode: "set", qty: n, note: t("commerce.editor.openingNote") } }));
    });
    if (jobs.length === 0) return;
    const results = await Promise.allSettled(jobs);
    if (results.some((r) => r.status === "rejected")) toast.warning(t("commerce.editor.openingFailed"));
  };

  const onValid = async (v: ProductFormValues) => {
    setSaving(true);
    const tid = toast.loading(isNew ? t("commerce.editor.creating") : t("commerce.editor.saving"));
    try {
      if (!server) {
        const p = await create.mutateAsync(createPayload(v, { variantsOn, includeCost: canManage }));
        await saveOpeningStock(p, v);
        toast.success(t("commerce.editor.created", { name: p.name }), { id: tid });
        guard.leave(href(`products/${p.id}`), { replace: true });
        return;
      }

      let current = server;
      const failures: string[] = [];
      // 1. Options changed in the builder: apply them (creates the missing combinations, keeps the rest).
      if (variantsOn && v.options.length > 0 && optionsKey(v.options) !== optionsKey(toFormValues(server).options)) {
        current = await generate.mutateAsync({ id: server.id, options: v.options.map((o) => ({ name: o.name.trim(), values: o.values })) });
      }
      // 2. Product fields.
      const patch = productPatch(v, current);
      if (Object.keys(patch).length > 0) current = await update.mutateAsync({ id: server.id, body: patch });
      // 3. Variants that changed.
      const rows = v.variants.filter((r) => r.id);
      for (const [i, row] of rows.entries()) {
        const sv = current.variants.find((x) => x.id === row.id);
        if (!sv) continue;
        const body = variantPatch(row, sv, i, v.options, canManage);
        if (Object.keys(body).length === 0) continue;
        try {
          if (variantsOn) {
            await updateVariant.mutateAsync({ id: sv.id, body });
          } else {
            // Variant writes need "catalogue.variants". A simple product's price still saves through the billing
            // items facade (rate is GST-exclusive; the API converts it back for tax-inclusive products).
            const { price, ...rest } = body;
            // A price-band product converts at the band of this price (the API grosses up at the band of the rate).
            const rate = v.gstBand ? gstRateAtPrice(APPAREL_FOOTWEAR_GST_RULE, price ?? 0, v.taxInclusive) : Number(v.gstRate);
            if (price !== undefined) await api.patch(`/invoices/items/${sv.id}`, { rate: exclusiveOf(price, rate, v.taxInclusive) });
            if (Object.keys(rest).length > 0) failures.push(t("commerce.editor.needsVariants"));
          }
        } catch (err) {
          failures.push(`${row.title || v.name}: ${saveError(err, t)}`);
        }
      }
      const fresh = await api.get<Product>(`/catalog/products/${server.id}`);
      adopt(fresh, false);
      void qc.invalidateQueries({ queryKey: ["catalog", "products"] });
      void qc.invalidateQueries({ queryKey: ck.counts });
      if (failures.length > 0) toast.warning(t("commerce.editor.savedPartly", { count: failures.length }), { id: tid, description: failures.slice(0, 3).join("\n") });
      else toast.success(t("commerce.editor.saved"), { id: tid });
    } catch (err) {
      toast.error(saveError(err, t), { id: tid });
    } finally {
      setSaving(false);
    }
  };

  const onInvalid = (errors: object) => {
    const n = countErrors(errors);
    toast.error(t("commerce.editor.fixErrors", { count: n }));
    const path = firstErrorPath(errors);
    if (path) document.getElementById(sectionOf(path))?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const submit = form.handleSubmit(onValid, onInvalid);

  // Ctrl/⌘ + S saves.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!saving) void submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, saving]);

  const errorCount = countErrors(form.formState.errors);
  const ctx = { canManage, variantsOn, multi, isNew };
  const sections = SECTIONS.filter((s) => !("feature" in s) || (s.feature === "variants" ? variantsOn || multi : inventoryOn));

  const archive = async () => {
    if (!server) return;
    try {
      const p = await update.mutateAsync({ id: server.id, body: { status: "archived" } });
      adopt(p, false);
      toast.success(t("commerce.editor.archived"));
    } catch (err) {
      toast.error(saveError(err, t));
      throw err;
    }
  };
  const remove = async () => {
    if (!server) return;
    try {
      await deleteProduct.mutateAsync(server.id);
      toast.success(t("commerce.editor.deleted", { name: server.name }));
      guard.leave(href("products"), { replace: true });
    } catch (err) {
      toast.error(saveError(err, t));
      throw err;
    }
  };

  const category = categories.data?.find((c) => c.id === values.categoryId);
  const prices = (values.variants ?? []).map((r) => rupeesToPaise(r.price)).filter((n): n is number => n !== null);
  const firstMrp = rupeesToPaise(values.variants?.[0]?.mrp ?? "");

  return (
    <Page className="pb-0">
      <PageHeading
        back={{ href: "products", label: t("commerce.nav.products") }}
        icon={isNew ? PackagePlusIcon : PackageIcon}
        title={isNew ? t("commerce.editor.newTitle") : server?.name}
        description={
          server ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <ProductStatusPill status={server.status} />
              <span>{t("commerce.editor.lastUpdated", { date: formatDate(server.updatedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })}</span>
            </span>
          ) : (
            t("commerce.editor.newSubtitle")
          )
        }
        actions={
          server && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-lg" aria-label={t("commerce.common.more")}>
                  <MoreVerticalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {server.status !== "archived" && (
                  <DropdownMenuItem className="h-10" onSelect={() => setConfirm("archive")}>
                    <ArchiveIcon /> {t("commerce.products.archive")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => setConfirm("delete")}>
                  <Trash2Icon /> {t("commerce.editor.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />

      <Form {...form}>
        <form onSubmit={submit} noValidate aria-label={isNew ? t("commerce.editor.newTitle") : t("commerce.editor.editTitle")}>
          <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
              <BasicsSection productId={product?.id} />
              <MediaSection productId={product?.id} name={product?.name} />
              <PricingSection {...ctx} />
              <VariantsSection
                canManage={canManage}
                variantsOn={variantsOn}
                isNew={isNew}
                savedOptionsKey={optionsKey(toFormValues(server).options)}
                onGenerate={isNew ? undefined : onGenerate}
                onDeleteVariant={isNew ? undefined : onDeleteVariant}
              />
              {inventoryOn && <InventorySection isNew={isNew} stock={stock.byVariant} stockLoading={stock.loading} unit={values.unit || "pcs"} />}
              <OrganisationSection />
              <SeoSection {...ctx} />
            </div>

            {/* Side column: status, channels, preview, jump links */}
            <aside className="order-first grid gap-4 lg:sticky lg:top-20 lg:order-none" aria-label={t("commerce.editor.sideLabel")}>
              <Card className="p-card">
                <div className="grid gap-2">
                  <p className="text-sm font-semibold">{t("commerce.editor.status")}</p>
                  <ChipGroup<ProductStatus>
                    value={values.status}
                    onChange={(s) => form.setValue("status", s, { shouldDirty: true })}
                    size="sm"
                    aria-label={t("commerce.editor.status")}
                    options={[
                      { value: "active", label: <><CheckCircle2Icon className="size-3.5" /> {t("commerce.status.active")}</> },
                      { value: "draft", label: <><CircleDotIcon className="size-3.5" /> {t("commerce.status.draft")}</> },
                      ...(values.status === "archived" || server?.status === "archived" ? [{ value: "archived" as const, label: t("commerce.status.archived") }] : []),
                    ]}
                  />
                  <p className="text-meta text-muted-foreground">{t(`commerce.editor.statusHint.${values.status}`)}</p>
                </div>
                <div className="grid gap-2 border-t pt-3">
                  <p className="text-sm font-semibold">{t("commerce.editor.channels")}</p>
                  {(["store", "billing"] as const).map((ch) => {
                    const Icon = ch === "store" ? StoreIcon : ReceiptIcon;
                    const on = (values.channels ?? []).includes(ch);
                    return (
                      <Label
                        key={ch}
                        htmlFor={`channel-${ch}`}
                        className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 font-normal transition-colors", on ? "border-primary/40 bg-primary/5" : "hover:bg-accent/50")}
                      >
                        <Checkbox
                          id={`channel-${ch}`}
                          checked={on}
                          className="mt-0.5"
                          onCheckedChange={(c) => {
                            const cur = form.getValues("channels");
                            form.setValue("channels", c === true ? [...new Set([...cur, ch])] : cur.filter((x) => x !== ch), { shouldDirty: true });
                          }}
                        />
                        <span className="grid gap-0.5">
                          <span className="flex items-center gap-1.5 text-sm font-medium">
                            <Icon className="size-3.5 text-primary" /> {t(`commerce.channel.${ch}`)}
                          </span>
                          <span className="text-xs text-muted-foreground">{t(`commerce.channel.${ch}Hint`)}</span>
                        </span>
                      </Label>
                    );
                  })}
                  {(values.channels ?? []).filter((c) => c !== "store" && c !== "billing").length > 0 && (
                    <p className="text-meta text-muted-foreground">
                      {t("commerce.editor.otherChannels", {
                        list: (values.channels as Channel[]).filter((c) => c !== "store" && c !== "billing").join(", "),
                      })}
                    </p>
                  )}
                </div>
              </Card>

              <Card className="hidden gap-0 overflow-hidden py-0 lg:flex" aria-label={t("commerce.editor.previewCard")}>
                <ProductThumb src={values.images?.[0]?.url} alt="" className="aspect-square size-auto w-full rounded-none ring-0" />
                <div className="grid gap-1 p-4">
                  {category && <p className="text-meta text-muted-foreground">{category.name}</p>}
                  <p className="line-clamp-2 font-medium">{values.name || t("commerce.editor.untitled")}</p>
                  <div className="flex items-baseline gap-2">
                    <span className="font-heading text-lg font-bold tabular-nums">{prices.length ? priceRange(Math.min(...prices), Math.max(...prices)) : "₹—"}</span>
                    {!multi && firstMrp !== null && prices[0] !== undefined && firstMrp > prices[0] && (
                      <>
                        <span className="text-sm text-muted-foreground line-through tabular-nums">{money(firstMrp)}</span>
                        <span className="text-xs font-semibold text-success-ink">{t("commerce.editor.offMrp", { pct: discountPct(prices[0], firstMrp) ?? 0 })}</span>
                      </>
                    )}
                  </div>
                  {multi && <p className="text-meta text-muted-foreground">{t("commerce.products.variantCount", { count: values.variants.length })}</p>}
                </div>
              </Card>

              <nav className="hidden lg:block" aria-label={t("commerce.editor.jumpTo")}>
                <p className="mb-1 px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("commerce.editor.jumpTo")}</p>
                <ul className="grid">
                  {sections.map((s) => (
                    <li key={s.id}>
                      <a href={`#${s.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                        <s.icon className="size-4" /> {t(s.label)}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </aside>
          </div>

          {/* Sticky save bar */}
          <div
            className="sticky bottom-0 z-40 -mx-4 mt-6 border-t border-border/70 bg-card/90 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_oklch(0_0_0/0.18)] backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
            data-print-hide
          >
            <div className="mx-auto flex max-w-6xl items-center gap-2">
              <div className="min-w-0 flex-1" aria-live="polite">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p
                    key={errorCount > 0 ? "err" : dirty ? "dirty" : "clean"}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className={cn("flex items-center gap-2 truncate text-sm", errorCount > 0 ? "text-danger-ink" : dirty ? "font-medium" : "text-muted-foreground")}
                  >
                    <span className={cn("size-2 shrink-0 rounded-full", errorCount > 0 ? "bg-destructive" : dirty ? "bg-warning" : "bg-success")} aria-hidden />
                    <span className="min-w-0 truncate">{errorCount > 0 ? t("commerce.editor.fixErrors", { count: errorCount }) : dirty ? t("commerce.editor.unsaved") : isNew ? t("commerce.editor.startTyping") : t("commerce.editor.allSaved")}</span>
                  </motion.p>
                </AnimatePresence>
              </div>
              {dirty && !isNew && (
                <Button type="button" variant="ghost" size="lg" onClick={() => server && form.reset(toFormValues(server))} disabled={saving}>
                  <Undo2Icon /> <span className="hidden sm:inline">{t("commerce.editor.discard")}</span>
                </Button>
              )}
              {isNew && (
                <Button type="button" variant="outline" size="lg" onClick={() => guard.confirmLeave(href("products"))} disabled={saving}>
                  {t("commerce.common.cancel")}
                </Button>
              )}
              <Button type="submit" size="lg" disabled={saving || (!dirty && !isNew)} className="min-w-28">
                {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
                {isNew ? t("commerce.editor.create") : t("commerce.editor.save")}
              </Button>
            </div>
          </div>
        </form>
      </Form>

      {guard.dialog}
      <ConfirmDialog
        open={confirm === "archive"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("commerce.editor.archiveTitle", { name: server?.name ?? "" })}
        description={t("commerce.editor.archiveBody")}
        confirmLabel={t("commerce.products.archive")}
        destructive={false}
        onConfirm={archive}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("commerce.editor.deleteTitle", { name: server?.name ?? "" })}
        description={t("commerce.editor.deleteBody")}
        confirmLabel={t("commerce.editor.delete")}
        onConfirm={remove}
      />
    </Page>
  );
}
