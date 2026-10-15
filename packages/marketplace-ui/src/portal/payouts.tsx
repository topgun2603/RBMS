"use client";

import * as React from "react";
import { DownloadIcon, LandmarkIcon, WalletIcon } from "lucide-react";
import { AnimatedNumber, Button, ChipGroup, cn, EmptyState, StatCard, Stagger, StaggerItem, Tabs, TabsContent, TabsList, TabsTrigger, toast } from "@srirealtime/ui";
import { describeError, ModuleLink, Page, PageHeading, QueryError, useFeature, useI18n } from "@srirealtime/web";
import { AccountPill } from "../components/bits";
import { LedgerList, PayoutsList, Pager, RowsSkeleton } from "../components/lists";
import { accountText, bpsToPercent, ledgerTotals, money, signedMoney, withRunningBalance } from "../lib/logic";
import { MP } from "../lib/queries";
import { useMyLedger, useMyPayouts, useVendor, vendorDownload } from "../lib/vendor";
import { LEDGER_TYPES, type LedgerType } from "../lib/types";

const PAGE = 25;
type TypeFilter = "all" | LedgerType;

/** Money: balance, the ledger with a running balance, and payouts. */
export default function MyPayoutsPage() {
  const { t } = useI18n();
  const { self } = useVendor();
  const payoutsOn = useFeature("marketplace.payouts");
  const [tab, setTab] = React.useState("ledger");
  if (!self) return null;
  const b = self.balance;
  return (
    <Page>
      <PageHeading icon={WalletIcon} title={t("marketplace.money.title")} description={t("marketplace.money.subtitle")} />
      <Stagger className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StaggerItem>
          <StatCard icon={WalletIcon} iconClassName="text-success-ink" title={t("marketplace.balance.payable")} value={<AnimatedNumber value={b.balance} from={0} format={money} />} description={t("marketplace.balance.payableHint")} />
        </StaggerItem>
        <StaggerItem>
          <StatCard title={t("marketplace.balance.sales")} value={<AnimatedNumber value={b.sales} from={0} format={money} />} />
        </StaggerItem>
        <StaggerItem>
          <StatCard title={t("marketplace.balance.commission")} value={<AnimatedNumber value={-b.commission} from={0} format={money} />} description={t("marketplace.money.rate", { rate: bpsToPercent(self.effectiveCommissionBps) })} />
        </StaggerItem>
        <StaggerItem>
          <StatCard title={t("marketplace.balance.paidOut")} value={<AnimatedNumber value={-b.payouts} from={0} format={money} />} />
        </StaggerItem>
      </Stagger>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-card p-3 text-sm">
        <span className="flex items-center gap-2">
          <LandmarkIcon className="size-4 text-muted-foreground" />
          <span className="font-mono">{accountText(self.payoutAccount)}</span>
          <AccountPill status={self.payoutAccountStatus} />
        </span>
        <Button asChild variant="ghost" size="sm">
          <ModuleLink to="onboarding">{t(self.payoutAccount ? "marketplace.account.change" : "marketplace.account.add")}</ModuleLink>
        </Button>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList>
          <TabsTrigger value="ledger">{t("marketplace.vendor.tab.ledger")}</TabsTrigger>
          <TabsTrigger value="payouts">{t("marketplace.vendor.tab.payouts")}</TabsTrigger>
        </TabsList>
        <TabsContent value="ledger">
          <Ledger balance={b.balance} />
        </TabsContent>
        <TabsContent value="payouts">
          {payoutsOn ? <Payouts /> : <EmptyState icon={LandmarkIcon} title={t("marketplace.payouts.offTitle")} description={t("marketplace.payouts.offBodyVendor")} />}
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function Ledger({ balance }: { balance: number }) {
  const { t } = useI18n();
  const { vendorId } = useVendor();
  const [type, setType] = React.useState<TypeFilter>("all");
  const [offset, setOffset] = React.useState(0);
  React.useEffect(() => setOffset(0), [type]);
  const q = useMyLedger({ type: type === "all" ? undefined : type, limit: PAGE, offset });
  // Running balance only makes sense for the unfiltered list; paging continues from the entries above.
  const before = useMyLedger({ limit: offset || 1, offset: 0 });
  const running = type === "all";
  const start = balance - (offset > 0 ? (before.data?.items.reduce((s, e) => s + e.amount, 0) ?? 0) : 0);
  const rows = q.data ? (running ? withRunningBalance(q.data.items, start) : q.data.items.map((e) => ({ ...e, balanceAfter: null }))) : [];
  const totals = ledgerTotals(q.data?.items ?? []);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
          <ChipGroup<TypeFilter>
            value={type}
            onChange={setType}
            size="sm"
            aria-label={t("marketplace.ledger.filter")}
            options={[{ value: "all", label: t("marketplace.vendors.tabAll") }, ...LEDGER_TYPES.map((x) => ({ value: x, label: t(`marketplace.ledger.type.${x}`) }))]}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void vendorDownload(vendorId, `${MP}/vendor/ledger`, { format: "csv", ...(type !== "all" ? { type } : {}) }, "seller-ledger.csv").catch((e) => toast.error(describeError(e, t)))
          }
        >
          <DownloadIcon /> {t("marketplace.common.exportCsv")}
        </Button>
      </div>
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending || (running && offset > 0 && before.isPending) ? (
        <RowsSkeleton />
      ) : (
        <div className={cn("grid gap-2 transition-opacity", q.isPlaceholderData && "opacity-60")}>
          <LedgerList rows={rows} showBalance={running} />
          {q.data.items.length > 0 && (
            <p className="text-right text-xs text-muted-foreground tabular-nums">
              {t("marketplace.ledger.pageTotals", { credit: money(totals.credit), debit: money(totals.debit), net: signedMoney(totals.net) })}
            </p>
          )}
          <Pager offset={offset} limit={PAGE} total={q.data.total} onChange={setOffset} />
        </div>
      )}
    </div>
  );
}

function Payouts() {
  const [offset, setOffset] = React.useState(0);
  const q = useMyPayouts({ limit: PAGE, offset });
  return q.isError ? (
    <QueryError error={q.error} onRetry={() => void q.refetch()} />
  ) : q.isPending ? (
    <RowsSkeleton />
  ) : (
    <>
      <PayoutsList items={q.data.items} />
      <Pager offset={offset} limit={PAGE} total={q.data.total} onChange={setOffset} />
    </>
  );
}
