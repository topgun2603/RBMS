import { AppError } from "@rbms/core";
import { createDb } from "@rbms/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { webhookDeliveries } from "./schema";
import { DELIVERY_SORT, deliveryConditions, deliveryListSchema, istDayRange } from "./service";

// Never connects: only used to render SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const E1 = "22222222-2222-4222-8222-222222222222";

describe("delivery list", () => {
  it("parses comma lists, dates and limits", () => {
    const p = deliveryListSchema.parse({ status: "failed,pending", type: "order.placed,invoice.paid", endpointId: E1 });
    expect(p).toMatchObject({ status: ["failed", "pending"], type: ["order.placed", "invoice.paid"], endpointId: [E1], limit: 50, offset: 0 });
    expect(deliveryListSchema.parse({ status: "succeeded", limit: "100" })).toMatchObject({ status: ["succeeded"], limit: 100 });
    expect(() => deliveryListSchema.parse({ limit: "101" })).toThrow(ZodError);
    expect(() => deliveryListSchema.parse({ status: "ok" })).toThrow(ZodError);
    expect(() => deliveryListSchema.parse({ endpointId: "main" })).toThrow(ZodError);
    expect(() => deliveryListSchema.parse({ from: "2026-10-10", to: "2026-10-01" })).toThrow(ZodError);
  });

  it("filters by tenant, status, event, endpoint, IST days and search; facets drop their own filter", () => {
    const p = deliveryListSchema.parse({ status: "failed", type: "order.placed", endpointId: E1, from: "2026-10-01", to: "2026-10-31", q: "order" });
    const all = db.select().from(webhookDeliveries).where(deliveryConditions(T, p)).toSQL();
    expect(all.sql).toContain('"webhook_deliveries"."status" in ($');
    expect(all.sql).toContain('"webhook_deliveries"."type" in ($');
    expect(all.sql).toContain('"webhook_deliveries"."endpoint_id" in ($');
    expect(all.sql).toContain('"webhook_deliveries"."event_id"::text ilike');
    expect(all.params).toEqual(expect.arrayContaining([T, "failed", "order.placed", E1, "%order%", "2026-09-30T18:30:00.000Z", "2026-10-31T18:30:00.000Z"]));
    const noStatus = db.select().from(webhookDeliveries).where(deliveryConditions(T, p, "status")).toSQL();
    expect(noStatus.params).not.toContain("failed");
    expect(noStatus.params).toContain("order.placed");
    const noType = db.select().from(webhookDeliveries).where(deliveryConditions(T, p, "type")).toSQL();
    expect(noType.params).not.toContain("order.placed");
    expect(db.select().from(webhookDeliveries).where(deliveryConditions(T, deliveryListSchema.parse({}))).toSQL().params).toEqual([T]);
  });

  it("takes IST calendar days", () => {
    expect(istDayRange("2026-10-01", "2026-10-01")).toEqual({ start: new Date("2026-09-30T18:30:00.000Z"), end: new Date("2026-10-01T18:30:00.000Z") });
    expect(istDayRange(null, undefined)).toEqual({ start: null, end: null });
  });

  it("sorts by whitelisted fields only", () => {
    const render = (s?: string) => db.select().from(webhookDeliveries).orderBy(...DELIVERY_SORT.orderBy(s)).toSQL().sql;
    expect(render()).toContain('order by "webhook_deliveries"."created_at" desc nulls last, "webhook_deliveries"."id" desc');
    expect(render("statusCode")).toContain('order by "webhook_deliveries"."response_status" asc nulls last');
    expect(render("-attempts")).toContain('order by "webhook_deliveries"."attempts" desc nulls last');
    expect(DELIVERY_SORT.keys).toEqual(["time", "statusCode", "attempts"]);
    expect(() => render("payload")).toThrow(AppError);
  });
});
