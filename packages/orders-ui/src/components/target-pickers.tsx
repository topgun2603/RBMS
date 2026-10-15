"use client";

import * as React from "react";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { Checkbox, cn, Skeleton } from "@srirealtime/ui";
import { SearchField, useDebounced, useI18n } from "@srirealtime/web";
import { money } from "../lib/format";
import { useCategories, useProductPick, useProductsByIds } from "../lib/queries";
import type { CategoryLite } from "../lib/types";
import { Thumb } from "./bits";

/** Category tree as an indented checklist with a filter box. */
export function CategoryChecklist({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const cats = useCategories();
  const [q, setQ] = React.useState("");
  const ordered = React.useMemo(() => flatten(cats.data ?? []), [cats.data]);
  const shown = q.trim() ? ordered.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())) : ordered;
  const set = new Set(value);
  if (cats.isPending) return <Skeleton className="h-40 rounded-xl" />;
  if (ordered.length === 0) return <p className="text-sm text-muted-foreground">{t("orders.coupons.noCategories")}</p>;
  return (
    <div className="grid gap-2">
      {ordered.length > 8 && <SearchField value={q} onChange={setQ} placeholder={t("orders.coupons.filterCategories")} />}
      <ul className="max-h-64 overflow-y-auto rounded-xl border p-1">
        {shown.map((c) => (
          <li key={c.id}>
            <label className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-accent/50", disabled && "pointer-events-none opacity-60")} style={{ paddingLeft: `${0.5 + c.depth * 1.25}rem` }}>
              <Checkbox
                checked={set.has(c.id)}
                disabled={disabled}
                onCheckedChange={(on) => onChange(on === true ? [...value, c.id] : value.filter((x) => x !== c.id))}
              />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {c.productCount !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{c.productCount}</span>}
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("orders.coupons.selectedCount", { count: value.length })}</p>
    </div>
  );
}

function flatten(cats: CategoryLite[]): (CategoryLite & { depth: number })[] {
  const byParent = new Map<string | null, CategoryLite[]>();
  for (const c of cats) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
  const out: (CategoryLite & { depth: number })[] = [];
  const ids = new Set(cats.map((c) => c.id));
  const walk = (parent: string | null, depth: number) => {
    for (const c of byParent.get(parent) ?? []) {
      out.push({ ...c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  // Orphans (parent missing) at the root.
  for (const c of cats) if (c.parentId && !ids.has(c.parentId) && !out.some((o) => o.id === c.id)) out.push({ ...c, depth: 0 });
  return out;
}

/** Search products and collect them as removable chips. */
export function ProductMultiPicker({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const debounced = useDebounced(q.trim(), 250);
  const results = useProductPick(debounced, !disabled);
  const known = useProductsByIds(value);
  const [names, setNames] = React.useState<Map<string, string>>(new Map());
  const set = new Set(value);
  const nameOf = (id: string) => names.get(id) ?? known.data?.get(id)?.name ?? t("orders.common.loading");

  return (
    <div className="grid gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span key={id} className="inline-flex h-8 items-center gap-1 rounded-full bg-primary/10 pr-1 pl-3 text-xs font-medium text-primary ring-1 ring-primary/20 ring-inset">
              <span className="max-w-48 truncate">{nameOf(id)}</span>
              {!disabled && (
                <button
                  type="button"
                  className="inline-flex size-6 items-center justify-center rounded-full outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("orders.common.removeNamed", { name: nameOf(id) })}
                  onClick={() => onChange(value.filter((x) => x !== id))}
                >
                  <XIcon className="size-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && (
        <>
          <SearchField value={q} onChange={setQ} placeholder={t("orders.coupons.searchProducts")} />
          <ul className="max-h-64 overflow-y-auto rounded-xl border p-1">
            {results.isPending ? (
              <li className="p-2">
                <Skeleton className="h-10 rounded-lg" />
              </li>
            ) : (results.data?.items ?? []).length === 0 ? (
              <li className="px-3 py-4 text-center text-sm text-muted-foreground">{t("orders.new.noProducts")}</li>
            ) : (
              (results.data?.items ?? []).map((p) => {
                const on = set.has(p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setNames((m) => new Map(m).set(p.id, p.name));
                        onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id]);
                      }}
                      className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring", on && "bg-primary/8")}
                      aria-pressed={on}
                    >
                      <Thumb src={p.image} alt="" className="size-9" />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {p.priceMin !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{money(p.priceMin)}</span>}
                      {on ? <CheckIcon className="size-4 text-primary" /> : <PlusIcon className="size-4 text-muted-foreground" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </>
      )}
    </div>
  );
}
