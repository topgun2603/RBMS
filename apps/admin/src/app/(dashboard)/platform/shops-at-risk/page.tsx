"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOffIcon, CheckIcon, EyeOffIcon, PhoneIcon, StickyNoteIcon, TrendingDownIcon } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  PageHeader,
  Skeleton,
  StatCard,
  StatusPill,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { SuperAdminOnly } from "@/components/superadmin-only";
import { api } from "@/lib/api";
import { describeError, useI18n } from "@/lib/i18n";
import { usePlatformT } from "@/lib/platform-messages";

type Filter = "at-risk" | "contacted" | "snoozed" | "all";
interface Reason {
  code: string;
  weight: number;
  en: string;
  ta: string;
}
interface FollowupNote {
  at: string;
  byName: string | null;
  kind: "contacted" | "note" | "snooze" | "unsnooze" | "ignore" | "unignore";
  text: string;
  until?: string | null;
}
interface RiskItem {
  tenantId: string;
  shop: { slug: string; name: string; appId: string | null; trade: string | null; planId: string | null; createdAt: string; owner: { name: string | null; phone: string | null; email: string | null } | null };
  score: number;
  level: "high" | "watch" | "low";
  reasons: Reason[];
  baseline: number | null;
  weeks: number[];
  newShop: boolean;
  followup: { contactedAt: string | null; snoozedUntil: string | null; ignored: boolean; notes: FollowupNote[] } | null;
}
interface Churn {
  counts: { shops: number; high: number; watch: number; demo: number; left: number; snoozed: number };
  items: RiskItem[];
}

const FILTERS: Filter[] = ["at-risk", "contacted", "snoozed", "all"];
const KEY = ["platform", "churn"] as const;

/** Platform > Shops at risk: churn signals computed in code (no AI), with call / note / snooze actions. */
export default function ShopsAtRiskPage() {
  return (
    <SuperAdminOnly>
      <Risk />
    </SuperAdminOnly>
  );
}

