"use client";

import * as React from "react";
import { CameraIcon, ClockIcon, Loader2Icon, PackageSearchIcon, SearchIcon, StarIcon, XIcon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  ChipGroup,
  cn,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  motion,
  Skeleton,
} from "@srirealtime/ui";
import { useDebounced, useI18n } from "@srirealtime/web";
import type { CartProduct } from "../lib/cart";
import { useBillingItems, useCategories, useCategoryProducts, useVariantSearch } from "../lib/api";
import { moneyShort } from "../lib/format";
import { fromBillingItem, fromLookup } from "../lib/products";
import type { ProductSummary } from "../lib/types";
import { usePos } from "./pos-context";
import { useCatalog } from "./catalog-provider";
import { fromPosItem, searchCatalog } from "../lib/catalog-sync";
import { useVoiceBill, VoiceBillButton, VoiceReview, type VoiceAddLine } from "./voice-bill";

const HOME = "__home";
const ALL = "__all";

export interface ProductPanelProps {
  searchRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (q: string) => void;
  /** Enter in the search box (not a scanner burst): the panel passes the first result, if any. */
  onSubmit: (q: string, first: CartProduct | null) => void;
  onAdd: (p: CartProduct) => void;
  onPickProduct: (productId: string) => void;
  onCamera: () => void;
  /** Voice billing (Tamil mic): the confirmed lines of a spoken order, to be added to the cart. */
  onVoiceAdd?: (lines: VoiceAddLine[]) => void;
  favourites: CartProduct[];
  recent: CartProduct[];
  onToggleFavourite: (p: CartProduct) => void;
}

export function ProductPanel(props: ProductPanelProps) {
  const { t } = useI18n();
  const { has } = usePos();
  const catalog = useCatalog();
  // The full catalogue on this device (POS terminals): search, categories and scans work from it, also offline.
  const cached = catalog.available && catalog.ready && !!catalog.index;
  const { query, onQuery } = props;
  const vb = useVoiceBill({ onAdd: (lines) => props.onVoiceAdd?.(lines) });
  const [category, setCategory] = React.useState<string>(HOME);
  const q = useDebounced(query.trim(), cached ? 60 : 150);
  const categories = useCategories(has.catalogue && !cached);
  const search = useVariantSearch(q, has.catalogue && !cached);
  const items = useBillingItems(q, !has.catalogue && !cached && q.length > 0);

  const cachedResults = React.useMemo(() => (cached && q ? searchCatalog(catalog.index!, q).map(fromPosItem) : null), [cached, q, catalog.index]);
  const results: CartProduct[] | null = q
    ? cached
      ? cachedResults
      : has.catalogue
        ? (search.data?.items.map(fromLookup) ?? null)
        : (items.data?.items.map(fromBillingItem) ?? null)
    : null;
  const searching = q && !cached ? (has.catalogue ? search.isFetching : items.isFetching) : false;
  const favIds = React.useMemo(() => new Set(props.favourites.map((f) => f.itemId)), [props.favourites]);

  const usedCats = React.useMemo(() => new Set(cached ? catalog.index!.list.map((l) => l.item.categoryId).filter(Boolean) : []), [cached, catalog.index]);
  const chips = cached
    ? [
        { value: HOME, label: t("pos.products.home") },
        { value: ALL, label: t("pos.products.all") },
        ...[...catalog.categories]
          .filter((c) => usedCats.has(c.id))
          .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
          .map((c) => ({ value: c.id, label: c.name })),
      ]
    : [
        { value: HOME, label: t("pos.products.home") },
        ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
      ];
  const browse = React.useMemo(
    () => (cached && category !== HOME ? searchCatalog(catalog.index!, "", { categoryId: category === ALL ? null : category, limit: 240 }).map(fromPosItem) : null),
    [cached, category, catalog.index],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-end gap-2">
        <Field className="flex-1">
          <FieldLabel className="sr-only">{t("pos.products.searchLabel")}</FieldLabel>
          <InputGroup size="lg" className="bg-card">
            <InputGroupAddon>{searching ? <Loader2Icon className="animate-spin" /> : <SearchIcon />}</InputGroupAddon>
            <FieldControl>
              <InputGroupInput
                ref={props.searchRef}
                data-scan-target=""
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    props.onSubmit(query.trim(), results?.[0] ?? null);
                  } else if (e.key === "Escape" && query) {
                    e.preventDefault();
                    e.stopPropagation();
                    onQuery("");
                  }
                }}
                placeholder={t("pos.products.searchPlaceholder")}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
                className="text-base"
              />
            </FieldControl>
            {query ? (
              <InputGroupAddon>
                <button type="button" className="rounded p-1 hover:bg-accent" aria-label={t("pos.common.clear")} onClick={() => onQuery("")}>
                  <XIcon />
                </button>
              </InputGroupAddon>
            ) : (
              <InputGroupAddon className="hidden sm:flex">
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem]">F2</kbd>
              </InputGroupAddon>
            )}
          </InputGroup>
        </Field>
        {props.onVoiceAdd && <VoiceBillButton vb={vb} />}
        <Button type="button" variant="outline" size="icon-lg" onClick={props.onCamera} aria-label={t("pos.scan.camera")} title={t("pos.scan.camera")}>
          <CameraIcon />
        </Button>
      </div>

      {props.onVoiceAdd && (
        <VoiceReview
          vb={vb}
          onSearch={(text) => {
            onQuery(text);
            props.searchRef.current?.focus();
          }}
        />
      )}

      {cached && (
        <p className="-mt-1 flex items-center gap-1.5 text-xs text-muted-foreground" data-catalog-status="">
          {catalog.syncing ? <Loader2Icon className="size-3 animate-spin" /> : null}
          {catalog.stale ? t("pos.products.cacheStale", { count: catalog.count }) : t("pos.products.cacheCount", { count: catalog.count })}
        </p>
      )}
      {(has.catalogue || cached) && !q && chips.length > 1 && (
        <ChipGroup aria-label={t("pos.products.categories")} value={category} onChange={setCategory} options={chips} />
      )}

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {q ? (
          <ResultGrid
            loading={results === null}
            items={results ?? []}
            favIds={favIds}
            onAdd={props.onAdd}
            onToggleFavourite={props.onToggleFavourite}
            empty={<EmptyState compact icon={PackageSearchIcon} title={t("pos.products.noMatch", { q })} description={t("pos.products.noMatchHint")} />}
          />
        ) : browse ? (
          <ResultGrid
            items={browse}
            favIds={favIds}
            onAdd={props.onAdd}
            onToggleFavourite={props.onToggleFavourite}
            empty={<EmptyState compact icon={PackageSearchIcon} title={t("pos.products.categoryEmpty")} />}
          />
        ) : category !== HOME ? (
          <CategoryGrid categoryId={category} onPick={props.onPickProduct} />
        ) : (
          <HomeGrid {...props} favIds={favIds} />
        )}
      </div>
    </div>
  );
}

