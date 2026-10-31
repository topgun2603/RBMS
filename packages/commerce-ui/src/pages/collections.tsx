"use client";

import * as React from "react";
import { EyeOffIcon, HandIcon, LayersIcon, PlusIcon, SparklesIcon } from "lucide-react";
import { Button, Card, cn, EmptyState, Skeleton, Stagger, StaggerItem, StatusPill } from "@rbms/ui";
import { ModuleLink, Page, PageHeading, QueryError, SearchField, useDebounced, useI18n } from "@rbms/web";
import { ProductThumb } from "../components/bits";
import { CollectionsIllustration } from "../components/illustrations";
import { useCanManageCatalogue } from "../lib/access";
import { money } from "../lib/format";
import { useCategories, useCollections } from "../lib/queries";
import type { Collection } from "../lib/types";

export default function CollectionsPage() {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const debounced = useDebounced(q.trim(), 300);
  const list = useCollections(debounced);
  const categories = useCategories();
  const canManage = useCanManageCatalogue();
  const items = list.data?.items ?? [];

  const addButton = canManage ? (
    <Button asChild size="lg">
      <ModuleLink to="collections/new">
        <PlusIcon /> {t("commerce.collections.add")}
      </ModuleLink>
    </Button>
  ) : null;

  const ruleSummary = (c: Collection) => {
    const r = c.rule;
    if (!r) return t("commerce.collections.ruleNone");
    const parts: string[] = [];
    if (r.categoryId) parts.push(categories.data?.find((x) => x.id === r.categoryId)?.name ?? t("commerce.collections.someCategory"));
    if (r.tag) parts.push(`#${r.tag}`);
    if (r.priceMax !== null && r.priceMax !== undefined) parts.push(t("commerce.collections.under", { price: money(r.priceMax) }));
    if (r.onSale) parts.push(t("commerce.collections.onSale"));
    return parts.length ? parts.join(" · ") : t("commerce.collections.ruleAll");
  };

  return (
    <Page>
      <PageHeading icon={LayersIcon} title={t("commerce.collections.title")} description={t("commerce.collections.subtitle")} actions={addButton} />
      <SearchField className="mb-4" value={q} onChange={setQ} placeholder={t("commerce.collections.search")} />

      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Card key={i} className="gap-3 overflow-hidden py-0">
              <Skeleton className="aspect-[16/9] w-full rounded-none" />
              <div className="space-y-2 p-4 pt-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          illustration={debounced ? undefined : <CollectionsIllustration />}
          icon={LayersIcon}
          title={debounced ? t("commerce.collections.noMatch") : t("commerce.collections.emptyTitle")}
          description={debounced ? undefined : t("commerce.collections.emptyBody")}
          action={addButton}
        />
      ) : (
        <Stagger key={debounced} className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3 transition-opacity", list.isPlaceholderData && "opacity-60")}>
          {items.map((c) => (
            <StaggerItem key={c.id}>
              <ModuleLink
                to={`collections/${c.id}`}
                className="group block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="h-full gap-0 overflow-hidden py-0 transition-[transform,box-shadow] group-hover:-translate-y-0.5 group-hover:shadow-raised motion-reduce:group-hover:translate-y-0">
                  <div className="relative">
                    <ProductThumb src={c.imageUrl} alt="" className="aspect-[16/9] size-auto w-full rounded-none ring-0" />
                    <span className="absolute top-2 left-2">
                      <StatusPill tone={c.type === "rule" ? "info" : "brand"} icon={c.type === "rule" ? SparklesIcon : HandIcon} className="bg-card/90 backdrop-blur">
                        {t(`commerce.collections.type.${c.type}`)}
                      </StatusPill>
                    </span>
                  </div>
                  <div className="grid gap-1 p-4">
                    <p className="flex items-center gap-2 font-medium group-hover:text-primary">
                      <span className="truncate">{c.name}</span>
                      {!c.active && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                          <EyeOffIcon className="size-3" /> {t("commerce.collections.hidden")}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-meta text-muted-foreground">
                      {c.type === "manual" ? t("commerce.collections.productCount", { count: c.productIds.length }) : ruleSummary(c)}
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground/80">/collections/{c.slug}</p>
                  </div>
                </Card>
              </ModuleLink>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </Page>
  );
}
