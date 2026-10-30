import { defineSort, listFilter, listQuerySchema, searchAny, splitList } from "@rbms/core";
import { and, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { TENANT_STATUSES, tenants } from "./schema";

/*
 * Super-admin tenant list (GET /v1/tenancy/tenants), docs/CONVENTIONS.md → "Lists and tables".
 *   ?q=meena&status=active&plan=starter,none&app=BL&sort=-created&limit=25&offset=0
 *   → { items, total, limit, offset, facets: { status, plan, app } }
 */

/** `plan=none` / `app=none`: tenants without a plan (the default plan) or without an app. */
export const NONE = "none";

const idList = (re: RegExp) =>
  z.preprocess(splitList, z.array(z.string().regex(re, "Invalid value").max(40)).max(50).optional());

export const tenantListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200 }).extend({
  status: listFilter.oneOf(TENANT_STATUSES),
  plan: idList(/^[a-z0-9][a-z0-9_-]*$/),
  app: idList(/^[A-Za-z0-9_-]{1,32}$/),
});
export type TenantListQuery = z.input<typeof tenantListQuerySchema>;
export type TenantListParams = z.output<typeof tenantListQuerySchema>;

export const TENANT_SORT = defineSort(
  {
    name: sql`lower(${tenants.name})`,
    created: tenants.createdAt,
    plan: tenants.planId,
    status: tenants.status,
    app: tenants.appId,
  },
  { default: "-created", tieBreaker: tenants.id },
);

/** Matches a nullable column against values where `none` means "is null". */
function valueOrNone(col: typeof tenants.planId | typeof tenants.appId, values: string[] | undefined): SQL | undefined {
  if (!values?.length) return undefined;
  const real = values.filter((v) => v !== NONE);
  const parts = [real.length ? inArray(col, real) : undefined, values.includes(NONE) ? isNull(col) : undefined].filter(Boolean) as SQL[];
  return parts.length === 1 ? parts[0] : or(...parts);
}

/** WHERE of the list; `omit` leaves one filter out (its facet counts). */
export function tenantListConditions(p: TenantListParams, omit?: "status" | "plan" | "app"): SQL | undefined {
  return and(
    omit !== "status" && p.status?.length ? inArray(tenants.status, p.status) : undefined,
    omit !== "plan" ? valueOrNone(tenants.planId, p.plan) : undefined,
    omit !== "app" ? valueOrNone(tenants.appId, p.app) : undefined,
    searchAny(p.q, [tenants.name, tenants.slug]),
  );
}
