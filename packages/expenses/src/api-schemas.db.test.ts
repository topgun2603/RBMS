/**
 * Database test of the API document shapes (routes.ts): runs the expense routes the mobile app uses (categories list /
 * create / rename / delete, expense list with filters, create, get, update, cancel, summary) against Postgres and checks
 * every JSON answer with its response schema, so the schemas can't drift from what the routes really return. Runs only
 * with `EXPENSES_TEST_DATABASE_URL` set (a development Postgres with the expenses tables migrated); it copies them into
 * a throw-away schema and drops it afterwards.
 *   PowerShell: $env:EXPENSES_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5433/srikit"; pnpm test
 */
import { emptyContext, type RequestContext } from "@rbms/core";
import { createDb, type Db } from "@rbms/db";
import { todayIST } from "@rbms/gst";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance, type RouteOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError, type ZodTypeAny } from "zod";
import { EXPENSES_PERMISSION } from "./ports";
import {
  expenseCategoryListSchema,
  expenseCategorySchema,
  expenseListSchema,
  expenseSchema,
  expensesRoutes,
  expenseSummarySchema,
} from "./routes";
import { ExpensesService } from "./service";

const URL_ = process.env.EXPENSES_TEST_DATABASE_URL;
const SCHEMA = `expenses_it_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["expense_categories", "expenses"];
const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "pro", appId: "BL" };
const user = { id: "22222222-2222-4222-8222-222222222222", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"], permissions: [EXPENSES_PERMISSION] };

describe.skipIf(!URL_)("expenses API shapes against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let app: FastifyInstance;
  const today = todayIST(new Date());

  async function call<T extends ZodTypeAny>(schema: T, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) {
    const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(res.statusCode, res.body).toBe(200);
    const json = res.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new Error(`${method} ${url}: ${parsed.error.message}`);
    // zod strips unknown keys, so equality also catches fields the schema doesn't document.
    expect(parsed.data, `${method} ${url}: undocumented fields`).toEqual(json);
    return parsed.data as ReturnType<T["parse"]>;
  }

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = { ...emptyContext(), tenant, user } as RequestContext;
    });
    app.setErrorHandler((err: { status?: number; statusCode?: number; message: string }, _req, reply) => {
      reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: err.message });
    });
    await app.register(expensesRoutes(new ExpensesService({ db })), { prefix: "/v1/expenses" });
  });
  afterAll(async () => {
    await app?.close();
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("categories, expenses and the summary match their response schemas", async () => {
    // Categories: built-ins seeded on first read, then a custom one renamed and deleted.
    const cats = await call(expenseCategoryListSchema, "GET", "/v1/expenses/categories");
    expect(cats.items.some((c) => c.builtin && c.name === "Rent")).toBe(true);
    const custom = await call(expenseCategorySchema, "POST", "/v1/expenses/categories", { name: "Tea" });
    expect((await call(expenseCategorySchema, "PATCH", `/v1/expenses/categories/${custom.id}`, { name: "Tea & snacks", sort: 5 })).name).toBe("Tea & snacks");
    expect((await app.inject({ method: "DELETE", url: `/v1/expenses/categories/${custom.id}` })).json()).toEqual({ ok: true });
    const rent = cats.items.find((c) => c.name === "Rent")!;

    // Expenses: one with a GST bill (ITC), one without a category (goes to "Other"), then update and cancel.
    const withGst = await call(expenseSchema, "POST", "/v1/expenses", {
      date: today,
      categoryId: rent.id,
      amount: 118_000,
      gstRate: 18,
      vendorName: "Kumar Estates",
      vendorGstin: "33AAACR5055K1ZE",
      paymentMethod: "bank",
      reference: "NEFT-1",
      note: "October rent",
    });
    expect(withGst).toMatchObject({ gstAmount: 18_000, taxable: 100_000, itc: 18_000, categoryName: "Rent" });
    const plain = await call(expenseSchema, "POST", "/v1/expenses", { amount: 5000 });
    expect(plain.categoryName).toBe("Other");
    expect(await call(expenseSchema, "GET", `/v1/expenses/${plain.id}`)).toEqual(plain);
    const updated = await call(expenseSchema, "PATCH", `/v1/expenses/${plain.id}`, { amount: 6000, paymentMethod: "upi", note: "Auto fare" });
    expect(updated.amount).toBe(6000);
    const cancelled = await call(expenseSchema, "DELETE", `/v1/expenses/${plain.id}`);
    expect(cancelled.status).toBe("cancelled");

    // Lists and the summary.
    const list = await call(expenseListSchema, "GET", "/v1/expenses?limit=10");
    expect(list.total).toBe(1);
    await call(expenseListSchema, "GET", `/v1/expenses?status=all&categoryId=${rent.id}&paymentMethod=bank,upi&q=rent&from=${today}&to=${today}&sort=-amount`);
    const summary = await call(expenseSummarySchema, "GET", "/v1/expenses/summary");
    expect(summary).toMatchObject({ total: 118_000, itc: 18_000, count: 1 });
  });
});

describe("expenses API document config", () => {
  it("documented routes keep their feature and permission config", async () => {
    const seen = new Map<string, RouteOptions>();
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRoute", (r) => {
      seen.set(`${r.method} ${r.url}`, r);
    });
    await app.register(expensesRoutes({} as ExpensesService), { prefix: "/v1/expenses" });
    const create = seen.get("POST /v1/expenses")!;
    expect(create.config).toMatchObject({ feature: "expenses", permission: EXPENSES_PERMISSION });
    expect(create.config?.schema?.body).toBeTruthy();
    expect(seen.get("GET /v1/expenses/categories")!.config?.schema?.response).toBeTruthy();
    await app.close();
  });
});
