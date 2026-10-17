"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
  DataTableToolbar,
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
import { SuperAdminOnly } from "@/components/superadmin-only";
import { api } from "@/lib/api";
import { useSwitchTenant } from "@/lib/auth";
import { useAppProfiles } from "@/lib/features";
import { describeError, tOr, useI18n } from "@/lib/i18n";
import { usePlans } from "@/lib/queries";
import type { Tenant } from "@/lib/types";
import { useServerTable, type ServerFilterDefs } from "@/lib/use-server-table";

/** Tenant statuses and the "unset" value of the plan / app filters (packages/tenancy/src/list.ts). */
const STATUSES = ["active", "suspended"] as const;
const NONE = "none";

export default function PlatformTenantsPage() {
  return (
    <SuperAdminOnly>
      {/* useServerTable reads the search params, which needs a Suspense boundary. */}
      <React.Suspense fallback={null}>
        <TenantsList />
      </React.Suspense>
    </SuperAdminOnly>
  );
}

function TenantsList() {
  const { t, formatDate } = useI18n();
  const qc = useQueryClient();
  const router = useRouter();
  const switchTenant = useSwitchTenant();
  const plans = usePlans(true);
  const apps = useAppProfiles();
  const [statusTarget, setStatusTarget] = React.useState<Tenant | null>(null);
  const [planTarget, setPlanTarget] = React.useState<Tenant | null>(null);
  const [featuresTarget, setFeaturesTarget] = React.useState<Tenant | null>(null);

  const setStatus = useMutation({
    mutationFn: (tn: Tenant) =>
      api.patch(`/tenancy/tenants/${tn.id}/status`, { status: tn.status === "active" ? "suspended" : "active" }, { tenant: null }),
    onSuccess: (_d, tn) => {
      toast.success(tn.status === "active" ? t("admin.platform.suspended", { name: tn.name }) : t("admin.platform.activated", { name: tn.name }));
      void qc.invalidateQueries({ queryKey: ["platform", "tenants"] });
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const planNames = React.useMemo(() => new Map((plans.data ?? []).map((p) => [p.id, p.name])), [plans.data]);

  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("admin.common.status"),
          options: STATUSES.map((s) => ({ value: s, label: tOr(t, `admin.status.${s}`, s) })),
        },
        plan: {
          kind: "options",
          label: t("admin.platform.plan"),
          options: [...(plans.data ?? []).map((p) => ({ value: p.id, label: p.name })), { value: NONE, label: t("admin.platform.defaultPlan") }],
        },
        app: {
          kind: "options",
          label: t("admin.platform.app"),
          options: [...(apps.data ?? []).map((a) => ({ value: a.appId, label: `${a.appId} · ${a.name}` })), { value: NONE, label: t("admin.platform.noApp") }],
        },
      }) satisfies ServerFilterDefs,
    [t, plans.data, apps.data],
  );

  const columns = React.useMemo<DataTableColumn<Tenant>[]>(
    () => [
      {
        id: "name",
        header: t("admin.platform.tenant"),
        sortable: true,
        hideable: false,
        card: "title",
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
        cardCell: (tn) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{tn.name}</span>
            <span className="truncate font-mono text-xs font-normal text-muted-foreground">{tn.slug}</span>
          </span>
        ),
      },
      {
        id: "plan",
        header: t("admin.platform.plan"),
        sortable: true,
        card: "meta",
        cell: (tn) =>
          tn.planId ? (
            <Badge variant="secondary">{planNames.get(tn.planId) ?? tn.planId}</Badge>
          ) : (
            <span className="text-muted-foreground">{t("admin.platform.defaultPlan")}</span>
          ),
      },
      {
        id: "app",
        header: t("admin.platform.app"),
        sortable: true,
        hideBelow: "lg",
        card: "meta",
        cell: (tn) => <span className="font-mono text-xs text-muted-foreground">{tn.appId ?? "—"}</span>,
      },
      { id: "status", header: t("admin.common.status"), sortable: true, card: "right", cell: (tn) => <StatusBadge status={tn.status} /> },
      {
        id: "created",
        header: t("admin.common.created"),
        sortable: true,
        sortDescFirst: true,
        hideBelow: "md",
        card: "meta",
        cell: (tn) => <span className="whitespace-nowrap text-muted-foreground">{tn.createdAt ? formatDate(tn.createdAt) : "—"}</span>,
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("admin.common.actions")}</span>,
        label: t("admin.common.actions"),
        hideable: false,
        align: "right",
        width: "48px",
        card: "right",
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
    ],
    [t, formatDate, planNames, router, switchTenant],
  );

  const st = useServerTable<Tenant, typeof filters>({
    queryKey: ["platform", "tenants", "table"],
    path: "/tenancy/tenants",
    columns,
    filters,
    defaultSort: "-created", // = TENANT_SORT default
    search: t("admin.platform.searchTenants"),
    storageKey: "admin-platform-tenants",
    getRowId: (tn) => tn.id,
  });

  return (
    <Page>
      <PageHeader
        eyebrow={t("admin.nav.platform")}
        title={t("admin.platform.tenantsTitle")}
        description={t("admin.platform.tenantsSubtitle")}
        actions={st.total !== undefined ? <span className="text-sm text-muted-foreground tabular-nums">{t("admin.platform.tenantCount", { count: st.total })}</span> : undefined}
      />
      <DataTableToolbar table={st.table} />
      <DataTable table={st.table} empty={<EmptyState compact icon={Building2Icon} title={t("admin.platform.noTenants")} />} />

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
