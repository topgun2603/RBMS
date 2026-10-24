"use client";

import * as React from "react";
import {
  BookMarkedIcon,
  BookOpenCheckIcon,
  CalendarDaysIcon,
  FilePlus2Icon,
  HelpCircleIcon,
  LandmarkIcon,
  ListTreeIcon,
  LockIcon,
  RefreshCwIcon,
  ScaleIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  WalletCardsIcon,
} from "lucide-react";
import { Button, Card, CardContent, Skeleton, StatusPill, toast } from "@srirealtime/ui";
import { describeError, ModuleLink, useI18n } from "@srirealtime/web";
import { AccountingPage, Balance } from "../components/accounting/parts";
import { ACC_POST, useAccountingOverview, useAccounts, useReconcile, useSyncNow } from "../lib/accounting";
import { useHasPermission } from "../lib/access";
import { money, rangeFor } from "../lib/format";

function Tile({ label, children, hint, icon: Icon }: { label: string; children: React.ReactNode; hint?: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card className="min-w-0">
      <CardContent className="flex items-start gap-3">
        <span className="icon-chip size-9 shrink-0 text-primary">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-meta text-muted-foreground">{label}</p>
          <div className="font-heading text-xl font-semibold">{children}</div>
          {hint && <p className="text-meta text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

const LINKS = [
  { to: "accounting/journal/new", icon: FilePlus2Icon, key: "newEntry", post: true },
  { to: "accounting/day-book", icon: CalendarDaysIcon, key: "dayBook" },
  { to: "accounting/trial-balance", icon: ScaleIcon, key: "trialBalance" },
  { to: "accounting/profit-loss", icon: TrendingUpIcon, key: "profitLoss" },
  { to: "accounting/balance-sheet", icon: LandmarkIcon, key: "balanceSheet" },
  { to: "accounting/accounts", icon: ListTreeIcon, key: "accounts" },
  { to: "accounting/settings", icon: LockIcon, key: "settings" },
  { to: "accounting/how-it-works", icon: HelpCircleIcon, key: "howItWorks" },
] as const;

/** The shop's books: balances at a glance, the self-check, and the way into every accounting screen. */
export default function AccountingHomePage() {
  const { t, formatDate } = useI18n();
  const canPost = useHasPermission(ACC_POST);
  const overview = useAccountingOverview();
  const accounts = useAccounts(true);
  const range = React.useMemo(() => rangeFor("thisFY"), []);
  const checks = useReconcile(range);
  const sync = useSyncNow();

  const sum = (group: string) => (accounts.data ?? []).filter((a) => a.group === group).reduce((s, a) => s + (a.balance ?? 0), 0);
  const failing = checks.data?.checks.filter((c) => !c.ok).length ?? 0;

  const syncNow = async () => {
    try {
      const r = await sync.mutateAsync();
      toast.success(t("billing.accounting.syncDone", { posted: r.posted, reversed: r.reversed }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <AccountingPage
      title={t("billing.accounting.title")}
      description={t("billing.accounting.subtitle")}
      icon={BookMarkedIcon}
      actions={
        canPost && overview.data?.autoPost ? (
          <Button variant="outline" size="lg" onClick={syncNow} disabled={sync.isPending}>
            <RefreshCwIcon className={sync.isPending ? "animate-spin" : undefined} /> {t("billing.accounting.syncNow")}
          </Button>
        ) : undefined
      }
    >
      <div className="mb-section grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Tile label={t("billing.accounting.tile.cash")} icon={WalletCardsIcon} hint={t("billing.accounting.tile.cashHint")}>
          {accounts.data ? <Balance net={sum("cash_bank")} /> : <Skeleton className="h-6 w-24" />}
        </Tile>
        <Tile label={t("billing.accounting.tile.debtors")} icon={BookOpenCheckIcon} hint={t("billing.accounting.tile.debtorsHint")}>
          {accounts.data ? <Balance net={sum("receivables")} /> : <Skeleton className="h-6 w-24" />}
        </Tile>
        <Tile label={t("billing.accounting.tile.creditors")} icon={WalletCardsIcon} hint={t("billing.accounting.tile.creditorsHint")}>
          {accounts.data ? money(0 - sum("payables") || 0) : <Skeleton className="h-6 w-24" />}
        </Tile>
        <Tile label={t("billing.accounting.tile.gst")} icon={LandmarkIcon} hint={t("billing.accounting.tile.gstHint")}>
          {accounts.data ? money(0 - sum("tax_liabilities") - sum("tax_assets") || 0) : <Skeleton className="h-6 w-24" />}
        </Tile>
      </div>

      <Card className="mb-section">
        <CardContent className="flex flex-wrap items-center gap-3">
          <span className="icon-chip size-9 shrink-0 text-primary">
            <ShieldCheckIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t("billing.accounting.selfCheck")}</p>
            <p className="text-meta text-muted-foreground">
              {overview.data?.lastSyncAt ? t("billing.accounting.lastPosted", { when: formatDate(overview.data.lastSyncAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) }) : t("billing.accounting.notPostedYet")}
            </p>
          </div>
          {checks.isPending ? (
            <Skeleton className="h-6 w-28" />
          ) : failing === 0 ? (
            <StatusPill tone="success" icon={ShieldCheckIcon}>
              {t("billing.accounting.allMatch")}
            </StatusPill>
          ) : (
            <StatusPill tone="warning" icon={ShieldCheckIcon}>
              {t("billing.accounting.differences", { count: failing })}
            </StatusPill>
          )}
          <Button variant="outline" size="sm" asChild>
            <ModuleLink to="accounting/checks">{t("billing.accounting.nav.checks")}</ModuleLink>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {LINKS.filter((l) => !("post" in l) || canPost).map((l) => (
          <Card key={l.key} className="transition-colors hover:bg-accent/40">
            <CardContent>
              <ModuleLink to={l.to} className="flex items-start gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="icon-chip size-9 shrink-0 text-primary">
                  <l.icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">{t(`billing.accounting.nav.${l.key}`)}</span>
                  <span className="block text-meta text-muted-foreground">{t(`billing.accounting.about.${l.key}`)}</span>
                </span>
              </ModuleLink>
            </CardContent>
          </Card>
        ))}
      </div>
    </AccountingPage>
  );
}
