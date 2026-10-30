"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon, SparklesIcon } from "lucide-react";
import { useI18n } from "@rbms/web";
import { posApi } from "../lib/api";
import type { CartLine, CartProduct } from "../lib/cart";
import { money } from "../lib/format";

/** One suggested item (from `POST /v1/ai/store/together/for-cart`): everything needed to add it as a line. */
interface Partner {
  itemId: string;
  productId: string;
  name: string;
  price: number;
  unit: string;
  hsn: string | null;
  taxInclusive: boolean;
  gstRate: number;
  gstRule: CartProduct["gstRule"];
  image: string | null;
  sku: string | null;
  barcode: string | null;
}

const toProduct = (p: Partner): CartProduct => ({
  itemId: p.itemId,
  productId: p.productId,
  name: p.name,
  sku: p.sku,
  barcode: p.barcode,
  hsn: p.hsn,
  unit: p.unit || "pcs",
  price: p.price,
  taxInclusive: p.taxInclusive,
  gstRate: p.gstRate,
  ...(p.gstRule ? { gstRule: p.gstRule } : {}),
  image: p.image,
});

/**
 * "Customers also buy ..." chips under the cart lines: items often on the same bill or order as what is in the cart (computed
 * daily from the shop's own sales, no AI model), in stock only. One tap adds the item. Shows nothing when the shop has the
 * switch off, has too little history, or the call is refused (a terminal without access just never sees the row).
 */
export function AlsoBuyChips({ lines, onAdd }: { lines: CartLine[]; onAdd: (p: CartProduct) => void }) {
  const { t } = useI18n();
  const ids = React.useMemo(() => [...new Set(lines.map((l) => l.itemId))].sort().slice(0, 20), [lines]);
  const q = useQuery({
    queryKey: ["pos", "together", ids.join(",")],
    queryFn: () => posApi.post<{ enabled: boolean; items: Partner[] }>("/ai/store/together/for-cart", { itemIds: ids, limit: 4 }),
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const inCart = new Set(ids);
  const items = (q.data?.items ?? []).filter((p) => !inCart.has(p.itemId)).slice(0, 4);
  if (!items.length) return null;
  return (
    <div className="border-t bg-card/60 px-3 py-2" data-testid="also-buy">
      <p className="mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">
        <SparklesIcon className="size-3" aria-hidden />
        {t("pos.also.title")}
      </p>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {items.map((p) => (
          <button
            key={p.itemId}
            type="button"
            onClick={() => onAdd(toProduct(p))}
            aria-label={t("pos.also.add", { name: p.name })}
            className="flex shrink-0 items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium hover:border-primary/50 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            data-testid="also-buy-chip"
          >
            <PlusIcon className="size-3.5" aria-hidden />
            <span className="max-w-40 truncate">{p.name}</span>
            <span className="tabular-nums opacity-70">{money(p.price)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
