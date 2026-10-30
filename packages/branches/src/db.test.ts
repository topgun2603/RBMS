/**
 * Optional database test of BranchesService (lazy default branch, CRUD rules, assignments, summary). Runs only with
 * `BRANCHES_TEST_DATABASE_URL` set (a development Postgres); it works in a throw-away schema and drops it afterwards.
 *   PowerShell: $env:BRANCHES_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5432/srikit"; pnpm test
 */
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LocationRef, LocationsPort, SummaryPort } from "./ports";
import { BranchesService } from "./service";

const URL_ = process.env.BRANCHES_TEST_DATABASE_URL;
const SCHEMA = `branches_it_${Math.random().toString(36).slice(2, 10)}`;
const T = "11111111-1111-4111-8111-111111111111";
const T2 = "99999999-9999-4999-8999-999999999999";
const U1 = "22222222-2222-4222-8222-222222222222";
const U2 = "33333333-3333-4333-8333-333333333333";
const TN = "33AAACR5055K1ZE";
const KA = "29AAACR5055K1Z3";

const DDL = `
create table "${SCHEMA}".branches (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, name text not null, code text not null,
  address text, city text, pincode text, phone text, gstin text, state_code text, stock_location_id uuid,
  invoice_prefix text not null, active boolean not null default true, is_default boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint branches_tenant_code_uq unique (tenant_id, code),
  constraint branches_tenant_prefix_uq unique (tenant_id, invoice_prefix));
create unique index branches_tenant_default_uq on "${SCHEMA}".branches (tenant_id) where is_default;
create unique index branches_tenant_location_uq on "${SCHEMA}".branches (tenant_id, stock_location_id) where stock_location_id is not null;
create table "${SCHEMA}".branch_users (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  branch_id uuid not null references "${SCHEMA}".branches(id) on delete cascade, user_id uuid not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint branch_users_branch_user_uq unique (branch_id, user_id));
create unique index branch_users_tenant_user_default_uq on "${SCHEMA}".branch_users (tenant_id, user_id) where is_default;
`;

