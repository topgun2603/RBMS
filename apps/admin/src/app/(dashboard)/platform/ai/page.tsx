"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { SparklesIcon } from "lucide-react";
import { EmptyState, PageHeader, Skeleton, StatCard } from "@srirealtime/ui";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { SuperAdminOnly } from "@/components/superadmin-only";
import { api } from "@/lib/api";
import { useAiT } from "@/lib/ai-messages";
import { useI18n } from "@/lib/i18n";

interface AdminAiUsage {
  period: string;
  provider: "claude" | "mock" | null;
  total: { runs: number; costMicroUsd: number; credits: number };
  items: {
    tenantId: string;
    slug: string | null;
    name: string | null;
    runs: number;
    ok: number;
    errors: number;
    blocked: number;
    inputTokens: number;
    outputTokens: number;
    costMicroUsd: number;
    credits: number;
    lastAt: string;
  }[];
}

/** The last 6 months as "YYYY-MM", newest first. */
function monthOptions(): string[] {
  const d = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/** Micro-USD (1,000,000 = $1) as dollars. */
const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(micro >= 1_000_000 ? 2 : 4)}`;

export default function AiUsagePage() {
  return (
    <SuperAdminOnly>
      <UsageTable />
    </SuperAdminOnly>
  );
}

function UsageTable() {
  const t = useAiT();
  const { formatDateTime, formatNumber } = useI18n();
  const months = React.useMemo(monthOptions, []);
  const [month, setMonth] = React.useState(months[0]!);
  const q = useQuery({ queryKey: ["platform", "ai-usage", month], queryFn: () => api.get<AdminAiUsage>("/admin/ai/usage", { month }, { tenant: null }) });

  const provider = q.data?.provider === "claude" ? t("admin.ai.providerClaude") : q.data?.provider === "mock" ? t("admin.ai.providerMock") : t("admin.ai.providerNone");
  return (
    <Page>
      <PageHeader
        title={t("admin.ai.title")}
        description={t("admin.ai.subtitle")}
        actions={
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("admin.ai.month")}</span>
            <select className="h-9 rounded-md border bg-background px-2" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={t("admin.ai.month")}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        }
      />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <div className="grid gap-6">
          <div className="grid gap-3 sm:grid-cols-4">
            <StatCard title={t("admin.ai.provider")} value={<span className="text-lg">{provider}</span>} icon={SparklesIcon} />
            <StatCard title={t("admin.ai.totalRuns")} value={formatNumber(q.data.total.runs)} />
            <StatCard title={t("admin.ai.totalCost")} value={usd(q.data.total.costMicroUsd)} />
            <StatCard title={t("admin.ai.totalCredits")} value={formatNumber(q.data.total.credits)} />
          </div>
          {q.data.items.length === 0 ? (
            <EmptyState icon={SparklesIcon} title={t("admin.ai.empty")} description={t("admin.ai.emptyHint")} />
          ) : (
            <>
              {/* Phones: one card per shop */}
              <ul className="grid gap-3 md:hidden" data-testid="ai-usage-cards">
                {q.data.items.map((r) => (
                  <li key={r.tenantId} className="rounded-xl bg-card p-4 ring-1 ring-border">
                    <p className="font-medium">{r.name ?? r.tenantId}</p>
                    <p className="text-meta text-muted-foreground">{r.slug}</p>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <dt className="text-meta text-muted-foreground">{t("admin.ai.col.runs")}</dt>
                        <dd className="tabular-nums">{formatNumber(r.runs)}</dd>
                      </div>
                      <div>
                        <dt className="text-meta text-muted-foreground">{t("admin.ai.col.cost")}</dt>
                        <dd className="tabular-nums">{usd(r.costMicroUsd)}</dd>
                      </div>
                      <div>
                        <dt className="text-meta text-muted-foreground">{t("admin.ai.col.credits")}</dt>
                        <dd className="tabular-nums">{formatNumber(r.credits)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto rounded-xl ring-1 ring-border md:block">
                <table className="w-full text-sm" data-testid="ai-usage-table">
                  <thead className="bg-muted/50 text-left text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t("admin.ai.col.shop")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("admin.ai.col.runs")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("admin.ai.col.failed")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("admin.ai.col.blocked")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("admin.ai.col.tokens")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("admin.ai.col.cost")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("admin.ai.col.credits")}</th>
                      <th className="px-3 py-2 font-medium">{t("admin.ai.col.last")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {q.data.items.map((r) => (
                      <tr key={r.tenantId}>
                        <td className="px-3 py-2">
                          <span className="font-medium">{r.name ?? r.tenantId}</span>
                          <span className="block text-meta text-muted-foreground">{r.slug}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.runs)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.errors)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.blocked)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatNumber(r.inputTokens)} / {formatNumber(r.outputTokens)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{usd(r.costMicroUsd)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.credits)}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(r.lastAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </Page>
  );
}