function HomeGrid({ favourites, recent, onAdd, onToggleFavourite, favIds }: ProductPanelProps & { favIds: Set<string> }) {
  const { t } = useI18n();
  const recentOnly = recent.filter((r) => !favIds.has(r.itemId));
  if (favourites.length === 0 && recentOnly.length === 0) {
    return (
      <EmptyState
        icon={PackageSearchIcon}
        title={t("pos.products.emptyTitle")}
        description={t("pos.products.emptyBody")}
        className="mt-2"
      />
    );
  }
  return (
    <div className="grid gap-4">
      {favourites.length > 0 && (
        <section className="grid gap-2">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <StarIcon className="size-3.5" /> {t("pos.products.favourites")}
          </h2>
          <ResultGrid items={favourites} favIds={favIds} onAdd={onAdd} onToggleFavourite={onToggleFavourite} />
        </section>
      )}
      {recentOnly.length > 0 && (
        <section className="grid gap-2">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <ClockIcon className="size-3.5" /> {t("pos.products.recent")}
          </h2>
          <ResultGrid items={recentOnly} favIds={favIds} onAdd={onAdd} onToggleFavourite={onToggleFavourite} />
        </section>
      )}
    </div>
  );
}

const GRID = "grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";

function ResultGrid({
  items,
  loading,
  favIds,
  onAdd,
  onToggleFavourite,
  empty,
}: {
  items: CartProduct[];
  loading?: boolean;
  favIds: Set<string>;
  onAdd: (p: CartProduct) => void;
  onToggleFavourite: (p: CartProduct) => void;
  empty?: React.ReactNode;
}) {
  const { t } = useI18n();
  if (loading) return <TileSkeletons />;
  if (items.length === 0) return <>{empty ?? null}</>;
  return (
    <div className={GRID}>
      <AnimatePresence initial={false}>
        {items.map((p) => {
          const fav = favIds.has(p.itemId);
          return (
            <motion.div
              key={p.itemId}
              layout
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="relative"
            >
              <button
                type="button"
                onClick={() => onAdd(p)}
                className="flex min-h-24 w-full flex-col justify-between gap-2 rounded-xl border bg-card p-3 pr-9 text-left shadow-xs transition-[border-color,background-color,transform] outline-none hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:active:scale-100"
              >
                <span className="line-clamp-2 text-sm leading-snug font-medium">{p.name}</span>
                <span className="flex items-end justify-between gap-2">
                  <span className="text-base font-semibold tabular-nums">
                    {moneyShort(p.price)}
                    {p.soldBy === "weight" && <span className="text-xs font-normal text-muted-foreground">/{p.unit}</span>}
                  </span>
                  {p.sku && <span className="truncate font-mono text-[0.6875rem] text-muted-foreground">{p.sku}</span>}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onToggleFavourite(p)}
                aria-pressed={fav}
                aria-label={fav ? t("pos.products.unfavourite", { name: p.name }) : t("pos.products.favourite", { name: p.name })}
                className="absolute top-1.5 right-1.5 grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <StarIcon className={cn("size-4", fav && "fill-warning text-warning")} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function CategoryGrid({ categoryId, onPick }: { categoryId: string; onPick: (id: string) => void }) {
  const { t } = useI18n();
  const { data, isLoading } = useCategoryProducts(categoryId);
  if (isLoading) return <TileSkeletons />;
  const items: ProductSummary[] = data?.items ?? [];
  if (items.length === 0) return <EmptyState compact icon={PackageSearchIcon} title={t("pos.products.categoryEmpty")} />;
  return (
    <div className={GRID}>
      {items.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onPick(p.id)}
          className="flex min-h-24 flex-col justify-between gap-2 rounded-xl border bg-card p-3 text-left shadow-xs transition-[border-color,background-color,transform] outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:active:scale-100"
        >
          <span className="line-clamp-2 text-sm leading-snug font-medium">{p.name}</span>
          <span className="flex items-end justify-between gap-2">
            <span className="text-base font-semibold tabular-nums">
              {p.priceMin === p.priceMax ? moneyShort(p.priceMin) : `${moneyShort(p.priceMin)}+`}
            </span>
            {p.variantCount > 1 && (
              <span className="text-[0.6875rem] text-muted-foreground">{t("pos.products.variants", { count: p.variantCount })}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

function TileSkeletons() {
  return (
    <div className={GRID}>
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}
