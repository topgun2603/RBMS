"use client";

import * as React from "react";
import Link from "next/link";
import { BlocksIcon, SearchXIcon, StoreIcon } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsContent, TabsList, TabsTrigger } from "@rbms/ui";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { SuperAdminOnly } from "@/components/superadmin-only";
import { useAppProfiles } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { useDemand, useSolutions, type Solution } from "@/lib/solutions";

export default function SolutionsPage() {
  return (
    <SuperAdminOnly>
      <Solutions />
    </SuperAdminOnly>
  );
}

/**
 * The predefined solutions (business packs) the platform sells, grouped by the app that runs them: what each is, the
 * look it starts with, its starter categories, and how many shops run it. Shops are moved between solutions from
 * Platform → Shops (row menu → Change solution). The "Not covered" tab lists the trades owners typed that have no
 * solution of their own, counted: what to build next.
 */
function Solutions() {
  const { t } = useI18n();
  const q = useSolutions();
  const demand = useDemand();
  const apps = useAppProfiles();
  const appName = new Map((apps.data ?? []).map((a) => [a.appId, a.name]));
  const byApp = new Map<string, Solution[]>();
  for (const s of q.data ?? []) byApp.set(s.appId, [...(byApp.get(s.appId) ?? []), s]);
  const total = (q.data ?? []).reduce((n, s) => n + s.shops, 0);
  // Each look's heading font, so the cards show the solutions in their own type.
  const fonts = [...new Set((q.data ?? []).map((s) => s.preset?.fontHeading).filter((f): f is string => !!f && /^[A-Za-z0-9 -]+$/.test(f)))];
  const fontsHref = fonts.length ? `https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${f.replace(/ /g, "+")}:wght@400;700`).join("&")}&display=swap` : null;

  return (
    <Page>
      {fontsHref && <link rel="stylesheet" href={fontsHref} />}
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <BlocksIcon className="size-3.5" /> {t("admin.nav.platform")}
          </span>
        }
        title={t("admin.solutions.title")}
        description={q.data ? t("admin.solutions.summary", { count: q.data.length, shops: total }) : t("admin.solutions.subtitle")}
      />
      <Tabs defaultValue="solutions" className="grid gap-4">
        <TabsList>
          <TabsTrigger value="solutions">{t("admin.solutions.tab.solutions")}</TabsTrigger>
          <TabsTrigger value="demand" data-testid="tab-demand">
            {t("admin.solutions.tab.demand")}
            {demand.data && demand.data.items.length > 0 && <Badge variant="secondary" className="ms-1.5 font-normal">{demand.data.items.length}</Badge>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="solutions">
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-8">
            {[...byApp.entries()].map(([appId, list]) => (
              <section key={appId} className="grid gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Badge variant="outline" className="font-mono">
                    {appId}
                  </Badge>
                  {appName.get(appId) ?? appId}
                  <span className="font-normal text-muted-foreground">· {t("admin.solutions.countIn", { count: list.length })}</span>
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((s) => (
                    <SolutionCard key={s.id} s={s} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
        </TabsContent>
        <TabsContent value="demand">
          <NotCovered />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function SolutionCard({ s }: { s: Solution }) {
  const { t, locale } = useI18n();
  const p = s.preset;
  return (
    <Card className="grid gap-3 overflow-hidden p-0">
      <div className="flex h-16 items-center justify-between px-4" style={{ background: p?.background ?? "var(--muted)" }}>
        <span className="text-lg font-semibold" style={{ fontFamily: p ? `"${p.fontHeading}", serif` : undefined, color: p?.primary }}>
          {locale === "ta" ? s.nameTa : s.name}
        </span>
        {p && <span className="size-8 rounded-full ring-2 ring-white/60" style={{ background: p.primary }} title={p.name} />}
      </div>
      <div className="grid gap-2 px-4 pb-4">
        <p className="text-sm text-muted-foreground">{s.tagline}</p>
        <p className="text-xs text-muted-foreground">
          {t("admin.solutions.look")}: <span className="font-medium text-foreground">{p?.name ?? "—"}</span>
        </p>
        <div className="flex flex-wrap gap-1">
          {s.categories.slice(0, 5).map((c) => (
            <Badge key={c} variant="secondary" className="font-normal">
              {c}
            </Badge>
          ))}
        </div>
        <Link href="/platform/tenants" className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          <StoreIcon className="size-4" /> {t("admin.solutions.shops", { count: s.shops })}
        </Link>
      </div>
    </Card>
  );
}

/** "Not covered": typed trades on shops that run a general pack, most asked for first. */
function NotCovered() {
  const { t, formatDate, formatNumber } = useI18n();
  const q = useDemand();
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton className="h-64 rounded-xl" />;
  const { items, total } = q.data;
  return (
    <div className="grid gap-3" data-testid="demand-list">
      <div className="grid gap-1">
        <h2 className="text-sm font-semibold">{t("admin.solutions.demand.title")}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("admin.solutions.demand.hint")}</p>
        {items.length > 0 && <p className="text-xs text-muted-foreground">{t("admin.solutions.demand.summary", { count: items.length, shops: total })}</p>}
      </div>
      {items.length === 0 ? (
        <EmptyState icon={SearchXIcon} title={t("admin.solutions.demand.empty")} description={t("admin.solutions.demand.emptyHint")} />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.solutions.demand.trade")}</TableHead>
                <TableHead numeric>{t("admin.solutions.demand.shops")}</TableHead>
                <TableHead>{t("admin.solutions.demand.apps")}</TableHead>
                <TableHead>{t("admin.solutions.demand.last")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.label}>
                  <TableCell className="font-medium">{i.label}</TableCell>
                  <TableCell numeric>{formatNumber(i.shops)}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {i.appIds.map((a) => (
                        <Badge key={a} variant="outline" className="font-mono">
                          {a}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{i.lastAt ? formatDate(i.lastAt, { day: "numeric", month: "short", year: "numeric" }) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
