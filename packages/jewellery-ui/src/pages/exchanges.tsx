"use client";

import * as React from "react";
import { PlusIcon } from "lucide-react";
import { Button, ChipGroup, DataTable, DataTableToolbar, type DataTableColumn } from "@srirealtime/ui";
import { ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, useQueryParams, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { ExchangeStatusPill } from "../components/bits";
import { ExchangeDialog } from "../components/exchange-dialog";
import { money } from "../lib/format";
import { jk } from "../lib/queries";
import { EXCHANGE_STATUSES, type ExchangeSummary } from "../lib/types";

export default function ExchangesPage() {
  return (
    <React.Suspense fallback={null}>
      <Exchanges />
    </React.Suspense>
  );
}

function Exchanges() {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const params = useQueryParams();
  const [creating, setCreating] = React.useState(false);

  // Quick action: /jewellery/exchange?new=1 opens the dialog.
  React.useEffect(() => {
    if (params.get("new") === "1") setCreating(true);
  }, [params]);

  const filters = React.useMemo(
    () =>
      ({
        status: { kind: "options", label: t("jewellery.exchanges.filterStatus"), options: EXCHANGE_STATUSES.map((s) => ({ value: s, label: t(`jewellery.exchangeStatus.${s}`) })) },
        date: { kind: "dateRange", label: t("jewellery.exchanges.col.date") },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<ExchangeSummary>[]>(
    () => [
      {
        id: "number",
        header: t("jewellery.exchanges.col.number"),
        sortable: true,
        sortDescFirst: true,
        hideable: false,
        card: "subtitle",
        cell: (r) => (
          <ModuleLink to={`exchange/${r.id}`} className="font-medium hover:underline">
            {r.code}
          </ModuleLink>
        ),
        cardCell: (r) => `${r.code} · ${formatDate(r.date)}`,
      },
      { id: "date", header: t("jewellery.exchanges.col.date"), sortable: true, sortDescFirst: true, cell: (r) => formatDate(r.date) },
      { id: "customer", header: t("jewellery.exchanges.col.customer"), sortable: true, hideable: false, card: "title", cell: (r) => r.customerName },
      { id: "lines", header: t("jewellery.exchanges.col.lines"), numeric: true, hideBelow: "md", cell: (r) => r.lineCount },
      { id: "status", header: t("jewellery.exchanges.filterStatus"), sortable: true, card: "right", cell: (r) => <ExchangeStatusPill status={r.status} /> },
      { id: "total", header: t("jewellery.exchanges.col.total"), sortable: true, numeric: true, card: "right", cell: (r) => money(r.total) },
    ],
    [t, formatDate],
  );

  const st = useServerTable<ExchangeSummary, typeof filters>({
    queryKey: jk.exchanges,
    path: "/jewellery/exchanges",
    columns,
    filters,
    defaultSort: "-number",
    search: t("jewellery.exchanges.search"),
    storageKey: "jewellery-exchanges",
  });

  const status = st.filters.status;
  return (
    <Page>
      <PageHeading
        title={t("jewellery.exchanges.title")}
        description={t("jewellery.exchanges.description")}
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon /> {t("jewellery.exchange.newTitle")}
          </Button>
        }
      />
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("jewellery.exchanges.filterStatus")}
            value={status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : ""}
            onChange={(v) => status.set(v === "all" ? [] : [v as (typeof EXCHANGE_STATUSES)[number]])}
            options={[
              { value: "all", label: t("jewellery.common.all") },
              ...EXCHANGE_STATUSES.map((v) => ({ value: v, label: t(`jewellery.exchangeStatus.${v}`), meta: st.facets?.status?.[v] })),
            ]}
          />
        }
      />
      <DataTable table={st.table} onRowClick={(r) => navigate(`exchange/${r.id}`)} />
      <ExchangeDialog open={creating} onOpenChange={setCreating} onCreated={(x) => navigate(`exchange/${x.id}`)} />
    </Page>
  );
}
