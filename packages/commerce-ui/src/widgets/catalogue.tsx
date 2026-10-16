"use client";

import * as React from "react";
import { CheckCircle2Icon, PackageIcon, PencilLineIcon } from "lucide-react";
import { AnimatedNumber, cn } from "@srirealtime/ui";
import { InsightCard, ModuleLink, QueryError, useI18n } from "@srirealtime/web";
import { useProductCounts } from "../lib/queries";

/** "More insights" card: products in the catalogue, with active and draft counts. */
export function CatalogueWidget() {
  const { t } = useI18n();
  const counts = useProductCounts();
  const c = counts.data;
  if (counts.isError)
    return (
      <InsightCard icon={PackageIcon} title={t("commerce.widget.title")} to="products" linkLabel={t("commerce.widget.view")}>
        <QueryError compact error={counts.error} onRetry={() => void counts.refetch()} />
      </InsightCard>
    );
  return (
    <InsightCard
      icon={PackageIcon}
      title={t("commerce.widget.title")}
      to="products"
      linkLabel={t("commerce.widget.view")}
      loading={counts.isPending}
      value={c && <AnimatedNumber value={c.all} from={0} />}
      caption={c && t("commerce.widget.total", { count: c.all })}
    >
      {c && (
        <div className="flex flex-wrap gap-2">
          <Chip to="products?status=active" icon={CheckCircle2Icon} tone="text-success-ink" label={t("commerce.widget.active")} value={c.active} />
          <Chip to="products?status=draft" icon={PencilLineIcon} tone="text-warning-ink" label={t("commerce.widget.drafts")} value={c.draft} />
        </div>
      )}
    </InsightCard>
  );
}

function Chip({ to, icon: Icon, tone, label, value }: { to: string; icon: React.ComponentType<{ className?: string }>; tone: string; label: string; value: number }) {
  return (
    <ModuleLink
      to={to}
      className="inline-flex items-center gap-1.5 rounded-full border bg-muted/30 px-2.5 py-1 text-xs outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className={cn("size-3.5", tone)} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </ModuleLink>
  );
}
