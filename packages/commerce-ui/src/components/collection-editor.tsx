"use client";

import * as React from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  EyeIcon,
  FileTextIcon,
  FilterIcon,
  GripVerticalIcon,
  HandIcon,
  LayersIcon,
  Loader2Icon,
  MoreVerticalIcon,
  PlusIcon,
  SaveIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  ChipGroup,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  Label,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, Page, PageHeading, useDebounced, useI18n, useModuleHref } from "@srirealtime/web";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@srirealtime/web";
import { MoneyInput, Optional, ProductStatusPill, ProductThumb, Section } from "./bits";
import { CategorySelect } from "./category-select";
import { ImageManager } from "./image-manager";
import { useDragSort } from "./sortable";
import { useUnsavedGuard } from "./unsaved-guard";
import { useCanManageCatalogue } from "../lib/access";
import { money, paiseToInput, priceRange, rupeesToPaise, SLUG_RE, slugify } from "../lib/format";
import { useDeleteCollection, useProductsByIds, useProductSearch, usePublicCollection, useSaveCollection } from "../lib/queries";
import { COLLECTION_SORTS, type Collection, type CollectionInput, type CollectionSort, type Paged, type ProductSummary } from "../lib/types";

interface Draft {
  name: string;
  slug: string;
  description: string;
  image: { url: string; alt?: string | null }[];
  active: boolean;
  type: "manual" | "rule";
  productIds: string[];
  categoryId: string | null;
  tag: string;
  priceMax: string;
  onSale: boolean;
  sort: CollectionSort;
}

const toDraft = (c?: Collection | null): Draft => ({
  name: c?.name ?? "",
  slug: c?.slug ?? "",
  description: c?.description ?? "",
  image: c?.imageUrl ? [{ url: c.imageUrl }] : [],
  active: c?.active ?? true,
  type: c?.type ?? "manual",
  productIds: c?.productIds ?? [],
  categoryId: c?.rule?.categoryId ?? null,
  tag: c?.rule?.tag ?? "",
  priceMax: paiseToInput(c?.rule?.priceMax ?? null),
  onSale: !!c?.rule?.onSale,
  sort: c?.rule?.sort ?? "new",
});

function toInput(d: Draft): CollectionInput {
  return {
    name: d.name.trim(),
    slug: d.slug.trim() || null,
    description: d.description.trim() || null,
    imageUrl: d.image[0]?.url ?? null,
    active: d.active,
    type: d.type,
    productIds: d.type === "manual" ? d.productIds : [],
    rule:
      d.type === "rule"
        ? { categoryId: d.categoryId, tag: d.tag.trim().toLowerCase() || null, priceMax: rupeesToPaise(d.priceMax), onSale: d.onSale || null, sort: d.sort }
        : null,
  };
}

