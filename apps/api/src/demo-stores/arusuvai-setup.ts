import type { Logger } from "pino";
import type { Kit } from "../kit";
import { DISHES } from "./arusuvai-menu";

/**
 * Restaurant-side setup of Arusuvai Unavagam, run by the demo-store seed after the catalogue exists:
 * 1. dining rooms: three areas and 17 tables with QR codes (Ground floor T1-T8, AC hall A1-A6, Family hall F1-F3);
 * 2. kitchen stations (kitchen, tandoor, beverages) and veg marks for every dish, so each KOT prints per station;
 * 3. the team (phones in the test block +91 90001 1xxxx, used by no other shop) with roles and POS PINs: a manager,
 *    a cashier, two captains (custom `captain` role: take orders and serve), a head cook and a tandoor master (custom
 *    `kitchen` role: kitchen display and serving only);
 * 4. two POS terminals, "Counter 1" and "Counter 2" (the registers the history's till sessions use).
 * Idempotent: rooms only when the shop has no tables, stations only for dishes with none, members, PINs and terminals
 * only when missing.
 */

export interface ArusuvaiStaff {
  name: string;
  phone: string;
  role: string;
  roleKeys: string[];
  pin: string;
}

/** Demo PINs (4 digits, no runs or repeats) for the POS lock screen; shown in the docs, never real. */
export const ARUSUVAI_STAFF: ArusuvaiStaff[] = [
  { name: "Karthikeyan Alagarsamy", phone: "+919000110101", role: "Manager", roleKeys: ["manager"], pin: "4719" },
  { name: "Valliammai Subbiah", phone: "+919000110102", role: "Cashier", roleKeys: ["cashier"], pin: "5283" },
  { name: "Pandiselvam Ramar", phone: "+919000110103", role: "Captain (ground floor)", roleKeys: ["captain"], pin: "6407" },
  { name: "Vellaichamy Muthiah", phone: "+919000110104", role: "Captain (AC and family hall)", roleKeys: ["captain"], pin: "7152" },
  { name: "Muniyandi Kalimuthu", phone: "+919000110105", role: "Head cook", roleKeys: ["kitchen"], pin: "8036" },
  { name: "Sheik Abdullah", phone: "+919000110106", role: "Tandoor master", roleKeys: ["kitchen"], pin: "2964" },
];

export const ARUSUVAI_TERMINALS = ["Counter 1", "Counter 2"];

/** [area, table names, seats]; the family hall tables take 8, 10 and 12. */
const ROOMS: { area: string; tables: [string, number][] }[] = [
  { area: "Ground floor", tables: [["T1", 4], ["T2", 4], ["T3", 4], ["T4", 4], ["T5", 4], ["T6", 4], ["T7", 2], ["T8", 2]] },
  { area: "AC hall", tables: [["A1", 4], ["A2", 4], ["A3", 4], ["A4", 4], ["A5", 6], ["A6", 6]] },
  { area: "Family hall", tables: [["F1", 8], ["F2", 10], ["F3", 12]] },
];

export async function setupArusuvai(kit: Kit, tenant: { id: string; slug: string }, ownerUserId: string, log: Logger): Promise<void> {
  const tenantId = tenant.id;
  const dining = kit.dining.service;

  // ---- rooms and tables (each table gets a QR token: the code on the table opens the store's /table/<token> page)
  if ((await dining.tables(tenantId, { includeInactive: true })).length === 0) {
    for (const [i, room] of ROOMS.entries()) {
      const area = await dining.createArea(tenantId, { name: room.area, sort: (i + 1) * 10 });
      for (const [j, [name, seats]] of room.tables.entries()) await dining.createTable(tenantId, { name, areaId: area.id, seats, sort: (j + 1) * 10 });
    }
    log.info({ slug: tenant.slug, tables: ROOMS.reduce((n, r) => n + r.tables.length, 0) }, "demo store: dining areas and tables created");
  }

  // ---- stations and veg marks
  const marked = new Set((await dining.menuItems(tenantId)).map((m) => m.itemId));
  const items = (await kit.catalogue.service.listItems(tenantId, { limit: 500 })).items;
  let stationed = 0;
  for (const item of items) {
    if (marked.has(item.id)) continue;
    const dish = DISHES.find((d) => item.name === d.name || item.name.startsWith(`${d.name} – `));
    if (!dish) continue;
    await dining.saveMenuItem(tenantId, item.id, { station: dish.station, veg: dish.diet === "veg" });
    stationed++;
  }
  if (stationed) log.info({ slug: tenant.slug, items: stationed }, "demo store: kitchen stations set");

  // ---- team
  const actor = { userId: ownerUserId, level: "owner" as const, ip: null, userAgent: null };
  const planId = (await kit.tenancy.service.getRef(tenantId))?.planId ?? null;
  const ref = { id: tenantId, slug: tenant.slug, name: "Arusuvai Unavagam", appId: "RS", planId };
  if (!(await kit.staff.service.getRole(tenantId, "captain"))) {
    await kit.staff.service.createRole(tenantId, { key: "captain", name: "Captain", description: "Floor staff: open tables, take orders, send KOTs and serve. No bills, no reports.", permissions: ["dining.serve", "catalogue.view"] }, actor);
  }
  if (!(await kit.staff.service.getRole(tenantId, "kitchen"))) {
    await kit.staff.service.createRole(tenantId, { key: "kitchen", name: "Kitchen", description: "Cooks: see the kitchen display and mark tickets, nothing else.", permissions: ["dining.kitchen", "dining.serve"] }, actor);
  }
  const have = new Map((await kit.staff.service.listMembers(tenantId)).map((m) => [m.userId, m]));
  const pins = new Map((await kit.pos.service.listPins(tenantId)).items.map((p) => [p.userId, p.hasPin]));
  for (const s of ARUSUVAI_STAFF) {
    const { user } = await kit.auth.service.findOrCreateByTarget(s.phone, { name: s.name });
    if (user.name !== s.name) await kit.auth.service.updateProfile(user.id, { name: s.name });
    if (!have.has(user.id)) {
      await kit.staff.service.invite(ref as never, { target: s.phone, roleKeys: s.roleKeys, level: "staff" }, actor);
      log.info({ slug: tenant.slug, name: s.name, role: s.role }, "demo store: team member added");
    }
    if (!pins.get(user.id)) await kit.pos.service.setPin(tenantId, user.id, s.pin, actor);
  }

  // ---- POS counters
  const terminals = await kit.pos.service.listTerminals(ref as never);
  const named = new Set(terminals.items.map((t) => t.name));
  for (const name of ARUSUVAI_TERMINALS) {
    if (named.has(name)) continue;
    await kit.pos.service.createTerminal(ref as never, { name, role: "pos" }, actor);
    log.info({ slug: tenant.slug, terminal: name }, "demo store: POS terminal added");
  }
}
