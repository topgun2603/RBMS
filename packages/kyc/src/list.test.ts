import { AppError } from "@rbms/core";
import { createDb } from "@rbms/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { REVIEW_SORT, reviewConditions, reviewFilter, reviewListQuerySchema } from "./list";
import { kycChecks, kycSubjects } from "./schema";
import { KycService } from "./service";
import { MemoryKycStore } from "./store";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const VENDOR = "33333333-3333-4333-8333-333333333333";
const VENDOR2 = "66666666-6666-4666-8666-666666666666";
const ADMIN = "55555555-5555-4555-8555-555555555555";

const parse = (q: Record<string, unknown>) => reviewFilter(reviewListQuerySchema.parse(q));
const where = (q: Record<string, unknown>, omit?: "status" | "type") =>
  db
    .select()
    .from(kycChecks)
    .innerJoin(kycSubjects, eq(kycSubjects.id, kycChecks.subjectId))
    .where(reviewConditions(parse(q), omit))
    .toSQL();

describe("review list query", () => {
  it("defaults to the queue; `all` lifts the status filter", () => {
    expect(parse({})).toMatchObject({ tenantId: null, statuses: ["manual_review"] });
    expect(parse({ status: "verified,failed" }).statuses).toEqual(["verified", "failed"]);
    expect(parse({ status: "all" }).statuses).toBeNull();
    expect(parse({ type: "bank_account,upi", tenantId: TENANT })).toMatchObject({ tenantId: TENANT, types: ["bank_account", "upi"] });
    expect(reviewListQuerySchema.parse({}).limit).toBe(50);
    expect(() => reviewListQuerySchema.parse({ limit: "201" })).toThrow(ZodError);
    expect(() => reviewListQuerySchema.parse({ type: "passport" })).toThrow(ZodError);
    expect(() => reviewListQuerySchema.parse({ tenantId: "shop-1" })).toThrow(ZodError);
  });

  it("renders the filters and the name search", () => {
    const q = where({ tenantId: TENANT, type: "upi", q: "meena%" });
    expect(q.sql).toContain('"kyc_checks"."tenant_id" = $');
    expect(q.sql).toContain('"kyc_checks"."status" in ($');
    expect(q.sql).toContain('"kyc_checks"."type" in ($');
    expect(q.sql).toContain('"kyc_checks"."name_on_record" ilike');
    expect(q.sql).toContain(`"kyc_checks"."input_masked"->>'name' ilike`);
    expect(q.sql).toContain('"kyc_subjects"."verified_name" ilike');
    expect(q.params).toEqual([TENANT, "manual_review", "upi", "%meena\\%%", "%meena\\%%", "%meena\\%%"]);
    expect(where({ status: "all" }).sql).not.toContain('"kyc_checks"."status" in');
    expect(where({ type: "pan" }, "type").params).toEqual(["manual_review"]);
  });

  it("sorts by submitted (oldest first by default) or name-match score only", () => {
    const render = (s?: string) => db.select().from(kycChecks).orderBy(...REVIEW_SORT.orderBy(s)).toSQL().sql;
    expect(REVIEW_SORT.keys).toEqual(["submitted", "match"]);
    expect(render()).toContain('order by "kyc_checks"."created_at" asc nulls last, "kyc_checks"."id" asc');
    expect(render("-match")).toContain('"kyc_checks"."name_match_score" desc nulls last');
    expect(() => render("name")).toThrow(AppError);
  });
});

describe("review list (memory store)", () => {
  async function seeded() {
    let clock = new Date("2026-10-15T06:00:00Z").getTime();
    const now = () => new Date((clock += 1000));
    const store = new MemoryKycStore(now);
    const service = new KycService({ store, config: { allowMock: true, secret: "s" }, now });
    const vendor = (subjectId: string, type: string, input: Record<string, unknown>) => ({ subjectType: "vendor" as const, subjectId, type: type as never, input });
    await service.submitCheck(TENANT, ADMIN, vendor(VENDOR, "pan", { pan: "ABCDE1234F" })); // verified, TEST NAME
    await service.submitCheck(TENANT, ADMIN, vendor(VENDOR, "bank_account", { accountNumber: "123456789999", ifsc: "SBIN0001234" })); // review
    await service.submitCheck(OTHER, ADMIN, vendor(VENDOR2, "pan", { pan: "ABCDE1234F" }));
    await service.submitCheck(OTHER, ADMIN, vendor(VENDOR2, "upi", { vpa: "someone@upi" }));
    return { service, store };
  }

  it("filters, counts facets under the other filters and pages", async () => {
    const { service, store } = await seeded();
    const statuses = store.checks.map((c) => c.status);
    const queue = await service.reviewQueue();
    expect(queue.total).toBe(statuses.filter((s) => s === "manual_review").length);
    expect(queue.items.every((i) => i.check.status === "manual_review")).toBe(true);
    expect(queue).toMatchObject({ limit: 50, offset: 0 });

    const all = await service.reviewQueue({ status: "all" });
    expect(all.total).toBe(store.checks.length);
    expect(all.facets.status).toEqual(statuses.reduce<Record<string, number>>((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {}));
    expect(all.facets.type.pan).toBe(2);

    const pans = await service.reviewQueue({ status: "all", type: "pan" });
    expect(pans.total).toBe(2);
    expect(pans.facets.type.pan).toBe(2); // the type facet ignores the type filter
    expect(pans.facets.type.bank_account).toBe(1);

    const shop = await service.reviewQueue({ status: "all", tenantId: OTHER });
    expect(shop.items.every((i) => i.subject.tenantId === OTHER)).toBe(true);

    const page2 = await service.reviewQueue({ status: "all", limit: 3, offset: 3 });
    expect(page2.items).toHaveLength(store.checks.length - 3);
  });

  it("searches names and sorts by score with unscored checks last", async () => {
    const { service, store } = await seeded();
    const named = store.checks.find((c) => c.nameOnRecord)!;
    const hit = await service.reviewQueue({ status: "all", q: named.nameOnRecord!.slice(1, 5).toLowerCase() });
    expect(hit.items.map((i) => i.check.id)).toContain(named.id);
    expect((await service.reviewQueue({ status: "all", q: "zzz-no-such-name" })).total).toBe(0);

    const byScore = await service.reviewQueue({ status: "all", sort: "-match" });
    const scores = byScore.items.map((i) => i.check.nameMatchScore);
    const scored = scores.filter((s): s is number => s !== null);
    expect(scores.slice(0, scored.length)).toEqual([...scored].sort((a, b) => b - a));
    expect(scores.slice(scored.length).every((s) => s === null)).toBe(true);

    const oldest = await service.reviewQueue({ status: "all" });
    const times = oldest.items.map((i) => new Date(i.check.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    await expect(service.reviewQueue({ sort: "tenant" })).rejects.toBeInstanceOf(AppError);
  });
});
