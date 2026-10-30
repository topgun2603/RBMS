"use client";

import * as React from "react";
import { ClipboardListIcon, Loader2Icon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { describeError, QueryError, useI18n, useModuleNavigate } from "@rbms/web";
import {
  Button,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  toast,
} from "@rbms/ui";
import { useIsPhone } from "../inventory/stock-meta";
import { formatQty } from "../../lib/format";
import { useCreateDraftPo, useReorderSuggestions, type ReorderItem } from "../../lib/ai-insights";
import { useSuppliers } from "../../lib/queries-v2";

interface Pick {
  on: boolean;
  qty: string;
}

/**
 * "Reorder suggestions": per group, the items to buy with quantity and reason. Every quantity is calculated by the API
 * from the shop's sales and stock; AI only words the one-line reason per group. "Create purchase order" makes a DRAFT order
 * through the normal route and opens it: nothing is ordered until the owner sends it.
 */
export function ReorderSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, locale } = useI18n();
  const phone = useIsPhone();
  const navigate = useModuleNavigate();
  const lang = locale === "ta" ? "ta" : "en";
  const q = useReorderSuggestions(lang, open);
  const suppliers = useSuppliers("");
  const create = useCreateDraftPo();
  const [picks, setPicks] = React.useState<Record<string, Pick>>({});
  const [supplierId, setSupplierId] = React.useState<string>("");

  const all = React.useMemo(() => q.data?.groups.flatMap((g) => g.items) ?? [], [q.data]);
  React.useEffect(() => {
    if (!q.data) return;
    setPicks(Object.fromEntries(all.map((i) => [i.itemId, { on: true, qty: String(i.qty) }])));
  }, [q.data, all]);

  const chosen = all.filter((i) => picks[i.itemId]?.on && Number(picks[i.itemId]?.qty) > 0);
  // The supplier most of the chosen items were last bought from.
  const suggested = React.useMemo(() => {
    const count = new Map<string, number>();
    for (const i of chosen) if (i.supplierId) count.set(i.supplierId, (count.get(i.supplierId) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }, [chosen]);
  const effectiveSupplier = supplierId || suggested;

  const make = async () => {
    if (!effectiveSupplier) {
      toast.error(t("billing.aiins.reorder.needSupplier"));
      return;
    }
    try {
      const po = await create.mutateAsync({
        supplierId: effectiveSupplier,
        notes: t("billing.aiins.reorder.draftNote"),
        lines: chosen.map((i) => ({
          itemId: i.itemId,
          description: i.name,
          qty: Number(picks[i.itemId]!.qty),
          unit: i.unit || undefined,
          hsn: i.hsn || undefined,
          rate: i.lastRate ?? 0,
          gstRate: i.gstRate ?? 0,
        })),
      });
      toast.success(t("billing.aiins.reorder.created", { number: po.number }));
      onOpenChange(false);
      navigate(`purchase-orders/${po.id}`);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const festival = q.data?.festivals[0];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={phone ? "bottom" : "right"} closeLabel={t("billing.common.close")} className={phone ? "max-h-[90dvh] gap-0 rounded-t-3xl bg-page" : "w-full gap-0 bg-page sm:max-w-xl"}>
        <SheetHeader className="border-b bg-card">
          <div className="flex items-center gap-3 pr-8">
            <span className="icon-chip size-10 rounded-xl text-primary">
              <SparklesIcon className="size-5" />
            </span>
            <div className="min-w-0">
              <SheetTitle>{t("billing.aiins.reorder.title")}</SheetTitle>
              <SheetDescription>{t("billing.aiins.reorder.subtitle")}</SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="reorder-body">
          {q.isError ? (
            <QueryError error={q.error} onRetry={() => void q.refetch()} />
          ) : q.isPending ? (
            <div className="grid gap-3" aria-busy="true">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" /> {t("billing.aiins.reorder.loading")}
              </p>
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </div>
          ) : q.data.total === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("billing.aiins.reorder.none")}</p>
          ) : (
            <div className="grid gap-4">
              <p className="text-meta text-muted-foreground">
                {t("billing.aiins.reorder.history", { days: q.data.historyDays })}{" "}
                {festival && (
                  <>
                    {t("billing.aiins.reorder.festival", { name: lang === "ta" ? festival.nameTa : festival.name, days: festival.daysAway })}{" "}
                    {festival.hasLastYearData ? t("billing.aiins.reorder.festivalData") : t("billing.aiins.reorder.festivalNoData")}
                  </>
                )}
              </p>
              {q.data.aiNote ? <p className="rounded-xl bg-muted/50 p-2 text-meta text-muted-foreground">{t("billing.aiins.reorder.aiOff")}</p> : <p className="text-meta text-muted-foreground">{t("billing.aiins.reorder.aiBanner")}</p>}
              {q.data.groups.map((g) => (
                <section key={g.group} className="rounded-2xl bg-card p-3 ring-1 ring-border ring-inset" data-group={g.group}>
                  <h3 className="font-medium">
                    {t(`billing.aiins.reorder.group.${g.group}`)} <span className="text-muted-foreground">({g.count})</span>
                  </h3>
                  {g.reason && <p className="mb-2 text-sm text-muted-foreground">{g.reason}</p>}
                  <ul className="grid gap-2">
                    {g.items.map((i) => (
                      <ItemRow key={i.itemId} item={i} pick={picks[i.itemId]} lang={lang} onChange={(p) => setPicks((s) => ({ ...s, [i.itemId]: p }))} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
        {q.data && q.data.total > 0 && (
          <div className="grid gap-2 border-t bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("billing.aiins.reorder.supplier")}</span>
              <Select value={effectiveSupplier} onValueChange={setSupplierId}>
                <SelectTrigger className="min-w-48 flex-1" aria-label={t("billing.aiins.reorder.supplier")}>
                  <SelectValue placeholder={t("billing.aiins.reorder.supplierPick")} />
                </SelectTrigger>
                <SelectContent>
                  {(suppliers.data?.items ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">{t("billing.aiins.reorder.selected", { count: chosen.length })}</span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
                  <RefreshCwIcon className={q.isFetching ? "animate-spin" : undefined} /> {t("billing.aiins.reorder.refresh")}
                </Button>
                <Button type="button" size="sm" disabled={chosen.length === 0 || create.isPending} onClick={() => void make()}>
                  {create.isPending ? <Loader2Icon className="animate-spin" /> : <ClipboardListIcon />}
                  {create.isPending ? t("billing.aiins.reorder.creating") : t("billing.aiins.reorder.create")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ItemRow({ item, pick, lang, onChange }: { item: ReorderItem; pick: Pick | undefined; lang: "en" | "ta"; onChange: (p: Pick) => void }) {
  const { t } = useI18n();
  const p = pick ?? { on: true, qty: String(item.qty) };
  return (
    <li className="flex items-start gap-3 rounded-xl bg-muted/30 p-2">
      <Checkbox checked={p.on} onCheckedChange={(on) => onChange({ ...p, on: on === true })} aria-label={item.name} className="mt-1" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{item.name}</p>
        <p className="text-meta text-muted-foreground">
          {item.daysCover !== null
            ? t("billing.aiins.reorder.item.detail", { stock: formatQty(item.stock), rate: formatQty(item.avgDaily), cover: formatQty(item.daysCover) })
            : t("billing.aiins.reorder.item.detailNone", { stock: formatQty(item.stock), rate: formatQty(item.avgDaily) })}
        </p>
        {item.festival && <p className="text-meta text-primary">{t("billing.aiins.reorder.item.festival", { name: lang === "ta" ? item.festival.nameTa : item.festival.name, ratio: String(item.festival.ratio) })}</p>}
        {item.lastRate === null && <p className="text-meta text-muted-foreground">{t("billing.aiins.reorder.noRate")}</p>}
      </div>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          className="h-9 w-20 text-right tabular-nums"
          value={p.qty}
          aria-label={t("billing.aiins.reorder.item.qty", { name: item.name })}
          onChange={(e) => onChange({ ...p, qty: e.target.value })}
        />
        <span className="w-8 text-meta text-muted-foreground">{item.unit}</span>
      </div>
    </li>
  );
}