function Risk() {
  const t = usePlatformT();
  const { formatNumber } = useI18n();
  const [filter, setFilter] = React.useState<Filter>("at-risk");
  const q = useQuery({ queryKey: [...KEY, filter], queryFn: () => api.get<Churn>("/admin/platform/churn", { filter }, { tenant: null }) });
  return (
    <Page>
      <PageHeader
        title={t("admin.pt.risk.title")}
        description={t("admin.pt.risk.subtitle")}
        actions={
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("admin.pt.risk.filter")}</span>
            <select className="h-9 rounded-md border bg-background px-2" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label={t("admin.pt.risk.filter")}>
              {FILTERS.map((f) => (
                <option key={f} value={f}>
                  {t(`admin.pt.risk.filter.${f}`)}
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard title={t("admin.pt.risk.high")} value={formatNumber(q.data.counts.high)} icon={TrendingDownIcon} />
            <StatCard title={t("admin.pt.risk.watch")} value={formatNumber(q.data.counts.watch)} />
            <StatCard title={t("admin.pt.risk.filter.snoozed")} value={formatNumber(q.data.counts.snoozed)} />
            <StatCard title={t("admin.pt.risk.demo")} value={formatNumber(q.data.counts.demo)} />
          </div>
          {q.data.items.length === 0 ? (
            <EmptyState icon={TrendingDownIcon} title={t("admin.pt.risk.empty")} description={t("admin.pt.risk.emptyHint")} />
          ) : (
            <ul className="grid gap-3" data-testid="risk-list">
              {q.data.items.map((it) => (
                <ShopCard key={it.tenantId} it={it} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Page>
  );
}

function Sparkline({ weeks, label }: { weeks: number[]; label: string }) {
  const max = Math.max(1, ...weeks);
  return (
    <div className="flex h-8 items-end gap-0.5" role="img" aria-label={`${label}: ${weeks.join(", ")}`}>
      {weeks.map((w, i) => (
        <span key={i} className={i >= weeks.length - 2 ? "w-2 rounded-sm bg-primary" : "w-2 rounded-sm bg-muted-foreground/40"} style={{ height: `${Math.max(6, Math.round((100 * w) / max))}%` }} />
      ))}
    </div>
  );
}

function ShopCard({ it }: { it: RiskItem }) {
  const t = usePlatformT();
  const { locale, formatDate, formatDateTime, t: tt } = useI18n();
  const qc = useQueryClient();
  const [noting, setNoting] = React.useState(false);
  const [note, setNote] = React.useState("");
  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/admin/platform/churn/${it.tenantId}/followup`, body, { tenant: null }),
    onSuccess: () => {
      toast.success(t("admin.pt.risk.done"));
      setNoting(false);
      setNote("");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(describeError(e, tt)),
  });
  const f = it.followup;
  const phone = it.shop.owner?.phone ?? null;
  return (
    <li className="grid gap-3 rounded-xl bg-card p-4 ring-1 ring-border" data-testid="risk-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium break-words">{it.shop.name}</p>
          <p className="text-meta text-muted-foreground">
            {[it.shop.slug, it.shop.appId, it.shop.trade, it.shop.planId].filter(Boolean).join(" · ")} · {t("admin.pt.risk.signedUp", { date: formatDate(it.shop.createdAt) })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone={it.level === "high" ? "danger" : it.level === "watch" ? "warning" : "neutral"}>{t(`admin.pt.risk.${it.level}`)}</StatusPill>
          <span className="text-sm tabular-nums text-muted-foreground">{t("admin.pt.risk.score", { score: it.score })}</span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <ul className="grid list-disc gap-1 pl-5 text-sm">
          {it.reasons.map((r) => (
            <li key={r.code + r.en} lang={locale === "ta" ? "ta" : "en"}>
              {locale === "ta" ? r.ta : r.en}
            </li>
          ))}
        </ul>
        <div className="grid justify-items-start gap-1 md:justify-items-end">
          <Sparkline weeks={it.weeks} label={t("admin.pt.risk.weeks")} />
          <p className="text-meta text-muted-foreground">{it.baseline !== null ? t("admin.pt.risk.usual", { n: Math.round(it.baseline) }) : t("admin.pt.risk.noBaseline")}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("admin.pt.risk.owner")}:</span>
        <span className="font-medium">{it.shop.owner?.name ?? "-"}</span>
        {phone ? (
          <Button asChild size="sm" variant="outline">
            <a href={`tel:${phone}`}>
              <PhoneIcon /> {t("admin.pt.risk.call")} {phone}
            </a>
          </Button>
        ) : (
          <span className="text-muted-foreground">{t("admin.pt.risk.noPhone")}</span>
        )}
        {it.shop.owner?.email && <span className="break-all text-muted-foreground">{it.shop.owner.email}</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ kind: "contacted", text: note || undefined })}>
          <CheckIcon /> {t("admin.pt.risk.contacted")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setNoting((v) => !v)}>
          <StickyNoteIcon /> {t("admin.pt.risk.note")}
        </Button>
        {f?.snoozedUntil ? (
          <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ kind: "unsnooze" })}>
            <BellOffIcon /> {t("admin.pt.risk.unsnooze")}
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={act.isPending}>
                <BellOffIcon /> {t("admin.pt.risk.snooze")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => act.mutate({ kind: "snooze", days: 7 })}>{t("admin.pt.risk.snooze7")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => act.mutate({ kind: "snooze", days: 30 })}>{t("admin.pt.risk.snooze30")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ kind: "ignore", ignored: !f?.ignored })}>
          <EyeOffIcon /> {f?.ignored ? t("admin.pt.risk.unignore") : t("admin.pt.risk.ignore")}
        </Button>
      </div>
      {noting && (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) act.mutate({ kind: "note", text: note.trim() });
          }}
        >
          <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("admin.pt.risk.notePlaceholder")} aria-label={t("admin.pt.risk.note")} />
          <div>
            <Button type="submit" size="sm" disabled={!note.trim() || act.isPending}>
              {t("admin.pt.risk.save")}
            </Button>
          </div>
        </form>
      )}
      {(f?.contactedAt || f?.snoozedUntil || (f?.notes.length ?? 0) > 0) && (
        <div className="grid gap-1 rounded-lg bg-muted/40 p-3 text-sm">
          <p className="text-meta font-medium text-muted-foreground">
            {t("admin.pt.risk.history")}
            {f?.contactedAt ? ` · ${t("admin.pt.risk.contactedOn", { date: formatDate(f.contactedAt) })}` : ""}
            {f?.snoozedUntil ? ` · ${t("admin.pt.risk.snoozedUntil", { date: formatDate(f.snoozedUntil) })}` : ""}
          </p>
          <ul className="grid gap-1">
            {f!.notes.slice(0, 4).map((n, i) => (
              <li key={i} className="break-words">
                <span className="text-muted-foreground">
                  {formatDateTime(n.at)} · {t(`admin.pt.risk.kind.${n.kind}`)}
                  {n.byName ? ` · ${n.byName}` : ""}
                </span>
                {n.text ? `: ${n.text}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
