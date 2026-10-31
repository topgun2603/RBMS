"use client";

import * as React from "react";
import { PlusIcon, TicketPercentIcon } from "lucide-react";
import { Button, ChipGroup, DataTable, DataTableToolbar, EmptyState, Meter, Switch, toast, type DataTableColumn } from "@rbms/ui";
import { describeError, ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, useServerTable, type ServerFilterDefs } from "@rbms/web";
import { CopyButton } from "../components/bits";
import { CouponStatePill, CouponValue } from "../components/coupon-bits";
import { CouponsIllustration } from "../components/illustrations";
import { PERMS, usePermissions } from "../lib/access";
import { couponWindow, type CouponState } from "../lib/coupons";
import { money } from "../lib/format";
import { ok, useToggleCoupon } from "../lib/queries";
import { COUPON_TYPES, type Coupon } from "../lib/types";

/** The API's derived `status` filter values (packages/coupons COUPON_STATUSES), same names as `couponState`. */
const STATUSES = ["active", "scheduled", "expired", "used_up", "off"] as const satisfies readonly CouponState[];
type StatusPill = (typeof STATUSES)[number] | "all" | "";

export default function CouponsPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <CouponsList />
    </React.Suspense>
  );
}

function CouponsList() {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const { can } = usePermissions();
  const canManage = can(PERMS.coupons);
  const toggle = useToggleCoupon();

  const flip = React.useCallback(
    async (c: Coupon, on: boolean) => {
      try {
        await toggle.mutateAsync({ id: c.id, active: on });
        toast.success(on ? t("orders.coupons.turnedOn", { code: c.code }) : t("orders.coupons.turnedOff", { code: c.code }));
      } catch (err) {
        toast.error(describeError(err, t));
      }
    },
    [toggle, t],
  );

  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("orders.coupons.filterStatus"),
          options: STATUSES.map((s) => ({ value: s, label: t(`orders.coupons.state.${s}`) })),
        },
        type: {
          kind: "options",
          label: t("orders.coupons.filterType"),
          options: COUPON_TYPES.map((x) => ({ value: x, label: t(`orders.coupons.type.${x}`) })),
        },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<Coupon>[]>(() => {
    const day = (d: string) => formatDate(d, { day: "numeric", month: "short", year: "numeric" });
    const windowText = (c: Coupon) => {
      const w = couponWindow(c);
      if (w.from && w.to) return `${day(w.from)} – ${day(w.to)}`;
      if (w.to) return t("orders.coupons.until", { date: day(w.to) });
      if (w.from) return t("orders.coupons.from", { date: day(w.from) });
      return t("orders.coupons.always");
    };
    const toggleSwitch = (c: Coupon) => (
      <Switch checked={c.active} disabled={!canManage} onCheckedChange={(v) => void flip(c, v)} aria-label={t("orders.coupons.toggle", { code: c.code })} />
    );
    return [
      {
        id: "code",
        header: t("orders.coupons.col.code"),
        sortable: true,
        hideable: false,
        card: "title",
        cell: (c) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <ModuleLink to={`coupons/${c.id}`} className="rounded-md font-mono text-sm font-semibold tracking-wide outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                {c.code}
              </ModuleLink>
              <CopyButton value={c.code} variant="ghost" size="icon-sm" copiedMessage={t("orders.coupons.copied", { code: c.code })} />
            </div>
            {(c.description || c.minOrder > 0) && (
              <p className="max-w-[18rem] truncate text-meta text-muted-foreground">
                {[c.description, c.minOrder > 0 && t("orders.coupons.minOrder", { amount: money(c.minOrder) })].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        ),
        cardCell: (c) => <span className="font-mono font-semibold tracking-wide">{c.code}</span>,
      },
      {
        id: "value",
        header: t("orders.coupons.col.value"),
        card: "subtitle",
        cell: (c) => <CouponValue coupon={c} />,
      },
      {
        id: "uses",
        header: t("orders.coupons.col.usage"),
        sortable: true,
        sortDescFirst: true,
        card: "meta",
        cell: (c) =>
          c.usageLimit ? (
            <div className="grid w-28 gap-1">
              <span className="text-xs tabular-nums">{t("orders.coupons.usedOf", { used: c.usedCount, limit: c.usageLimit })}</span>
              <Meter value={c.usedCount} max={c.usageLimit} label={t("orders.coupons.usage")} valueText={`${c.usedCount} / ${c.usageLimit}`} className="h-1.5" />
            </div>
          ) : (
            <span className="text-xs tabular-nums">{t("orders.coupons.used", { used: c.usedCount })}</span>
          ),
        cardCell: (c) => (c.usageLimit ? t("orders.coupons.usedOf", { used: c.usedCount, limit: c.usageLimit }) : t("orders.coupons.used", { used: c.usedCount })),
      },
      {
        id: "ends",
        header: t("orders.coupons.col.validity"),
        sortable: true,
        card: "meta",
        cell: (c) => <span className="text-sm whitespace-nowrap text-muted-foreground">{windowText(c)}</span>,
        cardCell: windowText,
      },
      {
        id: "created",
        header: t("orders.coupons.col.created"),
        sortable: true,
        sortDescFirst: true,
        defaultHidden: true,
        cell: (c) => <span className="text-sm whitespace-nowrap text-muted-foreground tabular-nums">{day(c.createdAt)}</span>,
      },
      {
        id: "status",
        header: t("orders.coupons.col.status"),
        card: "right",
        cell: (c) => <CouponStatePill coupon={c} />,
      },
      {
        id: "on",
        header: t("orders.coupons.col.on"),
        hideable: false,
        align: "right",
        headerClassName: "w-20",
        card: "right",
        cell: toggleSwitch,
      },
    ];
  }, [t, formatDate, canManage, flip]);

  const st = useServerTable<Coupon, typeof filters>({
    queryKey: ok.couponTable, // under ["coupons", "list"], which every coupon mutation invalidates
    path: "/coupons",
    columns,
    filters,
    defaultSort: "-created", // = COUPON_SORT's default
    search: t("orders.coupons.search"),
    storageKey: "orders-coupons",
  });

  const counts = st.facets?.status as Partial<Record<(typeof STATUSES)[number], number>> | undefined;
  const all = counts ? Object.values(counts).reduce((n, v) => n + (v ?? 0), 0) : undefined;
  const status = st.filters.status;
  const pill: StatusPill = status.value.length === 0 ? "all" : status.value.length === 1 ? (status.value[0] as StatusPill) : "";
  const filtered = st.table.activeFilterCount > 0;

  const addButton = canManage && (
    <Button asChild size="lg">
      <ModuleLink to="coupons/new">
        <PlusIcon /> {t("orders.coupons.add")}
      </ModuleLink>
    </Button>
  );

  return (
    <Page>
      <PageHeading
        icon={TicketPercentIcon}
        title={t("orders.coupons.title")}
        description={all !== undefined ? t("orders.coupons.subtitleCount", { count: all }) : t("orders.coupons.subtitle")}
        actions={addButton}
      />

      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup<StatusPill>
            size="sm"
            aria-label={t("orders.coupons.filterStatus")}
            value={pill}
            onChange={(v) => status.set(v === "all" || v === "" ? [] : [v])}
            options={[
              { value: "all", label: t("orders.list.all"), meta: all },
              ...STATUSES.map((s) => ({ value: s, label: t(`orders.coupons.state.${s}`), meta: counts?.[s] || undefined })),
            ]}
          />
        }
      />

      <DataTable
        table={st.table}
        onRowClick={(c) => navigate(`coupons/${c.id}`)}
        empty={
          filtered ? undefined : (
            <EmptyState
              className="border-0 bg-transparent"
              illustration={<CouponsIllustration />}
              icon={TicketPercentIcon}
              title={t("orders.coupons.emptyTitle")}
              description={t("orders.coupons.emptyBody")}
              action={addButton || undefined}
            />
          )
        }
      />
    </Page>
  );
}
