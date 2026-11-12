/**
 * Database test of the shop registry: creating a shop (address rules, owner, set-up hooks), finding the shop for a web
 * address (header, subdomain, verified custom domain, suspended shops), custom-domain checks, members and their roles
 * (the last owner can't leave), seat counts, the super-admin list, the routes and their roles, and that one shop never
 * sees another's members or domains. Runs only with `TENANCY_TEST_DATABASE_URL` set (a development Postgres with the
 * tenancy tables migrated); it copies them into a throw-away schema and drops it afterwards.
 *   PowerShell: $env:TENANCY_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5433/srikit"; pnpm test
 */
import { AppError, emptyContext, type RequestContext } from "@rbms/core";
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { DomainCheck } from "./domains";
import { tenancyRoutes } from "./routes";
import { TenancyService } from "./service";

const URL_ = process.env.TENANCY_TEST_DATABASE_URL;
const SCHEMA = `tenancy_it_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["tenants", "tenant_domains", "tenant_memberships"];
const ROOT = "rbms.test";
const GHOST = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ANU, BALA, CHITRA, DEV] = [u(1), u(2), u(3), u(4)];

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? `${e.status}:${e.code}` : e instanceof ZodError ? "zod" : String(e);
  }
  return "ok";
};

describe.skipIf(!URL_)("tenancy against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let svc: TenancyService;
  let dns: DomainCheck | "throw" = { txt: false, cname: false };
  const hookLog: string[] = [];
  const planChanges: string[] = [];
  const appChanges: string[] = [];

  beforeAll(async () => {
    const url = new URL(URL_!);
    url.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(url.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    svc = new TenancyService({
      db,
      rootDomain: ROOT,
      cnameTarget: "stores.rbms.test",
      domainVerifier: async () => {
        if (dns === "throw") throw new Error("dns down");
        return dns;
      },
      onPlanChange: (id, plan) => void planChanges.push(`${id.slice(0, 4)}:${plan}`),
      onAppChange: (id, app) => void appChanges.push(`${id.slice(0, 4)}:${app}`),
      onTenantCreated: [{ name: "first", run: (e) => void hookLog.push(`first:${e.tenant.slug}:${e.ownerUserId === ANU ? "anu" : "?"}`) }],
    });
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  const shop = (slug: string, extra: Record<string, unknown> = {}) => svc.create({ slug, name: `Shop ${slug}`, ownerUserId: ANU, ...extra });

  it("creates a shop with its owner, refuses bad or taken addresses, and runs the set-up hooks in order", async () => {
    const s = await svc.create({ slug: "meena-stores", name: "  Meena Stores ", ownerUserId: ANU, planId: "starter", appId: "BL" });
    expect(s).toMatchObject({ slug: "meena-stores", name: "Meena Stores", planId: "starter", appId: "BL", status: "active" });
    expect(await svc.rolesFor(s.id, ANU)).toEqual(["owner"]);
    expect(hookLog).toEqual(["first:meena-stores:anu"]);

    expect(await code(shop("meena-stores"))).toBe("409:conflict");
    expect(await code(shop("admin"))).toBe("400:bad_request"); // reserved
    expect(await code(shop("ab"))).toBe("400:bad_request");
    expect(await code(shop("-bad-"))).toBe("400:bad_request");
    expect(await code(svc.create({ slug: "no-name", name: "   ", ownerUserId: ANU }))).toBe("400:bad_request");
    expect(await svc.getBySlug("no-name")).toBeNull();
    expect((await svc.getBySlug("MEENA-STORES"))?.id).toBe(s.id);

    // Hooks added later run after the earlier ones, and may change the shop: the answer shows their work.
    svc.onTenantCreated({ name: "second", run: async (e) => void (await svc.setPlan(e.tenant.id, "pro")) });
    expect(svc.tenantCreatedHooks).toEqual(["first", "second"]);
    expect(() => svc.onTenantCreated({ name: "first", run() {} })).toThrow(/already registered/);
    const hooked = await shop("hooked-shop");
    expect(hooked.planId).toBe("pro");
    expect(planChanges).toContain(`${hooked.id.slice(0, 4)}:pro`);
  });

  it("a failing set-up hook leaves the shop created and the other hooks still run", async () => {
    const seen: string[] = [];
    const strict = new TenancyService({
      db,
      rootDomain: ROOT,
      onTenantCreated: [
        { name: "boom", run: () => { throw new Error("seed failed"); } },
        { name: "after", run: () => void seen.push("after") },
      ],
    });
    expect(await strict.create({ slug: "hook-fail", name: "Hook fail", ownerUserId: ANU }).catch((e) => String(e))).toContain("seed failed");
    expect(seen).toEqual(["after"]);
    expect(await strict.getBySlug("hook-fail")).not.toBeNull();

    const errs: string[] = [];
    const lenient = new TenancyService({
      db,
      rootDomain: ROOT,
      onHookError: (err, hook, tenant) => void errs.push(`${hook}:${tenant.slug}:${(err as Error).message}`),
      onTenantCreated: [{ name: "boom", run: () => { throw new Error("seed failed"); } }],
    });
    const t = await lenient.create({ slug: "hook-lenient", name: "Hook lenient", ownerUserId: ANU });
    expect(t.slug).toBe("hook-lenient");
    expect(errs).toEqual(["boom:hook-lenient:seed failed"]);
  });

  it("answers whether a shop address is free and suggests free alternatives", async () => {
    await shop("sri-murugan");
    expect(await svc.slugAvailable("  Fresh-Name ")).toEqual({ slug: "fresh-name", available: true, suggestions: [] });
    const taken = await svc.slugAvailable("sri-murugan", { city: "Madurai" });
    expect(taken).toMatchObject({ available: false, code: "taken", reason: "That address is already taken" });
    expect(taken.suggestions.length).toBeGreaterThan(0);
    expect(taken.suggestions.length).toBeLessThanOrEqual(4);
    expect(taken.suggestions).toContain("sri-murugan-madurai");
    expect(taken.suggestions).not.toContain("sri-murugan");
    // A suggestion that is itself taken is left out.
    await shop("sri-murugan-shop");
    expect((await svc.slugAvailable("sri-murugan")).suggestions).not.toContain("sri-murugan-shop");
    expect(await svc.slugAvailable("admin")).toMatchObject({ available: false, code: "reserved" });
    expect(await svc.slugAvailable("x")).toMatchObject({ available: false, code: "length" });
    expect(await svc.slugAvailable("Bad Name!")).toMatchObject({ available: false, code: "format" });
    expect(svc.rootDomain).toBe(ROOT);
  });

  it("finds the shop for a request: header first, then subdomain, then a verified custom domain; suspended shops are refused", async () => {
    const a = await shop("alpha-shop");
    const b = await shop("beta-shop");
    expect(await svc.resolve({ host: `alpha-shop.${ROOT}` })).toMatchObject({ id: a.id, slug: "alpha-shop", planId: "pro", appId: null });
    expect(await svc.resolve({ host: `ALPHA-SHOP.${ROOT}:3000` })).toMatchObject({ id: a.id });
    // The header wins over the host.
    expect((await svc.resolve({ host: `alpha-shop.${ROOT}`, headerSlug: " Beta-Shop " }))?.id).toBe(b.id);
    expect(await svc.resolve({ host: `${ROOT}` })).toBeNull();
    expect(await svc.resolve({ host: `www.${ROOT}` })).toBeNull();
    expect(await svc.resolve({ host: `nobody.${ROOT}` })).toBeNull();
    expect(await svc.resolve({ host: null })).toBeNull();
    expect(await svc.resolve({ host: "x.example.com", headerSlug: "not valid!" })).toBeNull();

    // A custom domain only counts once verified.
    const d = await svc.addDomain(a.id, "Shop.Alpha.IN");
    expect(await svc.resolve({ host: "shop.alpha.in" })).toBeNull();
    await svc.verifyDomain(a.id, d.id, { force: true });
    svc.invalidate();
    expect((await svc.resolve({ host: "shop.alpha.in:443" }))?.id).toBe(a.id);

    // Suspending refuses at once (the cache is dropped), and reactivating lets it through again.
    await svc.setStatus(a.id, "suspended");
    expect(await code(svc.resolve({ host: `alpha-shop.${ROOT}` }))).toBe("403:forbidden");
    expect(await code(svc.resolve({ host: "shop.alpha.in" }))).toBe("403:forbidden");
    await svc.setStatus(a.id, "active");
    expect((await svc.resolve({ host: `alpha-shop.${ROOT}` }))?.id).toBe(a.id);
  });

  it("keeps a short cache that a change to the same shop clears", async () => {
    const t = await shop("cache-shop");
    const mine = new TenancyService({ db, rootDomain: ROOT, cacheTtlMs: 60_000 });
    expect((await mine.resolve({ host: `cache-shop.${ROOT}` }))?.planId).toBe("pro"); // the second set-up hook above gives every new shop "pro"
    // Another process changes the plan: this one still answers from its cache until told.
    await svc.setPlan(t.id, "gold");
    expect((await mine.resolve({ host: `cache-shop.${ROOT}` }))?.planId).toBe("pro");
    mine.invalidate(t.id);
    expect((await mine.resolve({ host: `cache-shop.${ROOT}` }))?.planId).toBe("gold");
    // A miss is cached too, and any change clears it for that shop only when a tenant id is given... or everything with none.
    expect(await mine.resolve({ host: `later-shop.${ROOT}` })).toBeNull();
    await shop("later-shop");
    expect(await mine.resolve({ host: `later-shop.${ROOT}` })).toBeNull();
    mine.invalidate();
    expect(await mine.resolve({ host: `later-shop.${ROOT}` })).not.toBeNull();
  });

  it("changes a shop's name, plan, app and status; unknown shops are 404", async () => {
    const t = await shop("change-shop");
    expect((await svc.update(t.id, { name: " Renamed " })).name).toBe("Renamed");
    expect(await code(svc.update(t.id, { name: "  " }))).toBe("400:bad_request");
    expect((await svc.update(t.id, { metadata: { gstin: "33AAAAA0000A1Z5" } })).metadata).toEqual({ gstin: "33AAAAA0000A1Z5" });
    expect((await svc.update(t.id, {})).name).toBe("Renamed");
    expect(await code(svc.update(GHOST, {}))).toBe("404:not_found");
    expect(await code(svc.update(GHOST, { name: "X" }))).toBe("404:not_found");

    planChanges.length = 0;
    appChanges.length = 0;
    expect((await svc.setPlan(t.id, "pro")).planId).toBe("pro");
    expect((await svc.setPlan(t.id, null)).planId).toBeNull();
    expect(planChanges).toEqual([`${t.id.slice(0, 4)}:pro`, `${t.id.slice(0, 4)}:null`]);
    expect((await svc.setApp(t.id, "SCH")).appId).toBe("SCH");
    expect(appChanges).toEqual([`${t.id.slice(0, 4)}:SCH`]);
    expect((await svc.setStatus(t.id, "suspended")).status).toBe("suspended");
    expect(await code(svc.setPlan(GHOST, "pro"))).toBe("404:not_found");
    expect(await code(svc.setApp(GHOST, "BL"))).toBe("404:not_found");
    expect(await code(svc.setStatus(GHOST, "active"))).toBe("404:not_found");
    expect((await svc.getRef(t.id))).toMatchObject({ id: t.id, slug: "change-shop", appId: "SCH" });
    expect(await svc.getRef(GHOST)).toBeNull();
    expect((await svc.getByIds([t.id, t.id, GHOST])).map((x) => x.id)).toEqual([t.id]);
    expect(await svc.getByIds([])).toEqual([]);
  });

  it("super-admin list: search, filters with 'none', sort, paging and facet counts that ignore their own filter", async () => {
    // A clean registry so the numbers are exact.
    const url = new URL(URL_!);
    const schema2 = `${SCHEMA}_l`;
    url.searchParams.set("search_path", schema2);
    await db.execute(sql.raw(`create schema "${schema2}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${schema2}"."${t}" (like public."${t}" including all)`));
    const { db: db2, close: close2 } = createDb(url.toString(), { max: 2 });
    try {
      const s2 = new TenancyService({ db: db2, rootDomain: ROOT });
      const mk = async (slug: string, name: string, planId: string | null, appId: string | null) => s2.create({ slug, name, ownerUserId: ANU, planId, appId });
      const a = await mk("aaa-bakery", "Aaa Bakery", "starter", "BL");
      await mk("bbb-gym", "bbb Gym", "pro", "BL");
      await mk("ccc-school", "Ccc School", null, "SCH");
      const d = await mk("ddd-store", "Ddd Store", "starter", null);
      await s2.setStatus(d.id, "suspended");

      const all = await s2.list({ sort: "name" });
      expect(all.items.map((t) => t.name)).toEqual(["Aaa Bakery", "bbb Gym", "Ccc School", "Ddd Store"]); // case-insensitive order
      expect(all.total).toBe(4);
      expect(all.facets).toEqual({
        status: { active: 3, suspended: 1 },
        plan: { starter: 2, pro: 1, none: 1 },
        app: { BL: 2, SCH: 1, none: 1 },
      });
      expect((await s2.list({ plan: "none" })).items.map((t) => t.slug)).toEqual(["ccc-school"]);
      expect((await s2.list({ plan: "starter,none", sort: "name" })).items.map((t) => t.slug)).toEqual(["aaa-bakery", "ccc-school", "ddd-store"]);
      expect((await s2.list({ app: "none" })).items.map((t) => t.slug)).toEqual(["ddd-store"]);
      const bl = await s2.list({ app: "BL", status: "active" });
      expect(bl.total).toBe(2);
      // The plan facet ignores the plan filter but keeps the others.
      const planOnly = await s2.list({ plan: "pro", app: "BL" });
      expect(planOnly.items.map((t) => t.slug)).toEqual(["bbb-gym"]);
      expect(planOnly.facets.plan).toEqual({ starter: 1, pro: 1 });
      expect((await s2.list({ q: "GYM" })).items.map((t) => t.slug)).toEqual(["bbb-gym"]);
      expect((await s2.list({ q: "ccc-" })).items.map((t) => t.slug)).toEqual(["ccc-school"]);
      expect((await s2.list({ limit: "2", offset: "1", sort: "name" })).items.map((t) => t.slug)).toEqual(["bbb-gym", "ccc-school"]);
      expect((await s2.list({ sort: "-name", limit: "1" })).items[0]!.slug).toBe("ddd-store");
      expect((await s2.list({})).items[0]!.id).toBe(d.id); // newest first by default
      expect(await code(s2.list({ status: "deleted" }))).toBe("zod");
      expect(await s2.countByApp()).toEqual({ BL: 2, SCH: 1 });
      void a;
    } finally {
      await close2();
      await db.execute(sql.raw(`drop schema if exists "${schema2}" cascade`));
    }
  });

  it("custom domains: validated, unique across shops, instructions with the right DNS records, owned by one shop", async () => {
    const a = await shop("dom-a");
    const b = await shop("dom-b");
    const d = await svc.addDomain(a.id, "  Shop.Example.COM ");
    expect(d).toMatchObject({ domain: "shop.example.com", verified: false, tenantId: a.id });
    expect(d.verificationToken).toMatch(/^rbms-verify-/);
    expect(await code(svc.addDomain(b.id, "shop.example.com"))).toBe("409:conflict");
    expect(await code(svc.addDomain(b.id, "not a domain"))).toBe("400:bad_request");
    expect(await code(svc.addDomain(b.id, "localhost"))).toBe("400:bad_request");
    expect(await code(svc.addDomain(b.id, `evil.${ROOT}`))).toBe("400:bad_request");
    expect(await code(svc.addDomain(b.id, ROOT))).toBe("400:bad_request");
    await svc.addDomain(a.id, "another.example.com");
    expect((await svc.listDomains(a.id)).map((x) => x.domain)).toEqual(["another.example.com", "shop.example.com"]);
    expect(await svc.listDomains(b.id)).toEqual([]);

    const ins = await svc.domainInstructions(a.id, d.id);
    expect(ins).toEqual({
      domain: "shop.example.com",
      status: "pending",
      records: [
        { type: "TXT", host: "_rbms-verify.shop.example.com", value: d.verificationToken },
        { type: "CNAME", host: "shop.example.com", value: "stores.rbms.test" },
      ],
    });
    // A root domain gets the ALIAS note.
    const apex = await svc.addDomain(a.id, "example.in");
    expect((await svc.domainInstructions(a.id, apex.id)).records[1]!.note).toContain("ALIAS");
    expect(await code(svc.domainInstructions(b.id, d.id))).toBe("404:not_found");
    expect(await code(svc.getDomain(b.id, d.id))).toBe("404:not_found");
    expect(await code(svc.removeDomain(b.id, d.id))).toBe("404:not_found");
    expect(await code(svc.verifyDomain(b.id, d.id, { force: true }))).toBe("404:not_found");
    await svc.removeDomain(a.id, apex.id);
    expect((await svc.listDomains(a.id)).map((x) => x.domain)).toEqual(["another.example.com", "shop.example.com"]);

    // A domain added before tokens existed gets one the first time it is asked for, and keeps it.
    await db.execute(sql.raw(`insert into "${SCHEMA}"."tenant_domains" (tenant_id, domain) values ('${a.id}', 'old.example.com')`));
    const old = (await svc.listDomains(a.id)).find((x) => x.domain === "old.example.com")!;
    expect(old.verificationToken).toBeNull();
    const oldIns = await svc.domainInstructions(a.id, old.id);
    const token = oldIns.records[0]!.value;
    expect(token).toMatch(/^rbms-verify-/);
    expect((await svc.domainInstructions(a.id, old.id)).records[0]!.value).toBe(token);
  });

  it("verifying a domain needs the DNS record; a miss reports what was found and is remembered", async () => {
    const a = await shop("ver-a");
    const d = await svc.addDomain(a.id, "ver.example.org");
    dns = { txt: false, cname: true };
    const miss = await svc.verifyDomain(a.id, d.id).catch((e) => e);
    expect(miss).toMatchObject({ status: 400, code: "bad_request", details: { txt: false, cname: true } });
    const after = await svc.getDomain(a.id, d.id);
    expect(after).toMatchObject({ verified: false, verifiedAt: null });
    expect(after.checkedAt).toBeInstanceOf(Date);

    dns = "throw"; // a DNS error counts as "not found"
    expect(await svc.verifyDomain(a.id, d.id).catch((e) => e)).toMatchObject({ details: { txt: false, cname: false } });

    dns = { txt: true, cname: false };
    const ok = await svc.verifyDomain(a.id, d.id);
    expect(ok.verified).toBe(true);
    expect(ok.verifiedAt).toBeInstanceOf(Date);
    expect((await svc.domainInstructions(a.id, d.id)).status).toBe("verified");
    const first = ok.verifiedAt!.getTime();
    // Verifying again keeps the first verification time.
    expect((await svc.verifyDomain(a.id, d.id, { force: true })).verifiedAt!.getTime()).toBe(first);
    dns = { txt: false, cname: false };

    // Without a DNS checker only a forced (super-admin) verification works.
    const manual = new TenancyService({ db, rootDomain: ROOT });
    expect(manual.canSelfVerifyDomains).toBe(false);
    const m = await svc.addDomain(a.id, "manual.example.org");
    expect(await code(manual.verifyDomain(a.id, m.id))).toBe("403:forbidden");
    expect((await manual.verifyDomain(a.id, m.id, { force: true })).verified).toBe(true);
    expect(await manual.verifyPending()).toEqual({ checked: 0, verified: 0 });
  });

  it("the half-hourly job verifies every pending domain whose record is in place", async () => {
    // A clean registry for exact counts.
    const url = new URL(URL_!);
    const schema2 = `${SCHEMA}_j`;
    url.searchParams.set("search_path", schema2);
    await db.execute(sql.raw(`create schema "${schema2}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${schema2}"."${t}" (like public."${t}" including all)`));
    const { db: db2, close: close2 } = createDb(url.toString(), { max: 2 });
    try {
      const present = new Set(["good1.example.com", "good2.example.com"]);
      const s2 = new TenancyService({
        db: db2,
        rootDomain: ROOT,
        domainVerifier: async (domain) => {
          if (domain === "broken.example.com") throw new Error("dns down");
          return { txt: present.has(domain), cname: false };
        },
      });
      const t = await s2.create({ slug: "job-shop", name: "Job shop", ownerUserId: ANU });
      for (const dm of ["good1.example.com", "good2.example.com", "bad.example.com", "broken.example.com"]) await s2.addDomain(t.id, dm);
      expect(await s2.verifyPending()).toEqual({ checked: 4, verified: 2 });
      expect((await s2.listDomains(t.id)).filter((x) => x.verified).map((x) => x.domain)).toEqual(["good1.example.com", "good2.example.com"]);
      // Next run only looks at the two still pending; the record for one arrives.
      present.add("bad.example.com");
      expect(await s2.verifyPending()).toEqual({ checked: 2, verified: 1 });
      expect(await s2.verifyPending({ limit: 1 })).toEqual({ checked: 1, verified: 0 });
      expect((await s2.resolve({ host: "good1.example.com" }))?.id).toBe(t.id);
      expect(await s2.resolve({ host: "broken.example.com" })).toBeNull();
    } finally {
      await close2();
      await db.execute(sql.raw(`drop schema if exists "${schema2}" cascade`));
    }
  });

  it("members: one base role plus custom roles, inactive members have no roles, shops are separate", async () => {
    const a = await shop("mem-a");
    const b = await shop("mem-b");
    expect(await svc.rolesFor(a.id, BALA)).toEqual([]);
    expect((await svc.addMember(a.id, BALA)).roles).toEqual(["member"]);
    // Several base levels collapse to the strongest; custom roles are sorted and unique.
    expect((await svc.addMember(a.id, BALA, ["staff", "admin", "role:cashier", "role:accounts", "role:cashier"])).roles).toEqual(["admin", "role:accounts", "role:cashier"]);
    expect(await svc.rolesFor(a.id, BALA)).toEqual(["admin", "role:accounts", "role:cashier"]);
    expect(await code(svc.addMember(a.id, CHITRA, ["superuser"]))).toBe("400:bad_request");
    expect(await code(svc.addMember(a.id, CHITRA, ["role:cashier"]))).toBe("400:bad_request"); // no base level
    expect(await code(svc.addMember(a.id, CHITRA, []))).toBe("400:bad_request");
    expect(await svc.getMember(a.id, CHITRA)).toBeNull();
    // Bala is nobody in shop B.
    expect(await svc.rolesFor(b.id, BALA)).toEqual([]);
    expect(await svc.getMember(b.id, BALA)).toBeNull();
    expect((await svc.listMembers(b.id)).map((m) => m.userId)).toEqual([ANU]);
    expect(await code(svc.updateRoles(b.id, BALA, ["staff"]))).toBe("404:not_found");
    expect(await code(svc.setMemberStatus(b.id, BALA, "inactive"))).toBe("404:not_found");
    expect(await code(svc.removeMember(b.id, BALA))).toBe("404:not_found");

    expect((await svc.setMemberRoles(a.id, BALA, ["staff"])).roles).toEqual(["staff"]);
    await svc.setMemberStatus(a.id, BALA, "inactive");
    expect(await svc.rolesFor(a.id, BALA)).toEqual([]);
    expect((await svc.getMember(a.id, BALA))?.status).toBe("inactive");
    // Adding again reactivates with the new roles.
    expect(await svc.addMember(a.id, BALA, ["member"])).toMatchObject({ status: "active", roles: ["member"] });
    expect((await svc.listMembers(a.id)).map((m) => m.userId)).toEqual([ANU, BALA]);
    await svc.removeMember(a.id, BALA);
    expect(await svc.getMember(a.id, BALA)).toBeNull();
  });

  it("a shop always keeps one active owner", async () => {
    const a = await shop("owner-a"); // Anu is the only owner
    expect(await code(svc.updateRoles(a.id, ANU, ["admin"]))).toBe("400:bad_request");
    expect(await code(svc.setMemberStatus(a.id, ANU, "inactive"))).toBe("400:bad_request");
    expect(await code(svc.removeMember(a.id, ANU))).toBe("400:bad_request");
    expect(await svc.rolesFor(a.id, ANU)).toEqual(["owner"]);

    // With a second owner, the first can step down.
    await svc.addMember(a.id, DEV, ["owner"]);
    expect((await svc.updateRoles(a.id, ANU, ["admin"])).roles).toEqual(["admin"]);
    // Dev is now the only one again.
    expect(await code(svc.removeMember(a.id, DEV))).toBe("400:bad_request");
    await svc.addMember(a.id, ANU, ["owner"]);
    await svc.setMemberStatus(a.id, DEV, "inactive");
    expect(await code(svc.setMemberStatus(a.id, ANU, "inactive"))).toBe("400:bad_request"); // Dev no longer counts
    await svc.setMemberStatus(a.id, DEV, "active");
    await svc.removeMember(a.id, ANU);
    expect(await svc.rolesFor(a.id, ANU)).toEqual([]);
  });

  it("counts staff seats (not owners, not inactive members) and lists a person's shops by name", async () => {
    const a = await shop("seat-a");
    const b = await shop("seat-b");
    await svc.addMember(a.id, BALA, ["admin"]);
    await svc.addMember(a.id, CHITRA, ["staff"]);
    await svc.addMember(a.id, DEV, ["member"]);
    await svc.setMemberStatus(a.id, DEV, "inactive");
    await svc.addMember(b.id, BALA, ["staff"]);
    expect((await svc.seatCounts(a.id)).get(a.id)).toBe(2);
    expect((await svc.seatCounts(b.id)).get(b.id)).toBe(1);
    expect((await svc.seatCounts(b.id)).has(a.id)).toBe(false);
    const every = await svc.seatCounts();
    expect(every.get(a.id)).toBe(2);
    expect(every.get(b.id)).toBe(1);
    // A shop with only an owner has no seats and isn't listed.
    const solo = await shop("seat-solo");
    expect((await svc.seatCounts(solo.id)).size).toBe(0);

    const mine = await svc.tenantsForUser(BALA);
    expect(mine.filter((m) => m.tenant.slug.startsWith("seat-")).map((m) => [m.tenant.slug, m.roles])).toEqual([["seat-a", ["admin"]], ["seat-b", ["staff"]]]);
    // Inactive memberships don't show up.
    expect((await svc.tenantsForUser(DEV)).map((m) => m.tenant.slug)).not.toContain("seat-a");
    expect(await svc.tenantsForUser(GHOST)).toEqual([]);
  });

  describe("routes", () => {
    let app: FastifyInstance;
    let ctx: RequestContext;
    const who = (o: { tenant?: { id: string; slug: string } | null; user?: string | null; roles?: string[]; platform?: string[]; ip?: string }): RequestContext =>
      ({
        ...emptyContext(),
        ip: o.ip ?? "10.0.0.1",
        tenant: o.tenant ? { id: o.tenant.id, slug: o.tenant.slug, planId: null, appId: null } : null,
        user: o.user ? { id: o.user, sessionId: "s", platformRoles: o.platform ?? [], tenantRoles: o.roles ?? [] } : null,
      }) as RequestContext;
    beforeAll(async () => {
      app = Fastify();
      app.decorateRequest("ctx", null as never);
      app.decorateRequest("auditSummary", undefined as never);
      app.decorateRequest("auditDetail", undefined as never);
      app.addHook("onRequest", async (req) => {
        req.ctx = ctx;
      });
      app.setErrorHandler((err: { status?: number; statusCode?: number; message: string }, _req, reply) => {
        reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: err.message });
      });
      await app.register(tenancyRoutes(svc, { resolveMemberTarget: async (t) => (t === "bala@example.com" ? BALA : DEV) }), { prefix: "/v1/tenancy" });
    });
    afterAll(() => app?.close());
    const send = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) => app.inject({ method, url: `/v1/tenancy${url}`, ...(payload ? { payload } : {}) });

    it("owners manage members and domains; admins can't touch owners; only the platform admin changes plans and lists shops", async () => {
      ctx = who({ user: ANU });
      const made = await send("POST", "/tenants", { slug: "route-shop", name: "Route Shop", appId: "BL" });
      expect(made.statusCode).toBe(200);
      const t = made.json();
      expect(t).toEqual({ id: expect.any(String), slug: "route-shop", name: "Route Shop", appId: "BL", status: "active" });
      expect((await send("POST", "/tenants", { slug: "route-shop", name: "Again" })).statusCode).toBe(409);
      ctx = who({});
      expect((await send("POST", "/tenants", { slug: "anon-shop", name: "Anon" })).statusCode).toBe(401);

      const owner = who({ tenant: t, user: ANU, roles: ["owner"] });
      const admin = who({ tenant: t, user: BALA, roles: ["admin"] });
      ctx = owner;
      expect((await send("GET", "/current")).json()).toMatchObject({ slug: "route-shop" });
      expect((await send("PATCH", "/current", { name: "Route Shop Two" })).json().name).toBe("Route Shop Two");
      expect((await send("GET", "/mine")).json().items.map((i: { tenant: { slug: string } }) => i.tenant.slug)).toContain("route-shop");

      // Invite by user id and by e-mail; roles are checked.
      expect((await send("POST", "/members", { userId: BALA, roles: ["admin"] })).json().roles).toEqual(["admin"]);
      expect((await send("POST", "/members", { target: "dev@example.com", roles: ["staff", "role:cashier"] })).json()).toMatchObject({ userId: DEV, roles: ["staff", "role:cashier"] });
      expect((await send("POST", "/members", { roles: ["staff"] })).statusCode).toBe(400);
      expect((await send("POST", "/members", { userId: CHITRA, target: "x@y.com" })).statusCode).toBe(400);
      expect((await send("POST", "/members", { userId: CHITRA, roles: ["wizard"] })).statusCode).toBe(400);
      expect((await send("GET", "/members")).json().items).toHaveLength(3);

      // An admin can add staff, but cannot make an owner or change one.
      ctx = admin;
      expect((await send("POST", "/members", { userId: CHITRA, roles: ["staff"] })).statusCode).toBe(200);
      expect((await send("POST", "/members", { userId: CHITRA, roles: ["owner"] })).statusCode).toBe(403);
      expect((await send("PATCH", `/members/${ANU}`, { roles: ["staff"] })).statusCode).toBe(403);
      expect((await send("PATCH", `/members/${CHITRA}`, { roles: ["owner"] })).statusCode).toBe(403);
      expect((await send("DELETE", `/members/${ANU}`)).statusCode).toBe(403);
      expect((await send("PATCH", `/members/${GHOST}`, { roles: ["staff"] })).statusCode).toBe(404);
      expect((await send("PATCH", `/members/${CHITRA}`, { roles: ["admin"] })).json().roles).toEqual(["admin"]);
      // Staff can't list members; anyone can leave the shop themselves.
      ctx = who({ tenant: t, user: DEV, roles: ["staff"] });
      expect((await send("GET", "/members")).statusCode).toBe(403);
      expect((await send("DELETE", `/members/${CHITRA}`)).statusCode).toBe(403);
      expect((await send("DELETE", `/members/${DEV}`)).json()).toEqual({ ok: true });
      expect(await svc.getMember(t.id, DEV)).toBeNull();
      // The last owner can't leave.
      ctx = owner;
      expect((await send("DELETE", `/members/${ANU}`)).statusCode).toBe(400);

      // Domains: add, list, instructions, verify through DNS, remove.
      const d = (await send("POST", "/domains", { domain: "Route.Example.com" })).json();
      expect(d.domain).toBe("route.example.com");
      expect((await send("GET", "/domains")).json().items).toHaveLength(1);
      expect((await send("GET", `/domains/${d.id}/instructions`)).json().records[0].host).toBe("_rbms-verify.route.example.com");
      dns = { txt: false, cname: false };
      expect((await send("POST", `/domains/${d.id}/verify`, {})).statusCode).toBe(400);
      // Only a platform admin may skip the DNS check.
      expect((await send("POST", `/domains/${d.id}/verify`, { force: true })).statusCode).toBe(400);
      ctx = who({ tenant: t, user: ANU, roles: ["owner"], platform: ["superadmin"] });
      expect((await send("POST", `/domains/${d.id}/verify`, { force: true })).json().verified).toBe(true);
      expect((await send("DELETE", `/domains/${d.id}`)).json()).toEqual({ ok: true });
      // Another shop's owner can't see this shop's domains.
      const other = await shop("route-other");
      await svc.addDomain(t.id, "kept.example.com");
      ctx = who({ tenant: other, user: ANU, roles: ["owner"] });
      expect((await send("GET", "/domains")).json().items).toEqual([]);

      // Platform admin: list, status, plan, app.
      ctx = owner;
      expect((await send("GET", "/tenants")).statusCode).toBe(403);
      expect((await send("PATCH", `/tenants/${t.id}/plan`, { planId: "pro" })).statusCode).toBe(403);
      ctx = who({ user: ANU, platform: ["superadmin"] });
      const list = (await send("GET", "/tenants?q=route-shop")).json();
      expect(list.items.map((x: { slug: string }) => x.slug)).toEqual(["route-shop"]);
      expect((await send("PATCH", `/tenants/${t.id}/plan`, { planId: "pro" })).json().planId).toBe("pro");
      expect((await send("PATCH", `/tenants/${t.id}/plan`, { planId: "Bad Plan" })).statusCode).toBe(400);
      expect((await send("PATCH", `/tenants/${t.id}/plan`, { planId: null })).json().planId).toBeNull();
      expect((await send("PATCH", `/tenants/${t.id}/app`, { appId: "SCH" })).json().appId).toBe("SCH");
      expect((await send("PATCH", `/tenants/${t.id}/app`, { appId: "bad app" })).statusCode).toBe(400);
      expect((await send("PATCH", `/tenants/${t.id}/status`, { status: "suspended" })).json().status).toBe("suspended");
      expect((await send("PATCH", `/tenants/${t.id}/status`, { status: "gone" })).statusCode).toBe(400);
    });

    it("the public address check suggests alternatives and slows down after 60 checks a minute from one address", async () => {
      ctx = who({ ip: "203.0.113.5" });
      const r = await send("GET", "/slug-available?slug=route-shop&city=Madurai");
      expect(r.json()).toMatchObject({ available: false, code: "taken" });
      expect(r.json().suggestions).toContain("route-shop-madurai");
      expect((await send("GET", "/slug-available?slug=totally-free-name")).json()).toMatchObject({ available: true });
      let limited = 0;
      for (let i = 0; i < 70; i++) if ((await send("GET", "/slug-available?slug=abc")).statusCode === 429) limited++;
      expect(limited).toBeGreaterThanOrEqual(1);
      // A different address isn't slowed.
      ctx = who({ ip: "203.0.113.99" });
      expect((await send("GET", "/slug-available?slug=abc")).statusCode).toBe(200);
    });
  });
});
