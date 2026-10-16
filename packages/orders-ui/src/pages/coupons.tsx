"use client";

import * as React from "react";
import { FilterXIcon, PlusIcon, TicketPercentIcon } from "lucide-react";
import {
  Card,
  ChipGroup,
  cn,
  EmptyState,
  Meter,
  Skeleton,
  Stagger,
  StaggerItem,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
  Button,
} from "@srirealtime/ui";
import { describeError, ModuleLink, Page, PageHeading, QueryError, SearchField, useDebounced, useI18n } from "@srirealtime/web";
import { CopyButton } from "../components/bits";
import { CouponStatePill, CouponValue } from "../components/coupon-bits";
import { CouponsIllustration } from "../components/illustrations";
import { PERMS, usePermissions } from "../lib/access";
import { couponWindow } from "../lib/coupons";
import { money } from "../lib/format";
import { useCoupons, useToggleCoupon } from "../lib/queries";
import type { Coupon } from "../lib/types";

type ActiveFilter = "" | "true" | "false";

export default function CouponsPage() {
  const { t, formatDate } = useI18n();
  const { can } = usePermissions();
  const canManage = can(PERMS.coupons);
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState<ActiveFilter>("");
  const debounced = useDebounced(q.trim(), 300);
  const list = useCoupons(debounced, active);
  const toggle = useToggleCoupon();
  const items = list.data?.items ?? [];
  const filtered = !!(debounced || active);

  const flip = async (c: Coupon, on: boolean) => {
    try {
      await toggle.mutateAsync({ id: c.id, active: on });
      toast.success(on ? t("orders.coupons.turnedOn", { code: c.code }) : t("orders.coupons.turnedOff", { code: c.code }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const windowText = (c: Coupon) => {
    const w = couponWindow(c);
    const f = (d: string) => formatDate(d, { day: "numeric", month: "short", year: "numeric" });
    if (w.from && w.to) return `${f(w.from)} – ${f(w.to)}`;
    if (w.to) return t("orders.coupons.until", { date: f(w.to) });
    if (w.from) return t("orders.coupons.from", { date: f(w.from) });
    return t("orders.coupons.always");
  };

  const usage = (c: Coupon) =>
    c.usageLimit ? (
      <div className="grid w-28 gap-1">
        <span className="text-xs tabular-nums">{t("orders.coupons.usedOf", { used: c.usedCount, limit: c.usageLimit })}</span>
        <Meter value={c.usedCount} max={c.usageLimit} label={t("orders.coupons.usage")} valueText={`${c.usedCount} / ${c.usageLimit}`} className="h-1.5" />
      </div>
    ) : (
      <span className="text-xs tabular-nums">{t("orders.coupons.used", { used: c.usedCount })}</span>
    );

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
        description={list.data ? t("orders.coupons.subtitleCount", { count: list.data.total }) : t("orders.coupons.subtitle")}
        actions={addButton}
      />
      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <SearchField value={q} onChange={setQ} placeholder={t("orders.coupons.search")} />
        <div className="flex items-center gap-2">
          <ChipGroup<ActiveFilter>
            size="sm"
            aria-label={t("orders.coupons.filter")}
            value={active}
            onChange={setActive}
            options={[
              { value: "", label: t("orders.list.all") },
              { value: "true", label: t("orders.coupons.onlyOn") },
              { value: "false", label: t("orders.coupons.onlyOff") },
            ]}
          />
          {filtered && (
            <Button variant="ghost" size="sm" onClick={() => (setQ(""), setActive(""))}>
              <FilterXIcon />
            </Button>
          )}
        </div>
      </div>

      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div className="grid gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          illustration={filtered ? undefined : <CouponsIllustration />}
          icon={TicketPercentIcon}
          title={filtered ? t("orders.coupons.noMatch") : t("orders.coupons.emptyTitle")}
          description={filtered ? t("orders.list.noMatchBody") : t("orders.coupons.emptyBody")}
          action={filtered ? undefined : addButton || undefined}
        />
      ) : (
        <div className={cn("transition-opacity", list.isPlaceholderData && "opacity-60")}>
          <Card className="hidden gap-0 overflow-hidden py-0 md:flex">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4">{t("orders.coupons.col.code")}</TableHead>
                  <TableHead>{t("orders.coupons.col.value")}</TableHead>
                  <TableHead>{t("orders.coupons.col.usage")}</TableHead>
                  <TableHead>{t("orders.coupons.col.validity")}</TableHead>
                  <TableHead>{t("orders.coupons.col.status")}</TableHead>
                  <TableHead className="w-20 pr-4 text-right">{t("orders.coupons.col.on")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={c.id} className="group">
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-1">
                        <ModuleLink to={`coupons/${c.id}`} className="rounded-md font-mono text-sm font-semibold tracking-wide outline-none group-hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                          {c.code}
                        </ModuleLink>
                        <CopyButton value={c.code} variant="ghost" size="icon-sm" copiedMessage={t("orders.coupons.copied", { code: c.code })} />
                      </div>
                      {(c.description || c.minOrder > 0) && (
                        <p className="max-w-[18rem] truncate text-meta text-muted-foreground">
                          {[c.description, c.minOrder > 0 && t("orders.coupons.minOrder", { amount: money(c.minOrder) })].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <CouponValue coupon={c} />
                    </TableCell>
                    <TableCell>{usage(c)}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap text-muted-foreground">{windowText(c)}</TableCell>
                    <TableCell>
                      <CouponStatePill coupon={c} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Switch checked={c.active} disabled={!canManage} onCheckedChange={(v) => void flip(c, v)} aria-label={t("orders.coupons.toggle", { code: c.code })} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Stagger className="grid gap-2.5 md:hidden">
            {items.map((c) => (
              <StaggerItem key={c.id}>
                <Card className="gap-2 p-3">
                  <div className="flex items-start gap-2">
                    <ModuleLink to={`coupons/${c.id}`} className="min-w-0 flex-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <p className="font-mono font-semibold tracking-wide">{c.code}</p>
                      <div className="text-sm">
                        <CouponValue coupon={c} />
                      </div>
                    </ModuleLink>
                    <CopyButton value={c.code} variant="ghost" size="icon" copiedMessage={t("orders.coupons.copied", { code: c.code })} />
                    <Switch checked={c.active} disabled={!canManage} onCheckedChange={(v) => void flip(c, v)} aria-label={t("orders.coupons.toggle", { code: c.code })} className="mt-2" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <CouponStatePill coupon={c} />
                    <span>{windowText(c)}</span>
                    <span className="ml-auto">{usage(c)}</span>
                  </div>
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      )}
    </Page>
  );
}
