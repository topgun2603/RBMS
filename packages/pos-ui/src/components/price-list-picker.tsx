"use client";

import { useI18n } from "@rbms/web";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@rbms/ui";
import { TagsIcon } from "lucide-react";
import type { PricingCache } from "../lib/units";

/**
 * The bill's price list at the counter: the customer's (automatic), item prices, or a named list (docs/price-lists-units.md).
 * Works offline from the cached lists; hidden when the shop has none.
 */
export function PriceListPicker({ pricing, value, onChange, autoName }: { pricing: PricingCache | null; value: string; onChange: (v: string) => void; autoName: string | null }) {
  const { t } = useI18n();
  const lists = pricing?.lists ?? [];
  if (lists.length === 0) return null;
  return (
    <div className="flex items-center gap-2 px-1 text-sm">
      <TagsIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <Select value={value || "auto"} onValueChange={(v) => onChange(v === "auto" ? "" : v)}>
        <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label={t("pos.priceList.label")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">{autoName ? t("pos.priceList.autoNamed", { name: autoName }) : t("pos.priceList.auto")}</SelectItem>
          <SelectItem value="none">{t("pos.priceList.none")}</SelectItem>
          {lists.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
