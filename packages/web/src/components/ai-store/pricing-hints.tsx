"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDownRightIcon, ArrowUpRightIcon, Loader2Icon, SparklesIcon, TrendingUpIcon } from "lucide-react";
import { Alert, AlertDescription, Button, Skeleton, StatusPill, toast, type StatusTone } from "@srirealtime/ui";
import { api } from "../../lib/api";
import { formatPaise } from "../../lib/format";
import { describeError, useI18n } from "../../lib/i18n";
import { useAiAssistAllowed, useAiAssistStatus } from "../ai-assist/use-assist";

type Kind = "held_after_rise" | "slowed_after_rise" | "room_to_raise";
interface Win {
  from: string;
  to: string;
  units: number;
  sales: number;
  perDay: number;
  avgPrice: number;
}
export interface PricingHint {
  itemId: string;
  name: string;
  unit: string;
  kind: Kind;
  change: { date: string; oldPrice: number; newPrice: number; pct: number } | null;
  windowDays: number;
  before: Win;
  after: Win;
  shopTrend: number;
  adjusted: number;
  margin: { before: number | null; after: number | null } | null;
  evidence: string[];
  template: { en: string; ta: string };
}
interface View {
  today: string;
  count: number;
  hints: PricingHint[];
}
interface Explained {
  items: { key: string; en: string; ta: string; source: "ai" | "template" }[];
  credits: number;
}

const TONE: Record<Kind, StatusTone> = { held_after_rise: "success", slowed_after_rise: "warning", room_to_raise: "info" };
const pct = (n: number | null | undefined) => (n == null ? null : `${Math.round(n)}%`);
const r1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-IN");

/**
 * Pricing hints (Inventory / Items): items whose price changed in the last 180 days, how fast they sold before and after (two
 * windows of the same length, corrected for the shop's own trend) and the margin, plus strong sellers that may have room for a
 * small increase. Everything is computed by the software; "Explain in words" asks the light AI tier for one checked sentence
 * per item (about 1 credit). Nothing here changes a price.
 */
export function PricingHintsPanel({ itemHref }: { itemHref?: (itemId: string) => string }) {
  const { t, locale } = useI18n();
  const allowedAi = useAiAssistAllowed();
  const status = useAiAssistStatus(allowedAi);
  const listed = !!status.data?.features.some((f) => f.key === "pricing-hints");
  const q = useQuery<View>({ queryKey: ["ai", "store", "pricing-hints"], queryFn: () => api.get("/ai/store/pricing-hints"), staleTime: 60_000, retry: false });
  const [words, setWords] = React.useState<Record<string, { en: string; ta: string; source: "ai" | "template" }>>({});
  const explain = useMutation({
    mutationFn: (ids: string[]) => api.post<Explained>("/ai/store/pricing-hints/explain", { itemIds: ids }),
    onSuccess: (r) => setWords((w) => ({ ...w, ...Object.fromEntries(r.items.map((i) => [i.key, i])) })),
    onError: (e) => toast.error(describeError(e, t)),
  });
  if (q.isPending) return <Skeleton className="h-64 rounded-2xl" />;
  if (q.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{describeError(q.error, t)}</AlertDescription>
      </Alert>
    );
  }
  const hints = q.data.hints;
  return (
    <div className="grid gap-4" data-testid="pricing-hints">
      <p className="text-sm text-muted-foreground">{t("web.aiStore.price.intro")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">{t("web.aiStore.price.count", { count: hints.length })}</span>
        {allowedAi && listed && hints.length > 0 && (
          <Button type="button" size="sm" variant="outline" disabled={explain.isPending} onClick={() => explain.mutate(hints.slice(0, 12).map((h) => h.itemId))} data-testid="pricing-explain">
            {explain.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            {t("web.aiStore.price.explain")} <span className="text-muted-foreground">({t("web.aiStore.price.explainCost")})</span>
          </Button>
        )}
      </div>
      {hints.length === 0 && (
        <Alert>
          <AlertDescription>{t("web.aiStore.price.none")}</AlertDescription>
        </Alert>
      )}
      <ul className="grid gap-3">
        {hints.map((h) => {
          const w = words[h.itemId];
          const text = w ? (locale === "ta" ? w.ta : w.en) : locale === "ta" ? h.template.ta : h.template.en;
          const up = h.kind !== "slowed_after_rise";
          return (
            <li key={h.itemId} className="grid gap-2 rounded-xl border bg-card p-3.5" data-testid="pricing-hint" data-kind={h.kind}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {itemHref ? (
                    <a className="hover:underline" href={itemHref(h.itemId)}>
                      {h.name}
                    </a>
                  ) : (
                    h.name
                  )}
                </p>
                <StatusPill tone={TONE[h.kind]} icon={up ? (h.kind === "room_to_raise" ? TrendingUpIcon : ArrowUpRightIcon) : ArrowDownRightIcon}>
                  {t(`web.aiStore.price.kind.${h.kind}`)}
                </StatusPill>
              </div>
              {h.change && <p className="text-sm text-muted-foreground">{t("web.aiStore.price.change", { from: formatPaise(h.change.oldPrice), to: formatPaise(h.change.newPrice), date: h.change.date })}</p>}
              <p className="text-sm" lang={locale} data-testid="pricing-hint-text">
                {text}
              </p>
              {w && <p className="text-xs text-muted-foreground">{w.source === "ai" ? t("web.aiStore.price.explained") : t("web.aiStore.price.templateNote")}</p>}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("web.aiStore.price.perDay")}: {t("web.aiStore.price.before")}</dt>
                  <dd className="tabular-nums">{r1(h.before.perDay)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("web.aiStore.price.perDay")}: {t("web.aiStore.price.after")}</dt>
                  <dd className="tabular-nums">{r1(h.after.perDay)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("web.aiStore.price.adjusted")}</dt>
                  <dd className="tabular-nums">{Math.round(h.adjusted * 100)}%</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("web.aiStore.price.margin")}</dt>
                  <dd className="tabular-nums">
                    {h.margin && (h.margin.before != null || h.margin.after != null) ? [pct(h.margin.before), pct(h.margin.after)].filter(Boolean).join(" → ") : t("web.aiStore.price.noMargin")}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                {t("web.aiStore.price.unitsWindow", { units: h.before.units, days: h.windowDays })} · {t("web.aiStore.price.unitsWindow", { units: h.after.units, days: h.windowDays })}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t("web.aiStore.price.never")}</p>
    </div>
  );
}