export function CollectionEditor({ collection }: { collection?: Collection }) {
  const { t } = useI18n();
  const href = useModuleHref();
  const isNew = !collection;
  const canManage = useCanManageCatalogue();
  const save = useSaveCollection();
  const del = useDeleteCollection();
  const [server, setServer] = React.useState<Collection | null>(collection ?? null);
  const [d, setD] = React.useState<Draft>(() => toDraft(collection));
  const [errors, setErrors] = React.useState<{ name?: string; slug?: string; priceMax?: string }>({});
  const [deleting, setDeleting] = React.useState(false);
  const baseline = React.useMemo(() => JSON.stringify(toDraft(server)), [server]);
  const dirty = JSON.stringify(d) !== baseline;
  const guard = useUnsavedGuard(dirty && !save.isPending);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const next: typeof errors = {};
    if (!d.name.trim()) next.name = t("commerce.validation.required");
    if (d.slug.trim() && !SLUG_RE.test(d.slug.trim())) next.slug = t("commerce.validation.slug");
    if (d.type === "rule" && d.priceMax.trim() && rupeesToPaise(d.priceMax) === null) next.priceMax = t("commerce.validation.amount");
    setErrors(next);
    if (Object.keys(next).length) {
      toast.error(t("commerce.editor.fixErrors", { count: Object.keys(next).length }));
      return;
    }
    const tid = toast.loading(t("commerce.editor.saving"));
    try {
      const c = await save.mutateAsync({ id: server?.id, body: toInput(d) });
      toast.success(isNew ? t("commerce.collections.created", { name: c.name }) : t("commerce.editor.saved"), { id: tid });
      if (isNew) guard.leave(href(`collections/${c.id}`), { replace: true });
      else {
        setServer(c);
        setD(toDraft(c));
      }
    } catch (err) {
      toast.error(describeError(err, t), { id: tid });
    }
  };

  return (
    <Page className="max-w-5xl pb-0">
      <PageHeading
        back={{ href: "collections", label: t("commerce.nav.collections") }}
        icon={LayersIcon}
        title={isNew ? t("commerce.collections.newTitle") : server?.name}
        description={isNew ? t("commerce.collections.newSubtitle") : `/collections/${server?.slug}`}
        actions={
          server &&
          canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-lg" aria-label={t("commerce.common.more")}>
                  <MoreVerticalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => setDeleting(true)}>
                  <Trash2Icon /> {t("commerce.common.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />

      <form onSubmit={submit} noValidate className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
          <Section id="details" icon={FileTextIcon} title={t("commerce.collections.details")}>
            <Field id="col-name" invalid={!!errors.name}>
              <FieldLabel>{t("commerce.collections.name")}</FieldLabel>
              <FieldControl>
                <Input className="text-base" value={d.name} disabled={!canManage} onChange={(e) => set("name", e.target.value)} />
              </FieldControl>
              <FieldError>{errors.name}</FieldError>
            </Field>
            <Field id="col-desc">
              <FieldLabel optional={<Optional />}>{t("commerce.collections.description")}</FieldLabel>
              <FieldControl>
                <Textarea rows={3} value={d.description} disabled={!canManage} onChange={(e) => set("description", e.target.value)} />
              </FieldControl>
            </Field>
            <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Field id="col-slug" invalid={!!errors.slug}>
                <FieldLabel>{t("commerce.collections.slug")}</FieldLabel>
                <FieldControl>
                  <Input
                    className="font-mono"
                    value={d.slug}
                    placeholder={slugify(d.name) || undefined}
                    disabled={!canManage}
                    onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                  />
                </FieldControl>
                <FieldError>{errors.slug}</FieldError>
              </Field>
              <Label htmlFor="col-active" className="flex items-center justify-between gap-4 rounded-xl border px-4 py-2.5 font-normal">
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{t("commerce.collections.active")}</span>
                  <span className="text-xs text-muted-foreground">{t("commerce.collections.activeHint")}</span>
                </span>
                <Switch id="col-active" checked={d.active} disabled={!canManage} onCheckedChange={(v) => set("active", v)} />
              </Label>
            </div>
            <div className="grid content-start gap-2">
              <Label>{t("commerce.collections.image")}</Label>
              <ImageManager value={d.image} onChange={(v) => set("image", v)} single disabled={!canManage} />
            </div>
          </Section>

          <Section
            id="products"
            icon={d.type === "rule" ? SparklesIcon : HandIcon}
            tone="text-info-ink"
            title={t("commerce.collections.productsTitle")}
            description={d.type === "rule" ? t("commerce.collections.ruleHint") : t("commerce.collections.manualHint")}
          >
            <ChipGroup<"manual" | "rule">
              value={d.type}
              onChange={(v) => set("type", v)}
              aria-label={t("commerce.collections.typeLabel")}
              options={[
                { value: "manual", label: <><HandIcon className="size-4" /> {t("commerce.collections.type.manual")}</> },
                { value: "rule", label: <><SparklesIcon className="size-4" /> {t("commerce.collections.type.rule")}</> },
              ]}
            />
            {d.type === "manual" ? (
              <ManualPicker ids={d.productIds} onChange={(ids) => set("productIds", ids)} disabled={!canManage} />
            ) : (
              <FieldRow cols={2}>
                <Field id="rule-cat">
                  <FieldLabel>{t("commerce.collections.ruleCategory")}</FieldLabel>
                  <CategorySelect
                    id="rule-cat"
                    value={d.categoryId}
                    onChange={(v) => set("categoryId", v)}
                    allowCreate={false}
                    noneLabel={t("commerce.collections.anyCategory")}
                    className="w-full"
                    disabled={!canManage}
                  />
                  <FieldHint>{t("commerce.collections.ruleCategoryHint")}</FieldHint>
                </Field>
                <Field id="rule-tag">
                  <FieldLabel>{t("commerce.collections.ruleTag")}</FieldLabel>
                  <FieldControl>
                    <Input value={d.tag} placeholder={t("commerce.collections.ruleTagPlaceholder")} disabled={!canManage} onChange={(e) => set("tag", e.target.value.toLowerCase())} />
                  </FieldControl>
                </Field>
                <Field id="rule-price" invalid={!!errors.priceMax}>
                  <FieldLabel>{t("commerce.collections.rulePriceMax")}</FieldLabel>
                  <FieldControl>
                    <MoneyInput value={d.priceMax} disabled={!canManage} onChange={(e) => set("priceMax", e.target.value)} />
                  </FieldControl>
                  <FieldError>{errors.priceMax}</FieldError>
                </Field>
                <Field id="rule-sort">
                  <FieldLabel>{t("commerce.collections.ruleSort")}</FieldLabel>
                  <Select value={d.sort} onValueChange={(v) => set("sort", v as CollectionSort)} disabled={!canManage}>
                    <SelectTrigger id="rule-sort" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COLLECTION_SORTS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(`commerce.collections.sort.${s}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Label htmlFor="rule-sale" className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3 font-normal sm:col-span-2">
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">{t("commerce.collections.ruleOnSale")}</span>
                    <span className="text-xs text-muted-foreground">{t("commerce.collections.ruleOnSaleHint")}</span>
                  </span>
                  <Switch id="rule-sale" checked={d.onSale} disabled={!canManage} onCheckedChange={(v) => set("onSale", v)} />
                </Label>
              </FieldRow>
            )}
          </Section>
        </div>

        <aside className="grid gap-4 lg:sticky lg:top-20" aria-label={t("commerce.collections.preview")}>
          <PreviewPanel draft={d} server={server} dirty={dirty} />
        </aside>

        {/* Sticky save bar */}
        {canManage && (
          <div className="sticky bottom-0 z-40 -mx-4 border-t border-border/70 bg-card/90 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_oklch(0_0_0/0.18)] backdrop-blur-md sm:-mx-6 sm:px-6 lg:col-span-2 lg:-mx-8 lg:px-8">
            <div className="mx-auto flex max-w-5xl items-center gap-2">
              <p className={cn("flex min-w-0 flex-1 items-center gap-2 truncate text-sm", dirty ? "font-medium" : "text-muted-foreground")} aria-live="polite">
                <span className={cn("size-2 shrink-0 rounded-full", dirty ? "bg-warning" : "bg-success")} aria-hidden />
                {dirty ? t("commerce.editor.unsaved") : isNew ? t("commerce.editor.startTyping") : t("commerce.editor.allSaved")}
              </p>
              {dirty && !isNew && (
                <Button type="button" variant="ghost" size="lg" onClick={() => setD(toDraft(server))}>
                  <Undo2Icon /> <span className="hidden sm:inline">{t("commerce.editor.discard")}</span>
                </Button>
              )}
              {isNew && (
                <Button type="button" variant="outline" size="lg" onClick={() => guard.confirmLeave(href("collections"))}>
                  {t("commerce.common.cancel")}
                </Button>
              )}
              <Button type="submit" size="lg" disabled={save.isPending || (!dirty && !isNew)} className="min-w-28">
                {save.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
                {isNew ? t("commerce.collections.create") : t("commerce.editor.save")}
              </Button>
            </div>
          </div>
        )}
      </form>

      {guard.dialog}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("commerce.collections.deleteTitle", { name: server?.name ?? "" })}
        description={t("commerce.collections.deleteBody")}
        confirmLabel={t("commerce.common.delete")}
        onConfirm={async () => {
          if (!server) return;
          try {
            await del.mutateAsync(server.id);
            toast.success(t("commerce.collections.deleted", { name: server.name }));
            guard.leave(href("collections"), { replace: true });
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </Page>
  );
}

// ---------------------------------------------------------------- manual picker

function ManualPicker({ ids, onChange, disabled }: { ids: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const debounced = useDebounced(q.trim(), 250);
  const search = useProductSearch(debounced, !disabled);
  const known = useProductsByIds(ids);
  const [cache, setCache] = React.useState<Map<string, ProductSummary>>(new Map());
  React.useEffect(() => {
    if (known.data) setCache((c) => new Map([...c, ...known.data]));
  }, [known.data]);
  const remember = (p: ProductSummary) => setCache((c) => new Map(c).set(p.id, p));
  const selected = React.useMemo(() => ids.map((id) => ({ id, p: cache.get(id) })), [ids, cache]);
  const sort = useDragSort(selected, (s) => s.id, (next) => onChange(next.map((s) => s.id)));
  const chosen = new Set(ids);

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="pick-search" className="sr-only">
          {t("commerce.collections.searchProducts")}
        </Label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="pick-search" type="search" className="pl-9" value={q} disabled={disabled} placeholder={t("commerce.collections.searchProducts")} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className={cn("max-h-64 overflow-y-auto rounded-xl border", search.isPlaceholderData && "opacity-60")}>
          {search.isPending ? (
            <div className="grid gap-1 p-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : (search.data?.items.length ?? 0) === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("commerce.collections.noResults")}</p>
          ) : (
            <ul className="divide-y">
              {search.data!.items.map((p) => {
                const on = chosen.has(p.id);
                return (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                    <ProductThumb src={p.image} alt="" className="size-10" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">{priceRange(p.priceMin, p.priceMax)}</p>
                    </div>
                    {p.status !== "active" && <ProductStatusPill status={p.status} className="hidden sm:inline-flex" />}
                    <Button
                      type="button"
                      size="sm"
                      variant={on ? "secondary" : "outline"}
                      disabled={disabled}
                      aria-pressed={on}
                      aria-label={on ? t("commerce.collections.removeNamed", { name: p.name }) : t("commerce.collections.addNamed", { name: p.name })}
                      onClick={() => {
                        remember(p);
                        onChange(on ? ids.filter((x) => x !== p.id) : [...ids, p.id]);
                      }}
                    >
                      {on ? <CheckIcon /> : <PlusIcon />} {on ? t("commerce.collections.added") : t("commerce.collections.addOne")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-2">
        <p className="text-sm font-medium">{t("commerce.collections.selected", { count: ids.length })}</p>
        {ids.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("commerce.collections.selectedEmpty")}</p>
        ) : (
          <ol className="grid gap-1.5">
            {selected.map(({ id, p }, i) => (
              <motion.li key={id} layout transition={{ duration: 0.18 }}>
                <div
                  {...(disabled ? {} : sort.itemProps(id))}
                  className="flex items-center gap-2 rounded-xl border bg-card px-2 py-1.5 data-[dragging]:opacity-40 data-[over]:ring-2 data-[over]:ring-primary/50"
                >
                <span className="hidden cursor-grab text-muted-foreground sm:inline-flex" aria-hidden>
                  <GripVerticalIcon className="size-4" />
                </span>
                <span className="w-5 text-center text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                {p ? <ProductThumb src={p.image} alt="" className="size-9" /> : <Skeleton className="size-9 rounded-xl" />}
                <div className="min-w-0 flex-1">
                  {p ? <p className="truncate text-sm font-medium">{p.name}</p> : known.isPending ? <Skeleton className="h-4 w-32" /> : <p className="text-sm text-muted-foreground">{t("commerce.collections.unknownProduct")}</p>}
                  {p && <p className="text-xs text-muted-foreground tabular-nums">{priceRange(p.priceMin, p.priceMax)}</p>}
                </div>
                <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || i === 0} onClick={() => sort.move(i, -1)} aria-label={t("commerce.collections.moveUp", { n: i + 1 })}>
                  <ArrowUpIcon />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || i === ids.length - 1} onClick={() => sort.move(i, 1)} aria-label={t("commerce.collections.moveDown", { n: i + 1 })}>
                  <ArrowDownIcon />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} onClick={() => onChange(ids.filter((x) => x !== id))} aria-label={t("commerce.collections.removeN", { n: i + 1 })}>
                  <XIcon />
                </Button>
                </div>
              </motion.li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- preview

function PreviewPanel({ draft, server, dirty }: { draft: Draft; server: Collection | null; dirty: boolean }) {
  const { t } = useI18n();
  // Saved, active and unchanged: ask the store itself (exact rule evaluation, incl. subcategories and "on sale").
  const exact = !!server && server.active && !dirty;
  const publicQ = usePublicCollection(server?.slug ?? null, exact);
  const priceMax = rupeesToPaise(draft.priceMax);
  const ruleQ = useQuery({
    queryKey: ["catalog", "rule-preview", draft.categoryId, draft.tag.trim(), priceMax, draft.sort],
    enabled: draft.type === "rule" && !(exact && publicQ.isSuccess),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      api.get<Paged<ProductSummary>>(
        "/catalog/products",
        { categoryId: draft.categoryId ?? undefined, tag: draft.tag.trim() || undefined, status: "active", channel: "store", limit: 200 },
        { signal },
      ),
  });
  const manual = useProductsByIds(draft.type === "manual" ? draft.productIds : []);

  type Row = { id: string; name: string; image: string | null; priceMin: number; priceMax: number; mrp?: number | null };
  let rows: Row[] = [];
  let total = 0;
  let loading = false;
  let approximate = false;

  if (exact && publicQ.isSuccess) {
    rows = publicQ.data.items;
    total = publicQ.data.total;
  } else if (draft.type === "manual") {
    loading = manual.isPending && draft.productIds.length > 0;
    rows = draft.productIds.map((id) => manual.data?.get(id)).filter((p): p is ProductSummary => !!p && p.status === "active" && p.channels.includes("store"));
    total = rows.length;
  } else {
    loading = ruleQ.isPending;
    let list = ruleQ.data?.items ?? [];
    if (priceMax !== null) list = list.filter((p) => p.priceMin <= priceMax);
    const by: Record<CollectionSort, (a: ProductSummary, b: ProductSummary) => number> = {
      new: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      "price-asc": (a, b) => a.priceMin - b.priceMin,
      "price-desc": (a, b) => b.priceMin - a.priceMin,
      name: (a, b) => a.name.localeCompare(b.name),
      rating: () => 0,
    };
    rows = [...list].sort(by[draft.sort]);
    total = rows.length;
    approximate = draft.onSale || !!draft.categoryId;
  }

  return (
    <section className="rounded-2xl border border-card-ring bg-card shadow-elevated" aria-labelledby="col-preview-title">
      <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <span className="icon-chip size-9 rounded-xl text-primary">
          <EyeIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="col-preview-title" className="font-heading text-base font-semibold">
            {t("commerce.collections.preview")}
          </h2>
          <p className="text-xs text-muted-foreground">{loading ? t("commerce.common.loading") : t("commerce.collections.matching", { count: total })}</p>
        </div>
        {draft.type === "rule" && <FilterIcon className="size-4 text-muted-foreground" aria-hidden />}
      </header>
      <div className="grid gap-3 p-3">
        {!draft.active && (
          <Alert>
            <AlertDescription className="text-xs">{t("commerce.collections.previewHidden")}</AlertDescription>
          </Alert>
        )}
        {loading ? (
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="aspect-[3/4] w-full rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("commerce.collections.previewEmpty")}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {rows.slice(0, 8).map((p) => (
              <li key={p.id} className="overflow-hidden rounded-xl border bg-background">
                <ProductThumb src={p.image} alt="" className="aspect-square size-auto w-full rounded-none ring-0" />
                <div className="p-2">
                  <p className="line-clamp-2 text-xs font-medium">{p.name}</p>
                  <p className="text-xs font-semibold tabular-nums">
                    {money(p.priceMin)}
                    {p.mrp && p.mrp > p.priceMin ? <span className="ml-1 font-normal text-muted-foreground line-through">{money(p.mrp)}</span> : null}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {rows.length > 8 && <p className="text-center text-xs text-muted-foreground">{t("commerce.collections.andMore", { count: rows.length - 8 })}</p>}
        <p className="px-1 text-[0.6875rem] text-muted-foreground">
          {exact && publicQ.isSuccess ? t("commerce.collections.previewExact") : approximate ? t("commerce.collections.previewApprox") : t("commerce.collections.previewLive")}
        </p>
      </div>
    </section>
  );
}
