"use client";

import * as React from "react";
import { z } from "zod";
import { EyeOffIcon, LayersIcon } from "lucide-react";
import { Badge, cn } from "@srirealtime/ui";
import { jsonText, parseJsonObject, ResourcePage, type ResourceConfig } from "@/components/crud/resource-page";
import { PlanModulesPicker } from "@/components/features/plan-modules-picker";
import { useAppProfiles } from "@/lib/features";
import { paiseToRupees } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { PLAN_TIERS, planIdFor } from "@/lib/plans";
import { qk } from "@/lib/queries";
import type { Plan } from "@/lib/types";

const SHARED = "__shared";

const money = z.coerce.number({ invalid_type_error: "admin.validation.number" }).min(0, "admin.validation.nonNegative");

const planSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, "admin.platform.planIdInvalid"),
  name: z.string().trim().min(1, "admin.validation.required").max(80, "admin.validation.tooLong"),
  description: z.string().max(500, "admin.validation.tooLong"),
  priceMonthly: money,
  priceYearly: money,
  modules: z.array(z.string()),
  limits: z.string().refine(jsonText, "admin.validation.jsonObject"),
  features: z.string().refine(jsonText, "admin.validation.jsonObject"),
  appId: z.string(),
  tier: z.string(),
  isPublic: z.boolean(),
  sort: z.coerce.number({ invalid_type_error: "admin.validation.number" }).int("admin.validation.integer"),
});
type PlanValues = z.infer<typeof planSchema>;

/**
 * Plans (super-admin): each app's own plans, one per tier, plus shared templates (no app). `appId` fixes the list to
 * one app (Apps & features embeds it per app); otherwise app chips filter it.
 */
