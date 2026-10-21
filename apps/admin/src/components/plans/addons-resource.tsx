"use client";

import * as React from "react";
import { z } from "zod";
import { CoinsIcon, EyeOffIcon, PuzzleIcon, SparklesIcon } from "lucide-react";
import { Badge } from "@srirealtime/ui";
import { jsonText, parseJsonObject, ResourcePage, type ResourceConfig } from "@/components/crud/resource-page";
import { PlanModulesPicker } from "@/components/features/plan-modules-picker";
import { paiseToRupees } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { PLAN_TIERS } from "@/lib/plans";
import type { PlanAddon } from "@/lib/types";

const KINDS = ["limit", "feature", "credits"] as const;
const money = z.coerce.number({ invalid_type_error: "admin.validation.number" }).min(0, "admin.validation.nonNegative");
const count = z.coerce.number({ invalid_type_error: "admin.validation.number" }).int("admin.validation.integer").min(1, "admin.validation.nonNegative");

const addonSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, "admin.addonsUi.codeInvalid"),
  kind: z.enum(KINDS),
  name: z.string().trim().min(1, "admin.validation.required").max(80, "admin.validation.tooLong"),
  description: z.string().max(500, "admin.validation.tooLong"),
  limits: z.string().refine(jsonText, "admin.validation.jsonObject"),
  modules: z.array(z.string()),
  priceMonthly: money,
  priceYearly: money,
  priceOnce: money,
  minQuantity: count,
  maxQuantity: count,
  tiers: z.array(z.string()),
  isPublic: z.boolean(),
  sort: z.coerce.number({ invalid_type_error: "admin.validation.number" }).int("admin.validation.integer"),
});
type AddonValues = z.infer<typeof addonSchema>;

/**
 * Add-ons of one app (super-admin), in Apps & features next to its Plans: extra staff, branches, WhatsApp messages,
 * storage (limit), features not in the plan (feature) and credits packs (credits). Ids are `<app>-<code>`; an app's
 * add-on replaces the shared one of the same code.
 */
