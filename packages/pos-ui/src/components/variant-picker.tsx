"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Skeleton } from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { fetchProduct } from "../lib/api";
import type { CartProduct } from "../lib/cart";
import { moneyShort } from "../lib/format";
import { fromVariant, sellableVariants } from "../lib/products";

/**
 * Picks a variant of a product (size / colour). A product with a single variant is added straight away by the
 * caller; this dialog shows the rest as large tiles, grouped by the first option (e.g. colour) when there are many.
 */
export function VariantPicker({ productId, onClose, onPick }: { productId: string | null; onClose: () => void; onPick: (p: CartProduct) => void }) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["pos", "product", productId],
    queryFn: () => fetchProduct(productId!),
    enabled: !!productId,
    staleTime: 60_000,
  });
  const product = query.data;

  // Simple product: add without asking.
  React.useEffect(() => {
    if (product && product.variants.length === 1) {
      onPick(fromVariant(product, product.variants[0]!));
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a (new) product arrives
  }, [product, productId]);

  const variants = product ? sellableVariants(product) : [];
  const first = product?.options[0]?.name;
  const groups = React.useMemo(() => {
    if (!first || variants.length <= 8) return [{ name: "", items: variants }];
    const map = new Map<string, typeof variants>();
    for (const v of variants) {
      const key = v.optionValues[first] ?? "";
      map.set(key, [...(map.get(key) ?? []), v]);
    }
    return [...map.entries()].map(([name, items]) => ({ name, items }));
  }, [first, variants]);

  return (
    <Dialog open={!!productId && !(product && product.variants.length === 1)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl" closeLabel={t("pos.common.close")}>
        <DialogHeader>
          <DialogTitle>{product?.name ?? t("pos.variant.title")}</DialogTitle>
          <DialogDescription>{t("pos.variant.body")}</DialogDescription>
        </DialogHeader>
        {query.isError ? (
          <p className="text-sm text-destructive">{describeError(query.error, t)}</p>
        ) : !product ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid max-h-[60dvh] gap-4 overflow-y-auto">
            {groups.map((g) => (
              <section key={g.name || "all"} className="grid gap-2">
                {g.name && <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.name}</h3>}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {g.items.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        onPick(fromVariant(product, v));
                        onClose();
                      }}
                      className="flex min-h-20 flex-col justify-between gap-1 rounded-xl border bg-card p-3 text-left outline-none hover:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:active:scale-100"
                    >
                      <span className="text-sm font-semibold">{v.title || t("pos.variant.default")}</span>
                      <span className="flex items-end justify-between gap-2">
                        <span className="tabular-nums">{moneyShort(v.price)}</span>
                        {v.sku && <span className="truncate font-mono text-[0.6875rem] text-muted-foreground">{v.sku}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
