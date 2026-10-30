import { AppError } from "@rbms/core";
import { createDb } from "@rbms/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { waCampaigns } from "./schema";
import { CAMPAIGN_SORT, campaignListQuerySchema, WhatsAppService } from "./service";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const svc = new WhatsAppService({ db, secretKey: "x".repeat(32) });

const where = (q: Record<string, unknown>, withStatus = true) =>
  db
    .select()
    .from(waCampaigns)
    .where(svc.campaignConditions(T, campaignListQuerySchema.parse(q), withStatus))
    .toSQL();

describe("campaign list query", () => {
  it("keeps 30 / 100 per page and takes a status list", () => {
    expect(campaignListQuerySchema.parse({}).limit).toBe(30);
    expect(() => campaignListQuerySchema.parse({ limit: "101" })).toThrow(ZodError);
    expect(campaignListQuerySchema.parse({ status: "running,completed" }).status).toEqual(["running", "completed"]);
    expect(() => campaignListQuerySchema.parse({ status: "sent" })).toThrow(ZodError);
  });

  it("filters status and searches the name (escaped); the facet drops the status", () => {
    const q = where({ status: "draft", q: "diwali_50%" });
    expect(q.sql).toContain('"wa_campaigns"."status" in ($');
    expect(q.sql).toContain('"wa_campaigns"."name" ilike');
    expect(q.params).toEqual(expect.arrayContaining([T, "draft", "%diwali\\_50\\%%"]));
    expect(where({ status: "draft" }, false).params).not.toContain("draft");
  });

  it("sorts newest first by default, by sent time with unsent last", () => {
    const render = (s?: string) =>
      db
        .select()
        .from(waCampaigns)
        .orderBy(...CAMPAIGN_SORT.orderBy(s))
        .toSQL().sql;
    expect(render()).toContain('order by "wa_campaigns"."created_at" desc nulls last, "wa_campaigns"."id" desc');
    expect(render("-sent")).toContain('"wa_campaigns"."started_at" desc nulls last');
    expect(render("name")).toContain('lower("wa_campaigns"."name") asc nulls last');
    expect(() => render("audience")).toThrow(AppError);
    expect(CAMPAIGN_SORT.keys).toEqual(["name", "created", "sent", "scheduled", "status"]);
  });
});
