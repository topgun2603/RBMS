"use client";

import { describeError, ModuleLink, useI18n } from "@rbms/web";
import { Card, CardContent, CardHeader, CardTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@rbms/ui";
import { TagsIcon } from "lucide-react";
import { useHasPermission } from "../../lib/access";
import { useCustomerGroups, useCustomerPricing, usePriceLists, usePriceListsOn, useSaveCustomerPricing } from "../../lib/queries-pricing";

const NONE = "__none";

/** A customer's group and own price list (docs/price-lists-units.md). Hidden without the price-lists feature. */
export function CustomerPricingCard({ customerId }: { customerId: string }) {
  const { t } = useI18n();
  const on = usePriceListsOn();
  const canEdit = useHasPermission("customers.create");
  const pricing = useCustomerPricing(customerId);
  const lists = usePriceLists();
  const groups = useCustomerGroups();
  const save = useSaveCustomerPricing(customerId);
  if (!on || !pricing.data) return null;
  const p = pricing.data;
  const set = (body: { groupId?: string | null; priceListId?: string | null }) =>
    save.mutateAsync(body).then(
      () => toast.success(t("billing.pl.customer.saved")),
      (err: unknown) => toast.error(describeError(err, t)),
    );

  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="icon-chip size-8 text-primary">
            <TagsIcon className="size-4" />
          </span>
          {t("billing.pl.customer.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <div className="grid gap-1.5">
          <label htmlFor="cp-group" className="text-xs text-muted-foreground">
            {t("billing.pl.customer.group")}
          </label>
          <Select value={p.groupId ?? NONE} disabled={!canEdit || save.isPending} onValueChange={(v) => void set({ groupId: v === NONE ? null : v })}>
            <SelectTrigger id="cp-group" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("billing.pl.customer.noGroup")}</SelectItem>
              {(groups.data?.items ?? []).map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="cp-list" className="text-xs text-muted-foreground">
            {t("billing.pl.customer.list")}
          </label>
          <Select value={p.priceListId ?? NONE} disabled={!canEdit || save.isPending} onValueChange={(v) => void set({ priceListId: v === NONE ? null : v })}>
            <SelectTrigger id="cp-list" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("billing.pl.customer.fromGroup")}</SelectItem>
              {(lists.data?.items ?? []).map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground">
          {p.effectiveListName ? t("billing.pl.customer.billsAt", { name: p.effectiveListName }) : t("billing.pl.customer.billsAtItem")}{" "}
          <ModuleLink to="price-lists" className="text-primary hover:underline">
            {t("billing.pl.customer.manage")}
          </ModuleLink>
        </p>
      </CardContent>
    </Card>
  );
}
