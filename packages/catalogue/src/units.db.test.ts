/**
 * Alternate units against Postgres (docs/price-lists-units.md): set / list / replace, barcode clashes, unit barcode
 * lookups and units on items. Runs only with `CATALOGUE_TEST_DATABASE_URL` set (throw-away schema).
 */
import { randomUUID } from "node:crypto";
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CatalogueService } from "./service";

const URL_ = process.env.CATALOGUE_TEST_DATABASE_URL;
const SCHEMA = `catalogue_units_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["catalog_categories", "catalog_products", "catalog_variants", "catalog_collections", "catalog_item_units"];
const tenant = randomUUID();

describe.skipIf(!URL_)("alternate units (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let svc: CatalogueService;

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", `${SCHEMA},public`);
    ({ db, close } = createDb(u.toString(), { max: 4 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    svc = new CatalogueService({ db });
  });

  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("stores units, finds a unit by its barcode and puts units on items", async () => {
    const soap = await svc.createSimpleProduct(tenant, { name: "Soap", hsn: "3401", unit: "pcs", rate: 5000, gstRate: 18, barcode: "8901" } as never);
    const oil = await svc.createSimpleProduct(tenant, { name: "Oil", hsn: "1512", unit: "l", rate: 20000, gstRate: 5 } as never);
    const set = await svc.units.set(tenant, soap.id, { units: [{ unit: "box", factor: 12, barcode: "BOX8901" }, { unit: "carton", factor: 144, price: 640000 }] });
    expect(set.baseUnit).toBe("pcs");
    expect(set.units.map((u) => [u.unit, u.factor, u.price])).toEqual([
      ["box", 12, 60000],
      ["carton", 144, 640000],
    ]);
    await expect(svc.units.set(tenant, oil.id, { units: [{ unit: "tin", factor: 15, barcode: "BOX8901" }] })).rejects.toMatchObject({ status: 409 });
    await expect(svc.units.set(tenant, oil.id, { units: [{ unit: "tin", factor: 15, barcode: "8901" }] })).rejects.toMatchObject({ status: 409 });
    await expect(svc.units.set(tenant, oil.id, { units: [{ unit: "L", factor: 15 }] })).rejects.toMatchObject({ status: 400 });

    expect(await svc.lookupCode(tenant, "BOX8901")).toMatchObject({ id: soap.id, scannedUnit: "box" });
    const [item] = await svc.getItems(tenant, [soap.id]);
    expect(item!.units?.map((u) => u.unit)).toEqual(["box", "carton"]);
    expect((await svc.getItem(tenant, oil.id)).units).toBeUndefined();

    await svc.units.set(tenant, soap.id, { units: [] });
    expect((await svc.units.list(tenant, soap.id)).units).toEqual([]);
  });
});
