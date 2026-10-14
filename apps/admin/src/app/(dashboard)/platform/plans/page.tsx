"use client";

import { z } from "zod";
import { EyeOffIcon, LayersIcon } from "lucide-react";
import { Badge } from "@srirealtime/ui";
import { jsonText, parseJsonObject, ResourcePage, splitTags, type ResourceConfig } from "@/components/crud/resource-page";
import { SuperAdminOnly } from "@/components/superadmin-only";
import { Page } from "@/components/page";
import { paiseToRupees } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/queries";
import type { Plan } from "@/lib/types";

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
  modules: z.string(),
  limits: z.string().refine(jsonText, "admin.validation.jsonObject"),
  features: z.string().refine(jsonText, "admin.validation.jsonObject"),
  isPublic: z.boolean(),
  sort: z.coerce.number({ invalid_type_error: "admin.validation.number" }).int("admin.validation.integer"),
});
type PlanValues = z.infer<typeof planSchema>;

export default function PlatformPlansPage() {
  return (
    <SuperAdminOnly>
      <Page>
        <PlansResource />
      </Page>
    </SuperAdminOnly>
  );
}

function PlansResource() {
  const { t, formatCurrency } = useI18n();
  const rupees = (paise: number) => (paise ? formatCurrency(paiseToRupees(paise), { maximumFractionDigits: 0 }) : t("admin.plans.free"));

  const config: ResourceConfig<Plan, PlanValues> = {
    title: t("admin.platform.plansTitle"),
    description: t("admin.platform.plansSubtitle"),
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
      name: "",
      description: "",
      priceMonthly: 0,
      priceYearly: 0,
      modules: "",
      limits: "{}",
      features: "{}",
      isPublic: true,
      sort: 0,
    },
    toForm: (p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? "",
      priceMonthly: paiseToRupees(p.priceMonthlyPaise),
      priceYearly: paiseToRupees(p.priceYearlyPaise),
      modules: p.modules.join(", "),
      limits: JSON.stringify(p.limits, null, 2),
      features: JSON.stringify(p.features, null, 2),
      isPublic: p.isPublic,
      sort: p.sort ?? 0,
    }),
    toBody: (v) => ({
      name: v.name,
      description: v.description.trim() || null,
      priceMonthlyPaise: Math.round(v.priceMonthly * 100),
      priceYearlyPaise: Math.round(v.priceYearly * 100),
      modules: splitTags(v.modules),
      limits: parseJsonObject<Record<string, number>>(v.limits),
      features: parseJsonObject<Record<string, boolean>>(v.features),
      isPublic: v.isPublic,
      sort: v.sort,
    }),
    fields: [
      { name: "id", label: t("admin.platform.planId"), lockOnEdit: true, placeholder: "pro", description: t("admin.platform.planIdHint") },
      { name: "name", label: t("admin.common.name"), placeholder: "Pro" },
      { name: "description", label: t("admin.common.description"), wide: true },
      { name: "priceMonthly", label: t("admin.platform.priceMonthly"), type: "number" },
      { name: "priceYearly", label: t("admin.platform.priceYearly"), type: "number" },
      { name: "modules", label: t("admin.plans.modules"), wide: true, placeholder: "notify, uploads, branding", description: t("admin.platform.modulesHint") },
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

  return <ResourcePage config={config} />;
}
