/**
 * The POS catalogue SQL (kit-pos.ts `posCatalogPort`) against Postgres: sellable items (store-only, archived and deleted
 * left out, billing-only in), by-weight items, scale PLUs, stock, deltas with removals and keyset paging. Runs only
 * with `POS_TEST_DATABASE_URL` set; it works in a throw-away schema with the columns the query reads.
 *   PowerShell: $env:POS_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5432/srikit"; pnpm test
 */
import { randomUUID } from "node:crypto";
import { createDb, sql, type Db } from "@rbms/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { posCatalogPort } from "./kit-pos";

const URL_ = process.env.POS_TEST_DATABASE_URL;
const SCHEMA = `pos_cat_${Math.random().toString(36).slice(2, 10)}`;
const S = `"${SCHEMA}"`;
const DDL = `
create table ${S}.catalog_categories (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, parent_id uuid,
  name text not null, sort integer not null default 0, active boolean not null default true);
create table ${S}.catalog_products (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, name text not null,
  category_id uuid, hsn text, gst_rate real not null default 0, unit text not null default 'pcs', tax_inclusive boolean not null default false,
  status text not null default 'active', channels text[] not null default '{store,billing}', images jsonb not null default '[]',
  deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table ${S}.catalog_variants (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, product_id uuid not null,
  sku text, barcode text, title text not null default '', price integer not null, mrp integer, deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table ${S}.stock_items (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, location_id uuid, item_id uuid not null,
  qty numeric not null default 0, reorder_level numeric not null default 0, track boolean not null default true,
  updated_at timestamptz not null default now());
create table ${S}.scale_items (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, item_id uuid not null, plu integer not null,
  sold_by text not null default 'weight', tare_grams integer not null default 0, active boolean not null default true,
  updated_at timestamptz not null default now());
`;
const T = randomUUID();