export function AddonsResource({ appId, embedded }: { appId: string; embedded?: boolean }) {
  const { t, formatCurrency } = useI18n();
  const rupees = (paise: number) => formatCurrency(paiseToRupees(paise), { maximumFractionDigits: 0 });
  const prefix = `${appId.toLowerCase()}-`;
  const price = (a: PlanAddon) =>
    a.kind === "credits" ? `${rupees(a.priceOncePaise)} ${t("admin.addonsUi.once")}` : `${rupees(a.priceMonthlyPaise)} / ${rupees(a.priceYearlyPaise)}`;
  const kindIcon = { limit: PuzzleIcon, feature: SparklesIcon, credits: CoinsIcon } as const;

  const config: ResourceConfig<PlanAddon, AddonValues> = {
    title: t("admin.addonsUi.title"),
    description: t("admin.addonsUi.subtitle"),
    embedded,
    // The app's own add-ons (an edit here always saves to this app).
    filter: (a) => a.appId === appId,
    icon: PuzzleIcon,
    queryKey: ["platform", "addons", appId],
    list: { path: "/plans/addons", query: { all: 1, app: appId } },
    getId: (a) => a.id,
    search: (a, q) => [a.id, a.name, a.code, a.description ?? ""].some((s) => s.toLowerCase().includes(q)),
    columns: [
      {
        id: "name",
        header: t("admin.addonsUi.addon"),
        cell: (a) => {
          const Icon = kindIcon[a.kind];
          return (
            <div className="flex min-w-0 items-start gap-2">
              <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  {a.name}
                  {!a.isPublic && (
                    <Badge variant="muted" className="gap-1">
                      <EyeOffIcon /> {t("admin.platform.private")}
                    </Badge>
                  )}
                </div>
                <div className="font-mono text-xs text-muted-foreground">{a.id}</div>
              </div>
            </div>
          );
        },
      },
      { id: "kind", header: t("admin.addonsUi.kind"), cell: (a) => <span className="text-sm">{t(`admin.addonsUi.kinds.${a.kind}`)}</span> },
      {
        id: "adds",
        header: t("admin.addonsUi.adds"),
        hideBelow: "md",
        className: "whitespace-normal",
        cell: (a) => (
          <div className="flex max-w-xs flex-wrap gap-1">
            {(a.kind === "feature" ? a.modules : Object.entries(a.limits).map(([k, n]) => `${k} +${n}`)).map((x) => (
              <Badge key={x} variant="outline" className="font-normal">
                {x}
              </Badge>
            ))}
          </div>
        ),
      },
      { id: "price", header: t("admin.addonsUi.price"), align: "right", cell: (a) => <span className="tabular-nums">{price(a)}</span> },
      {
        id: "tiers",
        header: t("admin.addonsUi.tiers"),
        hideBelow: "lg",
        cell: (a) => <span className="text-sm text-muted-foreground">{a.tiers.length ? a.tiers.map((x) => t(`admin.plansUi.tier.${x}`)).join(", ") : t("admin.addonsUi.allTiers")}</span>,
      },
    ],
    schema: addonSchema,
    defaults: {
      code: "",
      kind: "limit",
      name: "",
      description: "",
      limits: '{\n  "staff": 5\n}',
      modules: [],
      priceMonthly: 0,
      priceYearly: 0,
      priceOnce: 0,
      minQuantity: 1,
      maxQuantity: 1,
      tiers: ["starter", "pro"],
      isPublic: true,
      sort: 0,
    },
    toForm: (a) => ({
      code: a.code,
      kind: a.kind,
      name: a.name,
      description: a.description ?? "",
      limits: JSON.stringify(a.limits, null, 2),
      modules: [...a.modules],
      priceMonthly: paiseToRupees(a.priceMonthlyPaise),
      priceYearly: paiseToRupees(a.priceYearlyPaise),
      priceOnce: paiseToRupees(a.priceOncePaise),
      minQuantity: a.minQuantity,
      maxQuantity: a.maxQuantity,
      tiers: [...a.tiers],
      isPublic: a.isPublic,
      sort: a.sort ?? 0,
    }),
    toBody: (v) => ({
      code: v.code,
      appId,
      kind: v.kind,
      name: v.name,
      description: v.description.trim() || null,
      limits: v.kind === "feature" ? {} : parseJsonObject<Record<string, number>>(v.limits),
      modules: v.kind === "feature" ? v.modules.map((m) => m.trim()).filter(Boolean) : [],
      priceMonthlyPaise: v.kind === "credits" ? 0 : Math.round(v.priceMonthly * 100),
      priceYearlyPaise: v.kind === "credits" ? 0 : Math.round(v.priceYearly * 100),
      priceOncePaise: v.kind === "credits" ? Math.round(v.priceOnce * 100) : 0,
      minQuantity: v.minQuantity,
      maxQuantity: v.maxQuantity,
      tiers: v.tiers.map((x) => x.trim()).filter((x) => (PLAN_TIERS as readonly string[]).includes(x)),
      isPublic: v.isPublic,
      sort: v.sort,
    }),
    fields: [
      { name: "code", label: t("admin.addonsUi.code"), lockOnEdit: true, placeholder: "extra-staff", description: t("admin.addonsUi.codeHint", { id: `${prefix}extra-staff` }) },
      { name: "kind", label: t("admin.addonsUi.kind"), type: "select", options: KINDS.map((k) => ({ value: k, label: t(`admin.addonsUi.kinds.${k}`) })), description: t("admin.addonsUi.kindHint") },
      { name: "name", label: t("admin.common.name"), placeholder: "Extra staff (+5)" },
      { name: "description", label: t("admin.common.description"), wide: true },
      { name: "limits", label: t("admin.addonsUi.limits"), type: "json", description: t("admin.addonsUi.limitsHint") },
      {
        name: "modules",
        label: t("admin.addonsUi.modules"),
        type: "custom",
        description: t("admin.addonsUi.modulesHint"),
        render: ({ value, onChange, disabled }) => <PlanModulesPicker value={(value as string[] | undefined) ?? []} onChange={onChange} disabled={disabled} />,
      },
      { name: "priceMonthly", label: t("admin.platform.priceMonthly"), type: "number" },
      { name: "priceYearly", label: t("admin.platform.priceYearly"), type: "number" },
      { name: "priceOnce", label: t("admin.addonsUi.priceOnce"), type: "number", description: t("admin.addonsUi.priceOnceHint") },
      { name: "minQuantity", label: t("admin.addonsUi.minQuantity"), type: "number" },
      { name: "maxQuantity", label: t("admin.addonsUi.maxQuantity"), type: "number" },
      { name: "tiers", label: t("admin.addonsUi.tiers"), type: "tags", description: t("admin.addonsUi.tiersHint") },
      { name: "isPublic", label: t("admin.platform.public"), type: "switch", description: t("admin.addonsUi.publicHint") },
      { name: "sort", label: t("admin.platform.sort"), type: "number" },
    ],
    create: { method: "PUT", path: (v) => `/plans/addons/${encodeURIComponent(prefix + v.code)}` },
    update: { method: "PUT", path: (a) => `/plans/addons/${encodeURIComponent(a.id)}` },
    remove: { path: (a) => `/plans/addons/${encodeURIComponent(a.id)}` },
    labels: {
      createTitle: t("admin.addonsUi.new"),
      editTitle: t("admin.addonsUi.edit"),
      createButton: t("admin.addonsUi.new"),
      deleteTitle: (a) => t("admin.addonsUi.delete", { name: a.name }),
      deleteDescription: t("admin.addonsUi.deleteHint"),
      emptyTitle: t("admin.addonsUi.empty"),
      emptyDescription: t("admin.addonsUi.emptyHint"),
      searchPlaceholder: t("admin.addonsUi.search"),
    },
    dialogClassName: "sm:max-w-3xl",
  };

  return <ResourcePage config={config} />;
}
