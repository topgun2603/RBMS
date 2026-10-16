"use client";

import * as React from "react";
import {
  ArrowDownRightIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CalendarClockIcon,
  CrownIcon,
  HourglassIcon,
  Loader2Icon,
  PencilLineIcon,
  ReceiptTextIcon,
  ShoppingBagIcon,
  SlidersHorizontalIcon,
  Undo2Icon,
} from "lucide-react";
import {
  AnimatedNumber,
  AnimatePresence,
  Button,
  Card,
  CardContent,
  ChipGroup,
  EmptyState,
  InitialsAvatar,
  motion,
  Progress,
  Skeleton,
  StatusPill,
  useReducedMotionSafe,
  type StatusTone,
} from "@srirealtime/ui";
import { ModuleLink, Page, QueryError, useI18n, useRouteParams } from "@srirealtime/web";
import { AdjustDialog } from "../components/loyalty/adjust-dialog";
import { displayPhone, money, num } from "../lib/format";
import { signedPoints } from "../lib/loyalty";
import { useLedger, useMember } from "../lib/queries/loyalty";
import { LEDGER_TYPES, type LedgerEntry, type LedgerType, type MemberDetail } from "../lib/types";
import { GROWTH_ROUTES } from "../module";

const TYPE_TONE: Record<LedgerType, StatusTone> = { earn: "success", redeem: "brand", expire: "warning", adjust: "info", reverse: "neutral" };
const TYPE_ICON: Record<LedgerType, React.ComponentType<{ className?: string }>> = {
  earn: ArrowUpRightIcon,
  redeem: ArrowDownRightIcon,
  expire: HourglassIcon,
  adjust: SlidersHorizontalIcon,
  reverse: Undo2Icon,
};

export default function LoyaltyMemberPage() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const member = useMember(id);
  return (
    <Page>
      <div className="mb-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <ModuleLink to={GROWTH_ROUTES.loyalty}>
            <ArrowLeftIcon /> {t("growth.loyalty.title")}
          </ModuleLink>
        </Button>
      </div>
      {member.isError ? (
        <QueryError error={member.error} onRetry={() => void member.refetch()} />
      ) : member.isPending ? (
        <MemberSkeleton />
      ) : (
        <MemberView id={id} detail={member.data} />
      )}
    </Page>
  );
}

function MemberSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <div className="flex items-center gap-3">
        <Skeleton className="size-14 rounded-full" />
        <div className="grid gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  );
}

function MemberView({ id, detail }: { id: string; detail: MemberDetail }) {
  const { t, formatDate } = useI18n();
  const reduced = useReducedMotionSafe();
  const [adjust, setAdjust] = React.useState(false);
  const [type, setType] = React.useState<"all" | LedgerType>("all");
  const m = detail.member;
  const next = detail.nextTier;
  const progress = next ? Math.min(100, Math.round((m.lifetimeSpend / next.tier.minSpend) * 100)) : 100;
  const expiring = detail.expiringSoon.reduce((s, e) => s + e.points, 0);

  return (
    <>
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <InitialsAvatar name={m.name ?? m.memberKey} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-heading text-2xl font-semibold tracking-tight">{m.name || t("growth.loyalty.noName")}</h1>
              <StatusPill tone="brand" icon={CrownIcon} size="md">
                {m.tier}
              </StatusPill>
            </div>
            <p className="text-sm text-muted-foreground tabular-nums">
              {displayPhone(m.memberKey)} · {t("growth.loyalty.joined", { date: formatDate(m.joinedAt) })}
            </p>
          </div>
        </div>
        <Button size="lg" variant="outline" onClick={() => setAdjust(true)}>
          <PencilLineIcon /> {t("growth.loyalty.adjust")}
        </Button>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="px-card gap-1">
          <p className="text-meta text-muted-foreground">{t("growth.loyalty.balance")}</p>
          <AnimatedNumber value={m.pointsBalance} from={0} format={(n) => num(Math.round(n))} className="font-heading text-3xl font-bold tabular-nums" />
          <p className="text-meta text-muted-foreground tabular-nums">{t("growth.loyalty.worth", { value: money(m.pointsValue) })}</p>
        </Card>
        <Card className="px-card gap-1">
          <p className="text-meta text-muted-foreground">{t("growth.loyalty.lifetimeSpend")}</p>
          <p className="font-heading text-2xl font-bold tabular-nums">{money(m.lifetimeSpend)}</p>
          {next ? (
            <div className="mt-1 grid gap-1">
              <Progress value={progress} className="h-2" aria-label={t("growth.loyalty.toNextTier", { tier: next.tier.name, value: money(next.spendNeeded) })} />
              <p className="text-meta text-muted-foreground">{t("growth.loyalty.toNextTier", { tier: next.tier.name, value: money(next.spendNeeded) })}</p>
            </div>
          ) : (
            <p className="text-meta text-muted-foreground">{t("growth.loyalty.topTier")}</p>
          )}
        </Card>
        <Card className="px-card gap-1">
          <p className="text-meta text-muted-foreground">{t("growth.loyalty.expiringSoon")}</p>
          <p className="font-heading text-2xl font-bold tabular-nums">{num(expiring)}</p>
          {detail.expiringSoon[0] ? (
            <p className="flex items-center gap-1 text-xs text-warning-ink">
              <CalendarClockIcon className="size-3.5" />
              {t("growth.loyalty.expiresOn", { points: num(detail.expiringSoon[0].points), date: formatDate(detail.expiringSoon[0].expiresAt) })}
            </p>
          ) : (
            <p className="text-meta text-muted-foreground">{t("growth.loyalty.nothingExpiring")}</p>
          )}
        </Card>
      </div>

      <Card>
        <div className="flex flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-heading text-base font-semibold">{t("growth.loyalty.history")}</h2>
          <ChipGroup
            size="sm"
            aria-label={t("growth.loyalty.historyFilter")}
            value={type}
            onChange={setType}
            options={[{ value: "all" as const, label: t("growth.common.all") }, ...LEDGER_TYPES.map((x) => ({ value: x, label: t(`growth.loyalty.types.${x}`) }))]}
          />
        </div>
        <CardContent className="px-2 sm:px-4">
          <Ledger id={id} type={type === "all" ? undefined : type} reduced={reduced} />
        </CardContent>
      </Card>

      <AdjustDialog open={adjust} onOpenChange={setAdjust} member={m} />
    </>
  );
}

