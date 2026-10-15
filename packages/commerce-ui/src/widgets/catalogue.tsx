"use client";

import * as React from "react";
import { AlertTriangleIcon, ArrowRightIcon, CheckCircle2Icon, PackageIcon, PencilLineIcon, PlusIcon } from "lucide-react";
import { AnimatedNumber, Button, Card, CardContent, CardHeader, CardTitle, cn, Skeleton } from "@srirealtime/ui";
import { joinPath, ModuleLink, QueryError, useFeature, useI18n, useOptionalWebApp } from "@srirealtime/web";
import { useProductCounts, useStockSummary } from "../lib/queries";

/** Dashboard card: products, drafts and (with inventory) low / out-of-stock variants. */
export function CatalogueWidget() {
  const { t } = useI18n();
  const counts = useProductCounts();
  const inventory = useFeature("inventory");
  const stock = useStockSummary(inventory);
  const c = counts.data;
  const lowTotal = (stock.data?.lowCount ?? 0) + (stock.data?.outCount ?? 0);
  // The stock screen belongs to whichever module the host mounted for it (billing's "stock" page); never hard-code it.
  const app = useOptionalWebApp();
  const stockModule = app?.modules.find((m) => m.routes.some((r) => r.path === "stock"));
  const stockHref = stockModule ? joinPath(stockModule.basePath, "stock?filter=low") : null;

  return (
    <Card className="h-full gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4 sm:px-5">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="icon-chip size-8 text-primary">
            <PackageIcon className="size-4" />
          </span>
          {t("commerce.widget.title")}
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <ModuleLink to="products">
            {t("commerce.widget.view")} <ArrowRightIcon />
          </ModuleLink>
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3 px-4 sm:px-5">
        {counts.isError ? (
          <QueryError compact error={counts.error} onRetry={() => void counts.refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Tile
                to="products?status=active"
                label={t("commerce.widget.active")}
                value={c?.active}
                loading={counts.isPending}
                icon={CheckCircle2Icon}
                tone="text-success-ink"
              />
              <Tile to="products?status=draft" label={t("commerce.widget.drafts")} value={c?.draft} loading={counts.isPending} icon={PencilLineIcon} tone="text-warning-ink" />
            </div>
            {inventory && (
              <ModuleLink
                {...(stockHref ? { href: stockHref } : { to: "products" })}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
                  lowTotal > 0 ? "border-warning/40 bg-warning/10" : "border-success/30 bg-success/10",
                )}
              >
                {stock.isPending ? (
                  <Skeleton className="h-4 w-40" />
                ) : lowTotal > 0 ? (
                  <>
                    <AlertTriangleIcon className="size-4 shrink-0 text-warning-ink" />
                    <span className="flex-1">{t("commerce.widget.lowStock", { low: stock.data?.lowCount ?? 0, out: stock.data?.outCount ?? 0 })}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2Icon className="size-4 shrink-0 text-success-ink" />
                    <span className="flex-1 text-success-ink">{t("commerce.widget.stockOk")}</span>
                  </>
                )}
              </ModuleLink>
            )}
            <Button asChild className="h-11 w-full">
              <ModuleLink to="products/new">
                <PlusIcon /> {t("commerce.products.add")}
              </ModuleLink>
            </Button>
            {c && <p className="text-center text-xs text-muted-foreground">{t("commerce.widget.total", { count: c.all })}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Tile({
  to,
  label,
  value,
  loading,
  icon: Icon,
  tone,
}: {
  to: string;
  label: string;
  value: number | undefined;
  loading: boolean;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}) {
  return (
    <ModuleLink to={to} className="grid gap-1 rounded-xl border bg-muted/20 px-3 py-2.5 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={cn("size-3.5", tone)} /> {label}
      </span>
      {loading || value === undefined ? (
        <Skeleton className="h-7 w-12" />
      ) : (
        <AnimatedNumber value={value} from={0} className="font-heading text-2xl font-bold tabular-nums" />
      )}
    </ModuleLink>
  );
}
