"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { WandSparklesIcon } from "lucide-react";
import { EmptyState, PageHeader, Skeleton, StatCard } from "@srirealtime/ui";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { SuperAdminOnly } from "@/components/superadmin-only";
import { api } from "@/lib/api";
import { useAiT } from "@/lib/ai-messages";
import { useI18n } from "@/lib/i18n";

interface FeatureRequests {
  total: number;
  byTheme: { theme: string; count: number; shops: number }[];
  items: { id: string; tenantId: string; shop: string | null; slug: string | null; trade: string; request: string; language: string; missing: string; theme: string; createdAt: string }[];
}

const RANGES = [
  { key: "range30", days: 30 },
  { key: "range90", days: 90 },
  { key: "rangeAll", days: 0 },
] as const;

/** Platform > Studio feature requests: what owners asked the Studio assistant for that the platform cannot do yet, by theme. */
export default function StudioRequestsPage() {
  return (
    <SuperAdminOnly>
      <Requests />
    </SuperAdminOnly>
  );
}

function Requests() {
  const t = useAiT();
  const { formatDateTime, formatNumber } = useI18n();
  const [days, setDays] = React.useState<number>(90);
  const q = useQuery({
    queryKey: ["platform", "studio-requests", days],
    queryFn: () => api.get<FeatureRequests>("/admin/ai/studio/feature-requests", days ? { days } : {}, { tenant: null }),
  });
  const theme = (k: string) => (t.has(`admin.ai.studio.theme.${k}`) ? t(`admin.ai.studio.theme.${k}`) : k);
  return (
    <Page>
      <PageHeader
        title={t("admin.ai.studio.title")}
        description={t("admin.ai.studio.subtitle")}
        actions={
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("admin.ai.studio.range")}</span>
            <select className="h-9 rounded-md border bg-background px-2" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t("admin.ai.studio.range")}>
              {RANGES.map((r) => (
                <option key={r.key} value={r.days}>
                  {t(`admin.ai.studio.${r.key}`)}
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
      ) : q.data.total === 0 ? (
        <EmptyState icon={WandSparklesIcon} title={t("admin.ai.studio.empty")} description={t("admin.ai.studio.emptyHint")} />
      ) : (
        <div className="grid gap-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard title={t("admin.ai.studio.total")} value={formatNumber(q.data.total)} icon={WandSparklesIcon} />
            <StatCard title={t("admin.ai.studio.themes")} value={formatNumber(new Set(q.data.items.map((i) => i.tenantId)).size)} />
            <StatCard title={t("admin.ai.studio.col.theme")} value={<span className="text-lg">{theme(q.data.byTheme[0]?.theme ?? "other")}</span>} />
          </div>

          <section className="grid gap-2" aria-labelledby="studio-themes">
            <h2 id="studio-themes" className="text-sm font-semibold">
              {t("admin.ai.studio.byTheme")}
            </h2>
            <ul className="grid gap-2" data-testid="studio-theme-counts">
              {q.data.byTheme.map((b) => (
                <li key={b.theme} className="grid gap-1 rounded-xl bg-card p-3 ring-1 ring-border">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{theme(b.theme)}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatNumber(b.count)} · {formatNumber(b.shops)} {t("admin.ai.studio.themes").toLowerCase()}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, Math.round((100 * b.count) / q.data.byTheme[0]!.count))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-2" aria-labelledby="studio-recent">
            <h2 id="studio-recent" className="text-sm font-semibold">
              {t("admin.ai.studio.recent")}
            </h2>
            <ul className="grid gap-2 md:hidden" data-testid="studio-request-cards">
              {q.data.items.map((r) => (
                <li key={r.id} className="grid gap-1 rounded-xl bg-card p-3 text-sm ring-1 ring-border">
                  <p className="font-medium break-words">{r.request}</p>
                  <p className="text-muted-foreground break-words">{r.missing}</p>
                  <p className="text-meta text-muted-foreground">
                    {theme(r.theme)} · {r.shop ?? r.tenantId}
                    {r.trade ? ` · ${r.trade}` : ""} · {formatDateTime(r.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto rounded-xl ring-1 ring-border md:block">
              <table className="w-full text-sm" data-testid="studio-request-table">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("admin.ai.studio.col.shop")}</th>
                    <th className="px-3 py-2 font-medium">{t("admin.ai.studio.col.request")}</th>
                    <th className="px-3 py-2 font-medium">{t("admin.ai.studio.col.missing")}</th>
                    <th className="px-3 py-2 font-medium">{t("admin.ai.studio.col.theme")}</th>
                    <th className="px-3 py-2 font-medium">{t("admin.ai.studio.col.when")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {q.data.items.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="px-3 py-2">
                        <span className="font-medium">{r.shop ?? r.tenantId}</span>
                        <span className="block text-meta text-muted-foreground">{[r.slug, r.trade].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td className="max-w-[18rem] px-3 py-2 break-words">{r.request}</td>
                      <td className="max-w-[18rem] px-3 py-2 break-words text-muted-foreground">{r.missing}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{theme(r.theme)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </Page>
  );
}
