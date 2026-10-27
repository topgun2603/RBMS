"use client";

import * as React from "react";
import { ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, usePermission, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { ClipboardListIcon, FileBadgeIcon, PlusIcon, TruckIcon } from "lucide-react";
import { Button, ChipGroup, cn, DataTable, DataTableToolbar, EmptyState, InitialsAvatar, type DataTableColumn } from "@srirealtime/ui";
import { compactINR, money } from "../../lib/format";
import { useSalesDocsSummary } from "../../lib/queries-sales-docs";
import {
  CHALLAN_REASONS,
  CHALLAN_STATUSES,
  PROFORMA_DISPLAY_STATUSES,
  SALE_ORDER_STATUSES,
  type ChallanSummary,
  type ProformaSummary,
  type SaleOrderSummary,
  type SalesDocKind,
  type SalesDocListResponse,
} from "../../lib/types-sales-docs";
import { SalesDocStatusPill, useReasonLabel } from "./sd-ui";

type Row = ProformaSummary | SaleOrderSummary | ChallanSummary;

const CONF = {
  proforma: { path: "/sales-docs/proformas", href: "proformas", icon: FileBadgeIcon, statuses: PROFORMA_DISPLAY_STATUSES, title: "billing.sd.list.title.proforma" },
  sale_order: { path: "/sales-docs/sale-orders", href: "sale-orders", icon: ClipboardListIcon, statuses: SALE_ORDER_STATUSES, title: "billing.sd.list.title.sale_order" },
  challan: { path: "/sales-docs/challans", href: "challans", icon: TruckIcon, statuses: CHALLAN_STATUSES, title: "billing.sd.list.title.challan" },
} as const;

/** The list of one kind: server-paged, sorted and filtered like the quotations list, with a summary strip. */
export function SalesDocList({ kind }: { kind: SalesDocKind }) {
  return (
    <React.Suspense fallback={null}>
      <List kind={kind} />
    </React.Suspense>
  );
}

function List({ kind }: { kind: SalesDocKind }) {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const canManage = usePermission("sales-docs.manage");
  const reasonLabel = useReasonLabel();
  const summary = useSalesDocsSummary();
  const conf = CONF[kind];
  const statusOf = (r: Row) => ("displayStatus" in r ? r.displayStatus : r.status);

  const filters = React.useMemo(
    () =>
      ({
        status: { kind: "options", label: t("billing.sd.list.status"), options: conf.statuses.map((s) => ({ value: s, label: t(`billing.sd.status.${kind}.${s}`) })) },
        ...(kind === "challan" ? { reason: { kind: "options", label: t("billing.sd.list.reason"), options: CHALLAN_REASONS.map((r) => ({ value: r, label: reasonLabel(r) })) } } : {}),
        date: { kind: "dateRange", label: t("billing.sd.list.col.date") },
        customerId: { kind: "text" },
        ...(kind === "challan" ? { saleOrderId: { kind: "text" } } : {}),
      }) satisfies ServerFilterDefs,
    [t, kind, conf.statuses, reasonLabel],
  );

  const columns = React.useMemo<DataTableColumn<Row>[]>(() => {
    const cols: DataTableColumn<Row>[] = [
      {
        id: "number",
        header: t("billing.sd.list.col.number"),
        sortable: true,
        hideable: false,
        card: "subtitle",
        cell: (r) => (
          <ModuleLink to={`${conf.href}/${r.id}`} className="font-mono font-medium outline-none hover:text-primary hover:underline focus-visible:underline">
            {r.number}
          </ModuleLink>
        ),
        cardCell: (r) => (
          <span>
            <span className="font-mono">{r.number}</span> · {formatDate(r.date)}
          </span>
        ),
      },
      { id: "date", header: t("billing.sd.list.col.date"), sortable: true, sortDescFirst: true, hideBelow: "md", cell: (r) => <span className="tabular-nums">{formatDate(r.date)}</span> },
      {
        id: "customer",
        header: kind === "challan" ? t("billing.sd.list.col.consignee") : t("billing.sd.list.col.customer"),
        hideable: false,
        card: "title",
        className: "max-w-[18rem]",
        cell: (r) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <InitialsAvatar name={r.customerName} size="sm" />
            <span className={cn("truncate font-medium", r.status === "cancelled" && "text-muted-foreground line-through")}>{r.customerName}</span>
          </div>
        ),
        cardCell: (r) => <span className={cn(r.status === "cancelled" && "text-muted-foreground line-through")}>{r.customerName}</span>,
      },
    ];
    if (kind === "proforma") {
      cols.push({
        id: "validUntil",
        header: t("billing.sd.list.col.validUntil"),
        sortable: true,
        hideBelow: "lg",
        card: "meta",
        cell: (r) => <span className="tabular-nums">{(r as ProformaSummary).validUntil ? formatDate((r as ProformaSummary).validUntil!) : "—"}</span>,
      });
      cols.push({
        id: "advance",
        header: t("billing.sd.list.col.advance"),
        numeric: true,
        hideBelow: "lg",
        cell: (r) => <span className="tabular-nums">{(r as ProformaSummary).advanceReceived ? money((r as ProformaSummary).advanceReceived) : "—"}</span>,
      });
    } else if (kind === "sale_order") {
      cols.push({
        id: "promisedDate",
        header: t("billing.sd.list.col.promised"),
        sortable: true,
        hideBelow: "lg",
        card: "meta",
        cell: (r) => {
          const o = r as SaleOrderSummary;
          return o.promisedDate ? (
            <span className={cn("tabular-nums", o.overdue && "font-semibold text-warning-ink")}>
              {formatDate(o.promisedDate)}
              {o.overdue && <span className="block text-xs font-normal">{t("billing.sd.order.late")}</span>}
            </span>
          ) : (
            "—"
          );
        },
      });
      cols.push({ id: "customerRef", header: t("billing.sd.list.col.ref"), hideBelow: "lg", cell: (r) => <span className="text-muted-foreground">{(r as SaleOrderSummary).customerRef ?? ""}</span> });
    } else {
      cols.push({ id: "reason", header: t("billing.sd.list.reason"), hideBelow: "md", card: "meta", cell: (r) => <span>{reasonLabel((r as ChallanSummary).reason)}</span> });
      cols.push({
        id: "returnBy",
        header: t("billing.sd.list.col.returnBy"),
        sortable: true,
        hideBelow: "lg",
        cell: (r) => {
          const c = r as ChallanSummary;
          return c.returnBy ? <span className={cn("tabular-nums", c.overdue && "font-semibold text-warning-ink")}>{formatDate(c.returnBy)}</span> : "—";
        },
      });
    }
    cols.push({ id: "status", header: t("billing.sd.list.status"), card: "right", cell: (r) => <SalesDocStatusPill kind={kind} status={statusOf(r)} /> });
    cols.push({ id: "total", header: kind === "challan" ? t("billing.sd.list.col.value") : t("billing.sd.list.col.total"), sortable: true, numeric: true, card: "right", cell: (r) => <span className="font-semibold">{money(r.total)}</span> });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- statusOf is stable
  }, [t, formatDate, kind, conf.href, reasonLabel]);

  const st = useServerTable<Row, typeof filters>({
    queryKey: ["sales-docs", kind, "table"],
    path: conf.path,
    columns,
    filters,
    defaultSort: "-date",
    search: t(`billing.sd.list.search.${kind}`),
    storageKey: `billing-sales-docs-${kind}`,
  });

  const totals = (st.query.data as SalesDocListResponse<Row> | undefined)?.totals;
  const status = st.filters.status;
  const counts = st.facets?.status;
  const pill = status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : "";
  const filtered = st.table.activeFilterCount > 0;
  const s = summary.data;

  const newButton = canManage ? (
    <Button asChild size="lg">
      <ModuleLink to={`${conf.href}/new`}>
        <PlusIcon /> {t(`billing.sd.new.${kind}`)}
      </ModuleLink>
    </Button>
  ) : undefined;

  const strip =
    kind === "proforma" && s
      ? [
          { label: t("billing.sd.summary.proformaOpen"), value: compactINR(s.proformas.open.value), sub: t("billing.sd.summary.count", { count: s.proformas.open.count }) },
          { label: t("billing.sd.summary.advanceHeld"), value: compactINR(s.proformas.advanceHeld) },
          { label: t("billing.sd.summary.drafts"), value: String(s.proformas.drafts) },
        ]
      : kind === "sale_order" && s
        ? [
            { label: t("billing.sd.summary.ordersOpen"), value: compactINR(s.saleOrders.open.value), sub: t("billing.sd.summary.count", { count: s.saleOrders.open.count }) },
            { label: t("billing.sd.summary.late"), value: String(s.saleOrders.overdue), tone: s.saleOrders.overdue > 0 ? "text-warning-ink" : undefined },
            { label: t("billing.sd.summary.advanceHeld"), value: compactINR(s.saleOrders.advanceHeld) },
          ]
        : kind === "challan" && s
          ? [
              { label: t("billing.sd.summary.goodsOut"), value: compactINR(s.challans.out.value), sub: t("billing.sd.summary.count", { count: s.challans.out.count }) },
              { label: t("billing.sd.summary.toBill"), value: compactINR(s.challans.toBill.value), sub: t("billing.sd.summary.count", { count: s.challans.toBill.count }) },
              { label: t("billing.sd.summary.overdueReturns"), value: String(s.challans.overdue), tone: s.challans.overdue > 0 ? "text-warning-ink" : undefined },
            ]
          : null;

  return (
    <Page>
      <PageHeading icon={conf.icon} title={t(conf.title)} description={t(`billing.sd.list.subtitle.${kind}`)} actions={newButton} />
      {strip && (
        <div className="mb-3 grid grid-cols-3 gap-2 rounded-2xl border border-card-ring bg-card p-3 shadow-elevated" aria-live="polite">
          {strip.map((x) => (
            <div key={x.label} className="min-w-0 text-center sm:text-left">
              <p className="truncate text-xs text-muted-foreground sm:text-meta">{x.label}</p>
              <p className={cn("truncate font-heading text-lg font-bold tabular-nums", "tone" in x ? x.tone : undefined)}>{x.value}</p>
              {"sub" in x && x.sub && <p className="truncate text-[0.6875rem] text-muted-foreground">{x.sub}</p>}
            </div>
          ))}
        </div>
      )}
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("billing.sd.list.status")}
            value={pill}
            onChange={(v) => status.set(v === "all" ? [] : [v])}
            options={[
              { value: "all", label: t("billing.sd.list.all") },
              ...conf.statuses.map((x) => ({ value: x, label: t(`billing.sd.status.${kind}.${x}`), meta: counts ? counts[x] || undefined : undefined })),
            ]}
          />
        }
      />
      {totals && totals.count > 0 && filtered && <p className="mb-2 text-meta text-muted-foreground tabular-nums">{t("billing.sd.list.shown", { count: totals.count, total: money(totals.value) })}</p>}
      <DataTable
        table={st.table}
        onRowClick={(r) => navigate(`${conf.href}/${r.id}`)}
        empty={filtered ? undefined : <EmptyState className="border-0 bg-transparent" icon={conf.icon} title={t(`billing.sd.list.emptyTitle.${kind}`)} description={t(`billing.sd.list.emptyBody.${kind}`)} action={newButton} />}
      />
    </Page>
  );
}
