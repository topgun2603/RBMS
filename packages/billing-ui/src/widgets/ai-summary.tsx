"use client";

import { Card, StatusPill } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { SparklesIcon } from "lucide-react";
import { useHasPermission } from "../lib/access";
import { useLatestSummaryCard } from "../lib/ai-insights";

/** Dashboard card: the latest daily summary (docs/ai.md). Shown to people who manage AI, only once a summary exists. */
export function AiSummaryWidget() {
  const { t, formatDate } = useI18n();
  const can = useHasPermission("ai.manage");
  const q = useLatestSummaryCard(can);
  const s = q.data;
  if (!can || !s) return null;
  return (
    <Card className="p-4" data-testid="ai-summary-card">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="icon-chip size-8 rounded-lg text-primary">
          <SparklesIcon className="size-4" />
        </span>
        <h2 className="font-semibold">{t("billing.aiins.card.title")}</h2>
        <StatusPill tone="neutral">{t("billing.aiins.card.date", { date: formatDate(s.date) })}</StatusPill>
      </div>
      <p className="text-sm">{s.narrative}</p>
      {s.actions.length > 0 && (
        <div className="mt-2 text-sm">
          <p className="font-medium">{t("billing.aiins.card.actions")}</p>
          <ul className="list-disc pl-5">
            {s.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-meta text-muted-foreground">{t(s.source === "ai" ? "billing.aiins.card.source.ai" : "billing.aiins.card.source.template")}</p>
    </Card>
  );
}