function Ledger({ id, type, reduced }: { id: string; type?: LedgerType; reduced: boolean }) {
  const { t, formatDate } = useI18n();
  const ledger = useLedger(id, type);
  if (ledger.isError && !ledger.data) return <QueryError compact error={ledger.error} onRetry={() => void ledger.refetch()} />;
  if (ledger.isPending) {
    return (
      <div className="grid gap-2 px-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    );
  }
  const items = ledger.data.pages.flatMap((p) => p.items);
  if (items.length === 0) return <EmptyState compact icon={ReceiptTextIcon} title={t("growth.loyalty.noHistory")} />;
  return (
    <>
      <ul className="grid">
        <AnimatePresence initial={false}>
          {items.map((e, i) => (
            <motion.li
              key={e.id}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: reduced ? 0 : Math.min(i, 10) * 0.02 }}
              className="flex items-center gap-3 border-b border-border/60 px-2 py-2.5 last:border-0"
            >
              <EntryRow entry={e} formatDate={formatDate} t={t} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {ledger.hasNextPage && (
        <div className="mt-2 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => void ledger.fetchNextPage()} disabled={ledger.isFetchingNextPage}>
            {ledger.isFetchingNextPage && <Loader2Icon className="animate-spin" />}
            {t("growth.common.loadMore")}
          </Button>
        </div>
      )}
    </>
  );
}

function EntryRow({ entry: e, formatDate, t }: { entry: LedgerEntry; formatDate: ReturnType<typeof useI18n>["formatDate"]; t: ReturnType<typeof useI18n>["t"] }) {
  const Icon = TYPE_ICON[e.type];
  const ref = e.refType === "invoice" ? t("growth.loyalty.refInvoice") : e.refType === "order" ? t("growth.loyalty.refOrder") : null;
  return (
    <>
      <span className="icon-chip size-9 shrink-0 rounded-xl text-muted-foreground">
        {e.refType === "order" ? <ShoppingBagIcon className="size-4" /> : <Icon className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <StatusPill tone={TYPE_TONE[e.type]} icon={Icon}>
            {t(`growth.loyalty.types.${e.type}`)}
          </StatusPill>
          {e.amountPaise > 0 && <span className="text-xs text-muted-foreground tabular-nums">{t("growth.loyalty.onAmount", { value: money(e.amountPaise) })}</span>}
        </p>
        <p className="mt-0.5 truncate text-meta text-muted-foreground">
          {formatDate(e.createdAt, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
          {ref ? ` · ${ref}` : ""}
          {e.note ? ` · ${e.note}` : ""}
          {e.type === "earn" && e.expiresAt ? ` · ${t("growth.loyalty.expires", { date: formatDate(e.expiresAt) })}` : ""}
        </p>
      </div>
      <span className={e.points > 0 ? "font-semibold text-success-ink tabular-nums" : e.points < 0 ? "font-semibold text-foreground tabular-nums" : "tabular-nums"}>
        {signedPoints(e.points)}
      </span>
    </>
  );
}
