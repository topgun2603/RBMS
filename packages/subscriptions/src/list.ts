import { defineSort, listFilter, listQuerySchema, rangeOrder, searchAny, splitList, type SortSpec } from "@srirealtime/core";
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { monthlyValue } from "./logic";
import type { PlanInfo } from "./ports";
import { platformInvoices, SUBSCRIPTION_PROVIDERS, SUBSCRIPTION_STATUSES, subscriptions } from "./schema";

/*
 * Super-admin lists (docs/CONVENTIONS.md → "Lists and tables"):
 *   GET /v1/subscriptions/admin/subscriptions?q&status&plan&provider&sort&limit&offset → facets { status, plan, provider }
 *   GET /v1/subscriptions/admin/invoices?q&status&tenantId&from&to&sort&limit&offset → facets { status }
 */

/** `provider=none`: subscriptions with no provider (free plan, nothing to charge). */
export const NO_PROVIDER = "none";
export const PROVIDER_FILTERS = [...SUBSCRIPTION_PROVIDERS, NO_PROVIDER] as const;
export const PLATFORM_INVOICE_STATUSES = ["paid", "void"] as const;

const planIds = z.preprocess(splitList, z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "Invalid plan id").max(40)).max(50).optional());

export const subscriptionListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200 }).extend({
  status: listFilter.oneOf(SUBSCRIPTION_STATUSES),
  plan: planIds,
  provider: listFilter.oneOf(PROVIDER_FILTERS),
});
export type SubscriptionListQuery = z.input<typeof subscriptionListQuerySchema>;
export type SubscriptionListParams = z.output<typeof subscriptionListQuerySchema>;

export const platformInvoiceListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200 })
  .extend({
    status: listFilter.oneOf(PLATFORM_INVOICE_STATUSES),
    tenantId: listFilter.id(),
    from: listFilter.date(),
    to: listFilter.date(),
  })
  .superRefine(rangeOrder("from", "to"));
export type PlatformInvoiceListQuery = z.input<typeof platformInvoiceListQuerySchema>;
export type PlatformInvoiceListParams = z.output<typeof platformInvoiceListQuerySchema>;

// ---------------------------------------------------------------------------------------------- subscriptions

/**
 * The date the "Next" column shows: trial end while trialing, grace end while past due, else the period end
 * (renewal, cancellation or the end of a complimentary plan).
 */
export const nextDateSql = sql`(case ${subscriptions.status} when 'trialing' then ${subscriptions.trialEndsAt} when 'past_due' then ${subscriptions.graceEndsAt} else ${subscriptions.currentPeriodEnd} end)`;

/**
 * The shop's name for sorting. The tenancy module owns `tenants` (core table of every host); a correlated lookup keeps
 * the list query free of a join the WHERE doesn't need.
 */
export const shopNameSql = sql`(select lower(t.name) from tenants t where t.id = ${subscriptions.tenantId})`;

/** MRR as SQL, the same rule as SubscriptionsService.mrrOf: paying (active / past due, charged, mandate authorised). */
export function mrrSql(plans: readonly PlanInfo[]): SQL {
  const priced = plans.filter((p) => monthlyValue(p, "monthly") > 0 || monthlyValue(p, "yearly") > 0);
  if (!priced.length) return sql`0`;
  const arms = sql.join(
    priced.map(
      (p) =>
        sql`when ${p.id} then (case when ${subscriptions.interval} = 'yearly' then ${monthlyValue(p, "yearly")}::int else ${monthlyValue(p, "monthly")}::int end)`,
    ),
    sql` `,
  );
  return sql`(case when ${subscriptions.provider} in ('razorpay', 'mock') and ${subscriptions.status} in ('active', 'past_due') and ${subscriptions.authUrl} is null then (case ${subscriptions.planId} ${arms} else 0 end) else 0 end)`;
}

/** Plans in their catalogue order (`sort`), unknown plan ids last. */
function planOrderSql(plans: readonly PlanInfo[]): SQL {
  if (!plans.length) return sql`${subscriptions.planId}`;
  const arms = sql.join(
    plans.map((p) => sql`when ${p.id} then ${p.sort}::int`),
    sql` `,
  );
  return sql`(case ${subscriptions.planId} ${arms} else null end)`;
}

export type SubscriptionSortKey = "shop" | "plan" | "status" | "next" | "mrr" | "updated";

/** Sort spec for the subscription list; plan order and MRR come from the current plan catalogue. */
export function subscriptionSort(plans: readonly PlanInfo[]): SortSpec<SubscriptionSortKey> {
  return defineSort(
    {
      shop: shopNameSql,
      plan: planOrderSql(plans),
      status: subscriptions.status,
      next: nextDateSql,
      mrr: mrrSql(plans),
      updated: subscriptions.updatedAt,
    },
    { default: "-updated", tieBreaker: subscriptions.id },
  );
}

/**
 * WHERE of the subscription list; `omit` leaves one filter out (its facet counts). `shopIds` are the tenants whose
 * name/slug matched `q` (TenancyPort.search); `q` also matches the plan id.
 */
export function subscriptionListConditions(p: SubscriptionListParams, shopIds: readonly string[] = [], omit?: "status" | "plan" | "provider"): SQL | undefined {
  const providers = p.provider ?? [];
  const realProviders = providers.filter((v): v is (typeof SUBSCRIPTION_PROVIDERS)[number] => v !== NO_PROVIDER);
  const providerCond =
    omit !== "provider" && providers.length
      ? or(realProviders.length ? inArray(subscriptions.provider, realProviders) : undefined, providers.includes(NO_PROVIDER) ? isNull(subscriptions.provider) : undefined)
      : undefined;
  const search = searchAny(p.q, [subscriptions.planId]);
  return and(
    omit !== "status" && p.status?.length ? inArray(subscriptions.status, p.status) : undefined,
    omit !== "plan" && p.plan?.length ? inArray(subscriptions.planId, p.plan) : undefined,
    providerCond,
    search && shopIds.length ? or(search, inArray(subscriptions.tenantId, [...shopIds])) : search,
  );
}

// ---------------------------------------------------------------------------------------------- platform invoices

export const PLATFORM_INVOICE_SORT = defineSort(
  {
    number: sql`(${platformInvoices.fy}, ${platformInvoices.seq})`,
    date: platformInvoices.date,
    total: platformInvoices.totalPaise,
  },
  { default: "-date", tieBreaker: [platformInvoices.createdAt, platformInvoices.id] },
);

/** WHERE of the invoice list; `omit` leaves the status filter out (its facet counts). */
export function platformInvoiceListConditions(p: PlatformInvoiceListParams, shopIds: readonly string[] = [], omit?: "status"): SQL | undefined {
  const search = searchAny(p.q, [platformInvoices.number, sql`${platformInvoices.buyer}->>'legalName'`, sql`${platformInvoices.buyer}->>'gstin'`]);
  return and(
    omit !== "status" && p.status?.length ? inArray(platformInvoices.status, p.status) : undefined,
    p.tenantId ? eq(platformInvoices.tenantId, p.tenantId) : undefined,
    p.from ? sql`${platformInvoices.date} >= ${p.from}` : undefined,
    p.to ? sql`${platformInvoices.date} <= ${p.to}` : undefined,
    search && shopIds.length ? or(search, inArray(platformInvoices.tenantId, [...shopIds])) : search,
  );
}