describe.skipIf(!URL_)("BranchesService against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let svc: BranchesService;
  const locs = new Map<string, LocationRef>();
  let n = 0;
  const locations: LocationsPort = {
    defaultLocation: vi.fn(async () => locs.get("main")!),
    getLocation: vi.fn(async (_t, id) => [...locs.values()].find((l) => l.id === id) ?? null),
    createLocation: vi.fn(async (_t, input) => {
      const l = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, name: input.name, code: input.code, active: true };
      locs.set(l.id, l);
      return l;
    }),
  };
  const summary: SummaryPort = {
    sales: vi.fn(async () => []),
    stockValue: vi.fn(async (_t, locationId) => (locationId === locs.get("main")!.id ? 5000 : 100)),
  };

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    await db.execute(sql.raw(DDL));
    locs.set("main", { id: "00000000-0000-4000-8000-00000000aaaa", name: "Main", code: "MAIN", active: true });
    svc = new BranchesService({
      db,
      locations,
      summary,
      profile: { get: async () => ({ gstin: TN, stateCode: null, address: "1 Car St", city: "Madurai", phone: "9876543210", invoicePrefix: "raja" }) },
      now: () => new Date("2026-10-15T06:00:00Z"),
    });
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("creates exactly one default branch lazily, even under concurrent calls", async () => {
    expect(await svc.activeBranches(T)).toEqual([]);
    const all = await Promise.all([svc.ensureDefault(T), svc.ensureDefault(T), svc.ensureDefault(T)]);
    expect(new Set(all.map((b) => b.id)).size).toBe(1);
    const def = all[0]!;
    expect(def).toMatchObject({ code: "MAIN", name: "Main", isDefault: true, gstin: TN, stateCode: "33", invoicePrefix: "RAJA", city: "Madurai" });
    expect(def.stockLocationId).toBe(locs.get("main")!.id);
    expect((await svc.list(T)).total).toBe(1);
  });

  it("creates branches with their own location, prefix and validated GSTIN", async () => {
    const b = await svc.create(T, { name: "Bengaluru", code: "blr", gstin: KA });
    expect(b).toMatchObject({ code: "BLR", stateCode: "29", gstin: KA, invoicePrefix: "BLR", isDefault: false, active: true });
    expect(b.stockLocationId).not.toBeNull();
    expect(locations.createLocation).toHaveBeenCalledWith(T, { name: "Bengaluru", code: "BLR", address: null });

    await expect(svc.create(T, { name: "X", code: "X1", gstin: KA, stateCode: "33" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.create(T, { name: "Dup", code: "BLR" })).rejects.toMatchObject({ status: 409 });
    await expect(svc.create(T, { name: "Dup prefix", code: "BLR2", invoicePrefix: "raja" })).rejects.toMatchObject({ status: 409 });
    await expect(svc.create(T, { name: "Bad prefix", code: "BP", invoicePrefix: "TOOLONG" })).rejects.toThrow();
    // Linking a location another branch already uses
    await expect(svc.create(T, { name: "Shared", code: "SH", stockLocationId: b.stockLocationId! })).rejects.toMatchObject({ status: 409 });
    const noLoc = await svc.create(T, { name: "Kiosk", code: "KIOSK", createLocation: false, stateCode: "33" });
    expect(noLoc.stockLocationId).toBeNull();
  });

  it("enforces the default and last-branch rules", async () => {
    const def = await svc.ensureDefault(T);
    await expect(svc.deactivate(T, def.id)).rejects.toMatchObject({ status: 400 });
    await expect(svc.update(T, def.id, { isDefault: false })).rejects.toMatchObject({ status: 400 });

    const blr = (await svc.list(T)).items.find((b) => b.code === "BLR")!;
    const moved = await svc.update(T, blr.id, { isDefault: true });
    expect(moved.isDefault).toBe(true);
    expect((await svc.get(T, def.id)).isDefault).toBe(false);
    expect((await svc.list(T)).items.filter((b) => b.isDefault)).toHaveLength(1);
    // switch back so later tests see MAIN as the default
    await svc.update(T, def.id, { isDefault: true });

    const kiosk = (await svc.list(T)).items.find((b) => b.code === "KIOSK")!;
    const closed = await svc.deactivate(T, kiosk.id);
    expect(closed.active).toBe(false);
    await expect(svc.update(T, kiosk.id, { isDefault: true })).rejects.toMatchObject({ status: 400 });

    // Another tenant: its default branch is its only branch, so it can't be closed.
    const only = await svc.ensureDefault(T2);
    await expect(svc.deactivate(T2, only.id)).rejects.toMatchObject({ status: 400 });
  });

  it("updates GSTIN with the state check", async () => {
    const blr = (await svc.list(T)).items.find((b) => b.code === "BLR")!;
    await expect(svc.update(T, blr.id, { stateCode: "33" })).rejects.toMatchObject({ status: 400 });
    const moved = await svc.update(T, blr.id, { gstin: TN });
    expect(moved).toMatchObject({ gstin: TN, stateCode: "33" });
    const cleared = await svc.update(T, blr.id, { gstin: null, stateCode: "29" });
    expect(cleared).toMatchObject({ gstin: null, stateCode: "29" });
  });

  it("assigns users with exactly one home branch", async () => {
    const list = (await svc.list(T)).items;
    const main = list.find((b) => b.code === "MAIN")!;
    const blr = list.find((b) => b.code === "BLR")!;
    await svc.addUser(T, blr.id, { userId: U1 });
    await svc.addUser(T, main.id, { userId: U1 });
    let mine = await svc.userBranches(T, U1);
    expect(mine.items.filter((a) => a.isDefault).map((a) => a.branchId)).toEqual([blr.id]);

    await svc.addUser(T, main.id, { userId: U1, isDefault: true });
    mine = await svc.userBranches(T, U1);
    expect(mine.items.filter((a) => a.isDefault).map((a) => a.branchId)).toEqual([main.id]);

    await svc.removeUser(T, main.id, U1);
    mine = await svc.userBranches(T, U1);
    expect(mine.items).toEqual([{ userId: U1, branchId: blr.id, isDefault: true }]);

    await svc.setBranchUsers(T, main.id, { userIds: [U1, U2] });
    expect((await svc.listUsers(T, main.id)).total).toBe(2);
    await svc.setUserBranches(T, U2, { branchIds: [blr.id], defaultBranchId: blr.id });
    expect((await svc.userBranches(T, U2)).items).toEqual([{ userId: U2, branchId: blr.id, isDefault: true }]);

    const kiosk = list.find((b) => b.code === "KIOSK")!;
    await expect(svc.addUser(T, kiosk.id, { userId: U2 })).rejects.toMatchObject({ status: 400 });

    // mine(): staff see assigned open branches, owners see all open ones
    const staff = await svc.mine(T, { userId: U2, fullAccess: false });
    expect(staff.items.map((b) => b.code)).toEqual(["BLR"]);
    expect(staff.items[0]!.isHome).toBe(true);
    const owner = await svc.mine(T, { userId: "44444444-4444-4444-8444-444444444444", fullAccess: true });
    expect(owner.items.map((b) => b.code)).toEqual(["MAIN", "BLR"]);
    const unassigned = await svc.mine(T, { userId: "55555555-5555-4555-8555-555555555555", fullAccess: false });
    expect(unassigned.items.map((b) => b.code)).toEqual(["MAIN"]);
  });

  it("summarises per branch and puts bills without a branch on the default", async () => {
    const list = (await svc.list(T)).items;
    const main = list.find((b) => b.code === "MAIN")!;
    const blr = list.find((b) => b.code === "BLR")!;
    const kiosk = list.find((b) => b.code === "KIOSK")!;
    vi.mocked(summary.sales).mockResolvedValueOnce([
      { branchId: null, sales: 1000, bills: 1 },
      { branchId: main.id, sales: 2000, bills: 2 },
      { branchId: blr.id, sales: 500, bills: 1 },
      { branchId: kiosk.id, sales: 300, bills: 1 },
    ]);
    const s = await svc.summary(T, {});
    expect(summary.sales).toHaveBeenCalledWith(T, { from: "2026-10-01", to: "2026-10-15" });
    expect(s.items.map((r) => [r.code, r.sales, r.bills, r.stockValue])).toEqual([
      ["MAIN", 3000, 3, 5000],
      ["BLR", 500, 1, 100],
      ["KIOSK", 300, 1, null],
    ]);
    expect(s.consolidated).toEqual({ sales: 3800, bills: 5, stockValue: 5100 });
    await expect(svc.summary(T, { from: "2026-10-10", to: "2026-10-01" })).rejects.toThrow();
  });

  it("keeps tenants apart", async () => {
    expect((await svc.list(T2)).items.map((b) => b.code)).toEqual(["MAIN"]);
    const blr = (await svc.list(T)).items.find((b) => b.code === "BLR")!;
    await expect(svc.get(T2, blr.id)).rejects.toMatchObject({ status: 404 });
  });
});
