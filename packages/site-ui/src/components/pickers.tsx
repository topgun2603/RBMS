"use client";

import * as React from "react";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, EyeOffIcon, GripVerticalIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { Button, Checkbox, cn, Input, Label, motion, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton } from "@srirealtime/ui";
import { useDebounced, useFeature, useI18n } from "@srirealtime/web";
import { priceRange } from "../lib/format";
import { useCategories, useCollections, usePages, usePosts, useProductsByIds, useProductSearch } from "../lib/queries";
import type { MenuItemType, ProductSummary } from "../lib/types";
import { Thumb } from "./bits";
import { useDragSort } from "./sortable";

// ---------------------------------------------------------------- products

/** Search + ordered list of chosen products (drag or arrows to reorder). */
export function ProductPicker({
  ids,
  onChange,
  max,
  disabled,
  idPrefix,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  max: number;
  disabled?: boolean;
  idPrefix: string;
}) {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const debounced = useDebounced(q.trim(), 250);
  const search = useProductSearch(debounced, !disabled);
  const known = useProductsByIds(ids);
  const [cache, setCache] = React.useState<Map<string, ProductSummary>>(new Map());
  React.useEffect(() => {
    if (known.data) setCache((c) => new Map([...c, ...known.data]));
  }, [known.data]);
  const selected = ids.map((id) => ({ id, p: cache.get(id) }));
  const sort = useDragSort(selected, (s) => s.id, (next) => onChange(next.map((s) => s.id)));
  const chosen = new Set(ids);
  const full = ids.length >= max;

  return (
    <div className="grid gap-3">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={`${idPrefix}-search`}
          type="search"
          className="pl-9"
          value={q}
          disabled={disabled}
          aria-label={t("site.pickers.searchProducts")}
          placeholder={t("site.pickers.searchProducts")}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className={cn("max-h-56 overflow-y-auto rounded-xl border", search.isPlaceholderData && "opacity-60")}>
        {search.isPending ? (
          <div className="grid gap-1 p-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : (search.data?.items.length ?? 0) === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("site.pickers.noProducts")}</p>
        ) : (
          <ul className="divide-y">
            {search.data!.items.map((p) => {
              const on = chosen.has(p.id);
              return (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                  <Thumb src={p.image} className="size-10" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-meta text-muted-foreground tabular-nums">
                      {priceRange(p.priceMin, p.priceMax)}
                      {(p.status !== "active" || !p.channels.includes("store")) && <span className="ml-2 text-warning-ink">· {t("site.pickers.notInStore")}</span>}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={on ? "secondary" : "outline"}
                    disabled={disabled || (!on && full)}
                    aria-pressed={on}
                    aria-label={on ? t("site.pickers.removeNamed", { name: p.name }) : t("site.pickers.addNamed", { name: p.name })}
                    onClick={() => {
                      setCache((c) => new Map(c).set(p.id, p));
                      onChange(on ? ids.filter((x) => x !== p.id) : [...ids, p.id]);
                    }}
                  >
                    {on ? <CheckIcon /> : <PlusIcon />} {on ? t("site.pickers.added") : t("site.pickers.add")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="text-sm font-medium">{t("site.pickers.selected", { count: ids.length })}</p>
      {ids.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">{t("site.pickers.selectedEmpty")}</p>
      ) : (
        <ol className="grid gap-1.5">
          {selected.map(({ id, p }, i) => (
            <motion.li key={id} layout transition={{ duration: 0.16 }}>
              <div
                {...(disabled ? {} : sort.itemProps(id))}
                className="flex items-center gap-2 rounded-xl border bg-card px-2 py-1.5 data-[dragging]:opacity-40 data-[over]:ring-2 data-[over]:ring-primary/50"
              >
                <GripVerticalIcon className="hidden size-4 cursor-grab text-muted-foreground sm:block" aria-hidden />
                {p ? <Thumb src={p.image} className="size-9" /> : <Skeleton className="size-9 rounded-xl" />}
                <div className="min-w-0 flex-1">
                  {p ? (
                    <p className="truncate text-sm font-medium">{p.name}</p>
                  ) : known.isPending ? (
                    <Skeleton className="h-4 w-32" />
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("site.pickers.unknownProduct")}</p>
                  )}
                </div>
                <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || i === 0} onClick={() => sort.move(i, -1)} aria-label={t("site.common.moveUpN", { n: i + 1 })}>
                  <ArrowUpIcon />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || i === ids.length - 1} onClick={() => sort.move(i, 1)} aria-label={t("site.common.moveDownN", { n: i + 1 })}>
                  <ArrowDownIcon />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} onClick={() => onChange(ids.filter((x) => x !== id))} aria-label={t("site.common.removeN", { n: i + 1 })}>
                  <XIcon />
                </Button>
              </div>
            </motion.li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- categories

/** Tick categories to show; chosen ones keep the order they were ticked (arrows reorder). */
export function CategoryPicker({ ids, onChange, max, disabled, idPrefix }: { ids: string[]; onChange: (ids: string[]) => void; max: number; disabled?: boolean; idPrefix: string }) {
  const { t } = useI18n();
  const cats = useCategories();
  const all = (cats.data ?? []).filter((c) => c.active);
  const byId = new Map((cats.data ?? []).map((c) => [c.id, c]));
  const chosen = new Set(ids);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  if (cats.isPending) return <Skeleton className="h-32 w-full rounded-xl" />;
  if (all.length === 0) return <p className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">{t("site.pickers.noCategories")}</p>;

  return (
    <div className="grid items-start gap-3 sm:grid-cols-2">
      <ul className="max-h-60 overflow-y-auto rounded-xl border p-1" aria-label={t("site.pickers.categories")}>
        {all.map((c) => {
          const on = chosen.has(c.id);
          const cid = `${idPrefix}-cat-${c.id}`;
          return (
            <li key={c.id}>
              <Label htmlFor={cid} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 font-normal hover:bg-accent/50">
                <Checkbox
                  id={cid}
                  checked={on}
                  disabled={disabled || (!on && ids.length >= max)}
                  onCheckedChange={(v) => onChange(v ? [...ids, c.id] : ids.filter((x) => x !== c.id))}
                />
                <Thumb src={c.imageUrl} className="size-8 rounded-lg" />
                <span className={cn("truncate text-sm", c.parentId && "text-muted-foreground")}>{c.name}</span>
              </Label>
            </li>
          );
        })}
      </ul>
      <div className="grid content-start gap-1.5">
        <p className="text-sm font-medium">{t("site.pickers.order")}</p>
        {ids.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">{t("site.pickers.pickCategories")}</p>
        ) : (
          <ol className="grid gap-1">
            {ids.map((id, i) => (
              <li key={id} className="flex items-center gap-2 rounded-lg border px-2 py-1">
                <span className="w-5 text-center text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{byId.get(id)?.name ?? t("site.pickers.unknownCategory")}</span>
                <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={t("site.common.moveUpN", { n: i + 1 })}>
                  <ArrowUpIcon />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || i === ids.length - 1} onClick={() => move(i, 1)} aria-label={t("site.common.moveDownN", { n: i + 1 })}>
                  <ArrowDownIcon />
                </Button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- slug selects (collections, menus)

interface SlugOption {
  slug: string;
  label: string;
  hidden?: boolean;
}

function useSlugOptions(type: Exclude<MenuItemType, "url">, enabled: boolean): { options: SlugOption[]; loading: boolean } {
  const blog = useFeature("cms.blog");
  const cats = useCategories(enabled && type === "category");
  const cols = useCollections(enabled && type === "collection");
  const pages = usePages({}, enabled && type === "page");
  const posts = usePosts({}, enabled && type === "post" && blog);
  switch (type) {
    case "category":
      return { loading: cats.isPending, options: (cats.data ?? []).map((c) => ({ slug: c.slug, label: c.name, hidden: !c.active })) };
    case "collection":
      return { loading: cols.isPending, options: (cols.data ?? []).map((c) => ({ slug: c.slug, label: c.name, hidden: !c.active })) };
    case "page":
      return { loading: pages.isPending, options: (pages.data?.items ?? []).map((p) => ({ slug: p.slug, label: p.title, hidden: p.status !== "published" })) };
    case "post":
      return { loading: blog && posts.isPending, options: (posts.data?.items ?? []).map((p) => ({ slug: p.slug, label: p.title, hidden: p.status !== "published" })) };
  }
}

/** Pick a page, post, category or collection by slug. A slug that no longer exists stays visible as "missing". */
export function SlugSelect({
  id,
  type,
  value,
  onChange,
  disabled,
  invalid,
  placeholder,
}: {
  id: string;
  type: Exclude<MenuItemType, "url">;
  value: string;
  onChange: (slug: string, label: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const { options, loading } = useSlugOptions(type, true);
  const known = options.some((o) => o.slug === value);
  return (
    <Select
      value={value || undefined}
      onValueChange={(v) => onChange(v, options.find((o) => o.slug === v)?.label ?? "")}
      disabled={disabled || loading}
    >
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid}>
        <SelectValue placeholder={loading ? t("site.common.loading") : (placeholder ?? t(`site.pickers.pick.${type}`))} />
      </SelectTrigger>
      <SelectContent>
        {options.length === 0 && !value && (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">{t(`site.pickers.none.${type}`)}</div>
        )}
        {value && !known && !loading && (
          <SelectItem value={value}>
            {value} ({t("site.pickers.missing")})
          </SelectItem>
        )}
        {options.map((o) => (
          <SelectItem key={o.slug} value={o.slug}>
            <span className="flex items-center gap-2">
              {o.label}
              {o.hidden && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <EyeOffIcon className="size-3" /> {type === "page" || type === "post" ? t("site.status.draft") : t("site.pickers.hidden")}
                </span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