describe.skipIf(!URL_)("POS catalogue SQL against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let stockOn = true;
  const ids: Record<string, string> = {};
  const port = () => posCatalogPort(db, async () => stockOn);
  const exec = (q: string) => db.execute(sql.raw(q.replaceAll("$S", S)));

  async function product(key: string, p: { unit?: string; channels?: string; status?: string; price?: number; title?: string } = {}) {
    const pid = randomUUID();
    const vid = randomUUID();
    await exec(`insert into $S.catalog_products (id, tenant_id, name, unit, channels, status, gst_rate, tax_inclusive, images, updated_at)
      values ('${pid}', '${T}', '${key}', '${p.unit ?? "pcs"}', '${p.channels ?? "{store,billing}"}', '${p.status ?? "active"}', 5, true,
      '[{"url":"https://img/${key}.jpg"}]', now() - interval '2 hours')`);
    await exec(`insert into $S.catalog_variants (id, tenant_id, product_id, sku, barcode, title, price, updated_at)
      values ('${vid}', '${T}', '${pid}', 'SKU-${key}', '890${Math.floor(Math.random() * 1e9)}', '${p.title ?? ""}', ${p.price ?? 1000}, now() - interval '2 hours')`);
    ids[key] = vid;
    ids[`${key}:p`] = pid;
  }

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 3 }));
    await db.execute(sql.raw(`create schema ${S}`));
    await db.execute(sql.raw(DDL));
    await product("soap");
    await product("rice", { unit: "kg", price: 6000 });
    await product("dal", { price: 15000 });
    await product("billonly", { channels: "{billing}" });
    await product("storeonly", { channels: "{store}" });
    await product("draft", { status: "draft" });
    await product("shirt", { title: "M / Red" });
    await exec(`insert into $S.scale_items (tenant_id, item_id, plu, sold_by, tare_grams, updated_at) values ('${T}', '${ids.dal}', 101, 'weight', 20, now() - interval '2 hours')`);
    await exec(`insert into $S.stock_items (tenant_id, item_id, qty, reorder_level, updated_at) values ('${T}', '${ids.soap}', 3, 5, now() - interval '2 hours')`);
    await exec(`insert into $S.catalog_categories (tenant_id, name, sort) values ('${T}', 'Grains', 2), ('${T}', 'Soaps', 1), ('${T}', 'Old', 0)`);
    await exec(`update $S.catalog_categories set active = false where name = 'Old'`);
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists ${S} cascade`));
    await close?.();
  });

  it("lists every sellable item in id order, with weight, PLU and stock", async () => {
    const rows = await port().rows(T, { since: null, afterId: null, limit: 100 });
    const byId = new Map(rows.map((r) => [r.id, r.item!]));
    expect(rows.every((r) => r.item)).toBe(true);
    expect([...byId.keys()]).toEqual([ids.soap, ids.rice, ids.dal, ids.billonly, ids.shirt].sort());
    expect(byId.get(ids.rice!)).toMatchObject({ soldBy: "weight", unit: "kg", plu: null, price: 6000, taxInclusive: true, gstRate: 5 });
    expect(byId.get(ids.dal!)).toMatchObject({ soldBy: "weight", plu: "101", tareKg: 0.02 });
    expect(byId.get(ids.soap!)).toMatchObject({ soldBy: "unit", stock: { qty: 3, status: "low" }, image: "https://img/soap.jpg", sku: "SKU-soap" });
    expect(byId.get(ids.billonly!)!.stock).toEqual({ qty: 0, status: "out" });
    expect(byId.get(ids.shirt!)).toMatchObject({ name: "shirt – M / Red", variantTitle: "M / Red" });
    stockOn = false;
    expect((await port().rows(T, { since: null, afterId: null, limit: 100 })).every((r) => r.item!.stock === null)).toBe(true);
    stockOn = true;
  });

  it("pages by id", async () => {
    const all = (await port().rows(T, { since: null, afterId: null, limit: 100 })).map((r) => r.id);
    const p1 = await port().rows(T, { since: null, afterId: null, limit: 2 });
    const p2 = await port().rows(T, { since: null, afterId: p1[1]!.id, limit: 2 });
    expect([...p1, ...p2].map((r) => r.id)).toEqual(all.slice(0, 4));
  });

  it("delta: changed items, and removals for archived, deleted or store-only ones", async () => {
    const since = new Date(Date.now() - 3_600_000);
    expect(await port().rows(T, { since, afterId: null, limit: 100 })).toEqual([]);
    await exec(`update $S.catalog_variants set price = 1100, updated_at = now() where id = '${ids.soap}'`);
    await exec(`update $S.catalog_products set status = 'archived', updated_at = now() where id = '${ids["rice:p"]}'`);
    await exec(`update $S.catalog_variants set deleted_at = now(), updated_at = now() where id = '${ids.shirt}'`);
    await exec(`update $S.catalog_products set channels = '{store}', updated_at = now() where id = '${ids["billonly:p"]}'`);
    await exec(`update $S.scale_items set plu = 102, updated_at = now() where item_id = '${ids.dal}'`);
    const d = await port().rows(T, { since, afterId: null, limit: 100 });
    const got = Object.fromEntries(d.map((r) => [r.id, r.item ? r.item.price : null]));
    expect(got).toEqual({ [ids.soap!]: 1100, [ids.dal!]: 15000, [ids.rice!]: null, [ids.shirt!]: null, [ids.billonly!]: null });
    // Stock moves count as changes while stock is on.
    const since2 = new Date();
    await new Promise((r) => setTimeout(r, 20));
    await exec(`update $S.stock_items set qty = 10, updated_at = now() where item_id = '${ids.soap}'`);
    const s = await port().rows(T, { since: since2, afterId: null, limit: 100 });
    expect(s.map((r) => [r.id, r.item?.stock])).toEqual([[ids.soap, { qty: 10, status: "ok" }]]);
  });

  it("items for pricing (sellable only) and active categories in order", async () => {
    const items = await port().items(T, [ids.dal!, ids.storeonly!, "not-a-uuid"]);
    expect(items.map((i) => i.itemId)).toEqual([ids.dal]);
    expect((await port().categories(T)).map((c) => [c.name, c.position])).toEqual([["Soaps", 1], ["Grains", 2]]);
  });
});
