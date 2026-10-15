"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@srirealtime/ui/components/dialog";
import { motion } from "@srirealtime/ui/motion";
import { STORE_PATHS } from "@srirealtime/cms/seo";
import { percentOff } from "../lib/format";
import type { Availability, List, Product } from "../types";
import { Bone } from "../components/skeletons";
import { SizeChart, sizeKindFor } from "../components/size-guide";
import { call } from "./api";
import { ProductGallery } from "./product-gallery";
import { PurchasePanel, type AvailabilityMap } from "./purchase-panel";
import { useStore } from "./store-context";

/** Quick view from product cards: gallery, variant picker, add to cart — without leaving the listing. */
export function QuickView({ slug, onClose }: { slug: string | null; onClose: () => void }) {
  const { t } = useStore();
  const [last, setLast] = React.useState(slug);
  React.useEffect(() => {
    if (slug) setLast(slug);
  }, [slug]);
  const active = slug ?? last;
  const product = useQuery({
    queryKey: ["product", active],
    queryFn: () => call<Product>(`/catalog/public/products/${encodeURIComponent(active!)}`, { auth: false }),
    enabled: !!active,
    staleTime: 60_000,
  });
  const p = product.data;
  const avail = useQuery({
    queryKey: ["availability", p?.id],
    queryFn: () => call<List<Availability>>("/inventory/public/availability", { query: { itemIds: p!.variants.map((v) => v.id).join(",") }, auth: false }).catch(() => ({ items: [], total: 0 })),
    enabled: !!p,
    staleTime: 15_000,
  });
  const availability: AvailabilityMap = Object.fromEntries((avail.data?.items ?? []).map((a) => [a.itemId, { inStock: a.inStock, lowStock: a.lowStock }]));
  const def = p ? (p.variants.find((v) => v.isDefault) ?? p.variants[0]) : undefined;
  const pct = p ? percentOff(def?.price ?? p.priceMin, def?.mrp) : 0;

  return (
    <Dialog open={!!slug} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto rounded-3xl p-0 sm:max-w-4xl" closeLabel={t("common.close")} data-testid="quick-view">
        <DialogTitle className="sr-only">{p?.name ?? t("product.quickView")}</DialogTitle>
        <DialogDescription className="sr-only">{t("product.quickView")}</DialogDescription>
        {!p || !avail.isFetched ? (
          <div className="grid gap-6 p-5 sm:grid-cols-2 sm:p-6" aria-busy>
            <Bone className="aspect-[4/5] rounded-2xl" />
            <div className="grid content-start gap-4">
              <Bone className="h-3 w-24 rounded-full" />
              <Bone className="h-8 w-3/4" />
              <Bone className="h-8 w-32" />
              <Bone className="h-11 w-56" />
              <Bone className="h-12 rounded-full" />
            </div>
          </div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }} className="grid gap-6 p-5 sm:grid-cols-2 sm:p-6">
            <div className="min-w-0 [&_[data-gallery-main]]:rounded-2xl">
              <ProductGallery images={p.images} name={p.name} badge={pct > 0 ? t("product.off", { pct }) : undefined} compact />
            </div>
            <div className="grid min-w-0 content-start gap-5 sm:pe-6">
              <div>
                {(p.brand || p.categoryName) && <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">{p.brand ?? p.categoryName}</p>}
                <h2 className="mt-1 font-display text-h3 leading-tight font-semibold sm:text-2xl">{p.name}</h2>
              </div>
              <PurchasePanel product={p} availability={availability} compact onAdded={onClose} sizeGuide={<SizeChart kind={sizeKindFor(p.categoryName, p.name)} t={t} />} />
              <Link href={STORE_PATHS.product(p.slug)} onClick={onClose} className="group inline-flex items-center gap-1.5 text-sm font-semibold text-primary focus-ring">
                {t("product.fullDetails")}
                <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </motion.div>
        )}
      </DialogContent>
    </Dialog>
  );
}
