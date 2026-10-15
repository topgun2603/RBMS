"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2Icon,
  ExternalLinkIcon,
  LayersIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  ToggleRightIcon,
} from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  type DataTableColumn,
} from "@srirealtime/ui";
import { StatusBadge } from "@/components/badges";
import { TenantFeaturesSheet } from "@/components/features/tenant-features-sheet";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { DebouncedSearch } from "@/components/search-input";
import { SuperAdminOnly } from "@/components/superadmin-only";
import { api } from "@/lib/api";
import { useSwitchTenant } from "@/lib/auth";
import { describeError, useI18n } from "@/lib/i18n";
import { usePlans } from "@/lib/queries";
import type { Paged, Tenant } from "@/lib/types";

const PAGE = 25;

export default function PlatformTenantsPage() {
  return (
    <SuperAdminOnly>
      <TenantsList />
    </SuperAdminOnly>
  );
}

function TenantsList() {
  const { t, formatDate } = useI18n();
  const qc = useQueryClient();
  const router = useRouter();
  const switchTenant = useSwitchTenant();
  const plans = usePlans(true);
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [statusTarget, setStatusTarget] = React.useState<Tenant | null>(null);
  const [planTarget, setPlanTarget] = React.useState<Tenant | null>(null);
  const [featuresTarget, setFeaturesTarget] = React.useState<Tenant | null>(null);

  const tenants = useQuery({
    queryKey: ["platform", "tenants", q, page],
    queryFn: () => api.get<Paged<Tenant>>("/tenancy/tenants", { q, limit: PAGE, offset: page * PAGE }, { tenant: null }),
    placeholderData: keepPreviousData,
  });

  const setStatus = useMutation({
    mutationFn: (tn: Tenant) =>
      api.patch(`/tenancy/tenants/${tn.id}/status`, { status: tn.status === "active" ? "suspended" : "active" }, { tenant: null }),
    onSuccess: (_d, tn) => {
      toast.success(tn.status === "active" ? t("admin.platform.suspended", { name: tn.name }) : t("admin.platform.activated", { name: tn.name }));
      void qc.invalidateQueries({ queryKey: ["platform", "tenants"] });
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const planName = (id?: string | null) => (id ? (plans.data?.find((p) => p.id === id)?.name ?? id) : null);

  const columns: DataTableColumn<Tenant>[] = [
    {
      id: "tenant",
      header: t("admin.platform.tenant"),
      cell: (tn) => (
        <div className="flex items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-semibold text-primary">
            {Array.from(tn.name)[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{tn.name}</div>
            <div className="truncate font-mono text-xs text-muted-foreground">{tn.slug}</div>
          </div>
        </div>
      ),
    },
    {
      id: "plan",
      header: t("admin.platform.plan"),
      cell: (tn) => (planName(tn.planId) ? <Badge variant="secondary">{planName(tn.planId)}</Badge> : <span className="text-muted-foreground">—</span>),
    },
    {
      id: "app",
      header: t("admin.platform.app"),
      hideBelow: "lg",
      cell: (tn) => <span className="font-mono text-xs text-muted-foreground">{tn.appId ?? "—"}</span>,
    },
    { id: "status", header: t("admin.common.status"), cell: (tn) => <StatusBadge status={tn.status} /> },
    {
      id: "created",
      header: t("admin.common.created"),
      hideBelow: "md",
      cell: (tn) => <span className="text-muted-foreground">{tn.createdAt ? formatDate(tn.createdAt) : "—"}</span>,
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("admin.common.actions")}</span>,
      align: "right",
      width: "48px",
      cell: (tn) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("admin.common.actions")}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              onSelect={() => {
                switchTenant(tn.slug);
                router.push("/");
              }}
            >
              <ExternalLinkIcon /> {t("admin.platform.openWorkspace")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPlanTarget(tn)}>
              <LayersIcon /> {t("admin.platform.changePlan")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setFeaturesTarget(tn)}>
              <ToggleRightIcon /> {t("admin.featuresUi.tenantAction")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant={tn.status === "active" ? "destructive" : "default"} onSelect={() => setStatusTarget(tn)}>
              {tn.status === "active" ? <PauseCircleIcon /> : <PlayCircleIcon />}
              {tn.status === "active" ? t("admin.platform.suspend") : t("admin.platform.activate")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader eyebrow={t("admin.nav.platform")} title={t("admin.platform.tenantsTitle")} description={t("admin.platform.tenantsSubtitle")} />
      <div className="mb-3 flex items-center gap-2">
        <DebouncedSearch
          placeholder={t("admin.platform.searchTenants")}
          onSearch={(v) => {
            setQ(v);
            setPage(0);
          }}
        />
        {tenants.data?.total !== undefined && (
          <span className="ml-auto text-xs text-muted-foreground">{t("admin.platform.tenantCount", { count: tenants.data.total })}</span>
        )}
      </div>
      {tenants.isError ? (
        <QueryError error={tenants.error} onRetry={() => void tenants.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={tenants.data?.items}
          loading={tenants.isLoading}
          getRowId={(tn) => tn.id}
          pagination={{ page, pageSize: PAGE, total: tenants.data?.total, onPageChange: setPage }}
          labels={{
            previous: t("admin.table.previous"),
            next: t("admin.table.next"),
            range: ({ from, to, total }) => t("admin.table.range", { from, to, total: total ?? to }),
          }}
          empty={<EmptyState compact icon={Building2Icon} title={q ? t("admin.common.noResults") : t("admin.platform.noTenants")} />}
        />
      )}

      <ConfirmDialog
        open={statusTarget !== null}
        onOpenChange={(o) => !o && setStatusTarget(null)}
        destructive={statusTarget?.status === "active"}
        title={statusTarget?.status === "active" ? t("admin.platform.suspendTitle", { name: statusTarget.name }) : t("admin.platform.activateTitle", { name: statusTarget?.name ?? "" })}
        description={statusTarget?.status === "active" ? t("admin.platform.suspendDescription") : t("admin.platform.activateDescription")}
        confirmLabel={statusTarget?.status === "active" ? t("admin.platform.suspend") : t("admin.platform.activate")}
        onConfirm={() => (statusTarget ? setStatus.mutateAsync(statusTarget) : undefined)}
      />
      <ChangePlanDialog tenant={planTarget} onClose={() => setPlanTarget(null)} />
      <TenantFeaturesSheet tenant={featuresTarget} onClose={() => setFeaturesTarget(null)} />
    </Page>
  );
}

function ChangePlanDialog({ tenant, onClose }: { tenant: Tenant | null; onClose: () => void }) {
  const { t, formatCurrency } = useI18n();
  const qc = useQueryClient();
  const plans = usePlans(true);
  const [planId, setPlanId] = React.useState<string>("__none");
  React.useEffect(() => {
    if (tenant) setPlanId(tenant.planId ?? "__none");
  }, [tenant]);

  const save = useMutation({
    mutationFn: () => api.patch(`/tenancy/tenants/${tenant!.id}/plan`, { planId: planId === "__none" ? null : planId }, { tenant: null }),
    onSuccess: () => {
      toast.success(t("admin.platform.planChanged"));
      void qc.invalidateQueries({ queryKey: ["platform", "tenants"] });
      void qc.invalidateQueries({ queryKey: ["features"] });
      onClose();
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  return (
    <Dialog open={tenant !== null} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent closeLabel={t("admin.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("admin.platform.changePlan")}</DialogTitle>
          <DialogDescription>{tenant?.name}</DialogDescription>
        </DialogHeader>
        <Select value={planId} onValueChange={setPlanId}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">{t("admin.platform.defaultPlan")}</SelectItem>
            {plans.data?.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name} · {p.priceMonthlyPaise ? formatCurrency(p.priceMonthlyPaise / 100, { maximumFractionDigits: 0 }) : t("admin.plans.free")}
                {!p.isPublic && ` · ${t("admin.platform.private")}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t("admin.common.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || planId === (tenant?.planId ?? "__none")}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            {t("admin.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