export function PlansResource({ appId: fixedApp, embedded }: { appId?: string; embedded?: boolean }) {
  const { t, formatCurrency } = useI18n();
  const apps = useAppProfiles();
  const [chosen, setChosen] = React.useState<string>("all");
  const app = fixedApp ?? chosen;
  const appName = (id: string | null | undefined) => (id ? (apps.data?.find((a) => a.appId === id)?.name ?? id) : t("admin.plansUi.shared"));
  const appOptions = [{ value: SHARED, label: t("admin.plansUi.sharedOption") }, ...(apps.data ?? []).map((a) => ({ value: a.appId, label: `${a.name} (${a.appId})` }))];
  const chips = [{ value: "all", label: t("admin.plansUi.allApps") }, ...(apps.data ?? []).map((a) => ({ value: a.appId, label: a.name })), { value: SHARED, label: t("admin.plansUi.shared") }];
  const rupees = (paise: number) => (paise ? formatCurrency(paiseToRupees(paise), { maximumFractionDigits: 0 }) : t("admin.plans.free"));

  const config: ResourceConfig<Plan, PlanValues> = {
    title: t("admin.platform.plansTitle"),
    description: t("admin.plansUi.subtitle"),
    embedded,
    filter: (p) => (app === "all" ? true : app === SHARED ? !p.appId : p.appId === app),
    toolbar: fixedApp ? undefined : (
      <div role="radiogroup" aria-label={t("admin.plansUi.app")} className="flex flex-wrap gap-1">
        {chips.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={chosen === o.value}
            onClick={() => setChosen(o.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              chosen === o.value ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    ),
    icon: LayersIcon,
    queryKey: qk.plans(true),
    list: { path: "/plans", query: { all: 1 } },
    getId: (p) => p.id,
    search: (p, q) => [p.id, p.name, p.description ?? "", ...p.modules].some((s) => s.toLowerCase().includes(q)),
    columns: [
      {
        id: "name",
        header: t("admin.platform.plan"),
        cell: (p) => (
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium">
              {p.name}
              {!p.isPublic && (
                <Badge variant="muted" className="gap-1">
                  <EyeOffIcon /> {t("admin.platform.private")}
                </Badge>
              )}
            </div>
            <div className="font-mono text-xs text-muted-foreground">{p.id}</div>
          </div>
        ),
      },
      ...(fixedApp
        ? []
        : [
            {
              id: "app",
              header: t("admin.plansUi.app"),
              cell: (p: Plan) => (
                <div className="grid">
                  <span className={cn("text-sm", !p.appId && "text-muted-foreground")}>{appName(p.appId)}</span>
                  {p.tier && <span className="text-xs text-muted-foreground">{t(`admin.plansUi.tier.${p.tier}`)}</span>}
                </div>
              ),
            },
          ]),
      { id: "monthly", header: t("admin.plans.monthly"), align: "right", cell: (p) => <span className="tabular-nums">{rupees(p.priceMonthlyPaise)}</span> },
      {
        id: "yearly",
        header: t("admin.plans.yearly"),
        align: "right",
        hideBelow: "sm",
        cell: (p) => <span className="tabular-nums">{rupees(p.priceYearlyPaise)}</span>,
      },
      {
        id: "modules",
        header: t("admin.plans.modules"),
        hideBelow: "md",
        className: "whitespace-normal",
        cell: (p) => (
          <div className="flex max-w-sm flex-wrap gap-1">
            {p.modules.slice(0, 6).map((m) => (
              <Badge key={m} variant="outline" className="font-normal">
                {m}
              </Badge>
            ))}
            {p.modules.length > 6 && <Badge variant="muted">+{p.modules.length - 6}</Badge>}
          </div>
        ),
      },
      {
        id: "limits",
        header: t("admin.platform.limits"),
        hideBelow: "lg",
        cell: (p) => <span className="text-muted-foreground">{Object.keys(p.limits).length}</span>,
      },
    ],
    schema: planSchema,
    defaults: {
      id: "",
      appId: fixedApp ?? (app !== "all" && app !== SHARED ? app : SHARED),
      tier: "starter",
      name: "",
      description: "",
      priceMonthly: 0,
      priceYearly: 0,
      modules: [],
      limits: "{}",
      features: "{}",
      isPublic: true,
      sort: 0,
    },
    toForm: (p) => ({
      id: p.id,
      appId: p.appId ?? SHARED,
      tier: p.tier ?? "",
      name: p.name,
      description: p.description ?? "",
      priceMonthly: paiseToRupees(p.priceMonthlyPaise),
      priceYearly: paiseToRupees(p.priceYearlyPaise),
      modules: [...p.modules],
      limits: JSON.stringify(p.limits, null, 2),
      features: JSON.stringify(p.features, null, 2),
      isPublic: p.isPublic,
      sort: p.sort ?? 0,
    }),
    toBody: (v) => ({
      appId: v.appId === SHARED ? null : v.appId,
      tier: v.tier || null,
      name: v.name,
      description: v.description.trim() || null,
      priceMonthlyPaise: Math.round(v.priceMonthly * 100),
      priceYearlyPaise: Math.round(v.priceYearly * 100),
      modules: v.modules.map((m) => m.trim()).filter(Boolean),
      limits: parseJsonObject<Record<string, number>>(v.limits),
      features: parseJsonObject<Record<string, boolean>>(v.features),
      isPublic: v.isPublic,
      sort: v.sort,
    }),
    fields: [
      { name: "appId", label: t("admin.plansUi.app"), type: "select", options: appOptions, lockOnEdit: true, description: t("admin.plansUi.appHint") },
      {
        name: "tier",
        label: t("admin.plansUi.tierLabel"),
        type: "select",
        options: PLAN_TIERS.map((x) => ({ value: x, label: t(`admin.plansUi.tier.${x}`) })),
        description: t("admin.plansUi.tierHint"),
      },
      {
        name: "id",
        label: t("admin.platform.planId"),
        lockOnEdit: true,
        placeholder: planIdFor(fixedApp ?? (app !== "all" && app !== SHARED ? app : null), "pro"),
        description: t("admin.plansUi.planIdHint"),
      },
      { name: "name", label: t("admin.common.name"), placeholder: "Pro" },
      { name: "description", label: t("admin.common.description"), wide: true },
      { name: "priceMonthly", label: t("admin.platform.priceMonthly"), type: "number" },
      { name: "priceYearly", label: t("admin.platform.priceYearly"), type: "number" },
      {
        name: "modules",
        label: t("admin.featuresUi.planFeatures"),
        type: "custom",
        description: t("admin.featuresUi.planFeaturesHint"),
        render: ({ value, onChange, disabled }) => (
          <PlanModulesPicker value={(value as string[] | undefined) ?? []} onChange={onChange} disabled={disabled} />
        ),
      },
      { name: "limits", label: t("admin.platform.limits"), type: "json", description: t("admin.platform.limitsHint") },
      { name: "features", label: t("admin.platform.features"), type: "json", description: t("admin.platform.featuresHint") },
      { name: "isPublic", label: t("admin.platform.public"), type: "switch", description: t("admin.platform.publicHint") },
      { name: "sort", label: t("admin.platform.sort"), type: "number" },
    ],
    create: { method: "PUT", path: (v) => `/plans/${encodeURIComponent(v.id)}` },
    update: { method: "PUT", path: (p) => `/plans/${encodeURIComponent(p.id)}` },
    remove: { path: (p) => `/plans/${encodeURIComponent(p.id)}` },
    labels: {
      createTitle: t("admin.platform.newPlan"),
      editTitle: t("admin.platform.editPlan"),
      createButton: t("admin.platform.newPlan"),
      deleteTitle: (p) => t("admin.platform.deletePlan", { name: p.name }),
      deleteDescription: t("admin.platform.deletePlanDescription"),
      emptyTitle: t("admin.plans.emptyTitle"),
      emptyDescription: t("admin.platform.plansEmptyHint"),
      searchPlaceholder: t("admin.platform.searchPlans"),
    },
    dialogClassName: "sm:max-w-3xl",
  };

  return <ResourcePage key={app} config={config} />;
}
