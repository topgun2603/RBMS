"use client";

import * as React from "react";
import { DownloadIcon, LandmarkIcon, ReceiptTextIcon, WalletIcon } from "lucide-react";
import {
  AnimatedNumber,
  Button,
  ChipGroup,
  DataTable,
  DataTableToolbar,
  EmptyState,
  StatCard,
  Stagger,
  StaggerItem,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@srirealtime/ui";
import { api, describeError, ModuleLink, Page, PageHeading, useFeature, useI18n, useQueryParams, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { AccountPill } from "../components/bits";
import { useLedgerColumns, usePayoutColumns } from "../components/table-columns";
import { accountText, bpsToPercent, ledgerTotals, money, signedMoney } from "../lib/logic";
import { MP } from "../lib/queries";
import { useVendor, vendorDownload, vendorOpts } from "../lib/vendor";
import { LEDGER_TYPES, PAYOUT_STATUSES, type LedgerEntry, type LedgerResponse, type ListResult, type Payout } from "../lib/types";

/** Money: balance, the ledger with a running balance, and payouts. */
export default function MyPayoutsPage() {
  // The tables read the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <Money />
    </React.Suspense>
  );
}

function Money() {
  const { t } = useI18n();
  const { self } = useVendor();
  const payoutsOn = useFeature("marketplace.payouts");
  const params = useQueryParams();
  // A shared link to the payouts table (po.* params) opens that tab.
  const [tab, setTab] = React.useState(() => ([...(params?.keys() ?? [])].some((k) => k.startsWith("po.")) ? "payouts" : "ledger"));
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
          <Ledger />
        </TabsContent>
        <TabsContent value="payouts">
          {payoutsOn ? <Payouts /> : <EmptyState icon={LandmarkIcon} title={t("marketplace.payouts.offTitle")} description={t("marketplace.payouts.offBodyVendor")} />}
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function Ledger() {
  const { t } = useI18n();
  const { vendorId } = useVendor();
  const filters = React.useMemo(
    () =>
      ({
        type: { kind: "options", label: t("marketplace.ledger.filterType"), options: LEDGER_TYPES.map((x) => ({ value: x, label: t(`marketplace.ledger.type.${x}`) })) },
        date: { kind: "dateRange", label: t("marketplace.ledger.filterDate") },
      }) satisfies ServerFilterDefs,
    [t],
  );
  // The API sends each entry's running balance (`balanceAfter`), whatever the filters and sort.
  const columns = useLedgerColumns();
  const st = useServerTable<LedgerEntry, typeof filters>({
    queryKey: ["marketplace", "self", vendorId, "ledger", "table"],
    path: `${MP}/vendor/ledger`,
    fetcher: (params, signal) => api.get<LedgerResponse>(`${MP}/vendor/ledger`, params, vendorOpts(vendorId, { signal })),
    columns,
    filters,
    defaultSort: "-date",
    search: t("marketplace.ledger.search"),
    storageKey: "marketplace-seller-ledger",
  });
  const type = st.filters.type;
  const counts = st.facets?.type;
  const all = counts ? Object.values(counts).reduce((n, c) => n + c, 0) : undefined;
  const pill = type.value.length === 0 ? "all" : type.value.length === 1 ? type.value[0]! : "";
  const items = st.query.data?.items ?? [];
  const totals = ledgerTotals(items);
  const filtered = st.table.activeFilterCount > 0;

  const download = () => {
    const { limit: _l, offset: _o, ...q } = st.apiParams;
    void vendorDownload(vendorId, `${MP}/vendor/ledger`, { ...q, format: "csv" }, "seller-ledger.csv").catch((e) => toast.error(describeError(e, t)));
  };

  return (
    <div className="grid gap-3">
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            value={pill}
            onChange={(v) => type.set(v === "all" || v === "" ? [] : [v])}
            size="sm"
            aria-label={t("marketplace.ledger.filter")}
            options={[
              { value: "all", label: t("marketplace.vendors.tabAll"), meta: all || undefined },
              ...LEDGER_TYPES.map((x) => ({ value: x as string, label: t(`marketplace.ledger.type.${x}`), meta: counts ? counts[x] || undefined : undefined })),
            ]}
          />
        }
      >
        <Button variant="outline" onClick={download}>
          <DownloadIcon /> <span className="hidden sm:inline">{t("marketplace.common.exportCsv")}</span>
        </Button>
      </DataTableToolbar>
      <DataTable
        table={st.table}
        empty={filtered ? undefined : <EmptyState className="border-0 bg-transparent" icon={ReceiptTextIcon} title={t("marketplace.ledger.emptyTitle")} description={t("marketplace.ledger.emptyBody")} />}
      />
      {items.length > 0 && (
        <p className="text-right text-meta text-muted-foreground tabular-nums">
          {t("marketplace.ledger.pageTotals", { credit: money(totals.credit), debit: money(totals.debit), net: signedMoney(totals.net) })}
        </p>
      )}
    </div>
  );
}

function Payouts() {
  const { t } = useI18n();
  const { vendorId } = useVendor();
  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("marketplace.payouts.filterStatus"),
          options: PAYOUT_STATUSES.map((s) => ({ value: s, label: t(`marketplace.payout.status.${s}`) })),
        },
        date: { kind: "dateRange", label: t("marketplace.payouts.filterDate") },
      }) satisfies ServerFilterDefs,
    [t],
  );
  const columns = usePayoutColumns();
  const st = useServerTable<Payout, typeof filters>({
    queryKey: ["marketplace", "self", vendorId, "payouts", "table"],
    path: `${MP}/vendor/payouts`,
    fetcher: (params, signal) => api.get<ListResult<Payout>>(`${MP}/vendor/payouts`, params, vendorOpts(vendorId, { signal })),
    columns,
    filters,
    defaultSort: "-date",
    urlPrefix: "po",
    storageKey: "marketplace-seller-payouts",
  });
  const filtered = st.table.activeFilterCount > 0;
  return (
    <div className="grid gap-3">
      <DataTableToolbar table={st.table} />
      <DataTable
        table={st.table}
        empty={filtered ? undefined : <EmptyState className="border-0 bg-transparent" icon={WalletIcon} title={t("marketplace.payouts.emptyTitle")} description={t("marketplace.payouts.emptyBody")} />}
      />
    </div>
  );
}
